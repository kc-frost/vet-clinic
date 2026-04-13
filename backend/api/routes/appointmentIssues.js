import express from "express";
import { pool } from "../db.js";
import { requireAdmin } from "../lib/authMiddleware.js";
import { cancelAppointment } from "../lib/appointmentCancellationService.js";
import { clearAppointmentIssues, getUnderReviewAppointmentByID, getUnderReviewAppointments } from "../lib/appointmentIssueService.js";
import { getRule } from "../lib/reservationRules.js";

const router = express.Router();

const OPEN_MINUTES = 9 * 60;
const CLOSE_MINUTES = 17 * 60;
const SLOT_STEP_MINUTES = 15;

function toPositiveInt(value) {
	// Keep route IDs strict so bad params do not leak into DB work
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) return null;
	return parsed;
}

function pad2(value) {
	// Keep date and time pieces in two digit form
	return String(value).padStart(2, "0");
}

function isValidDateOnly(dateText) {
	// Keep date-only values strict so slot logic stays predictable
	return /^\d{4}-\d{2}-\d{2}$/.test(String(dateText || ""));
}

function isValidTimeOnly(timeText) {
	// Keep time-only values strict for the same reason
	return /^\d{2}:\d{2}$/.test(String(timeText || ""));
}

function timeStrToMinutes(timeText) {
	// Convert HH:MM into minutes since midnight
	const [hourText, minuteText] = String(timeText || "").split(":");
	const hour = Number(hourText);
	const minute = Number(minuteText);

	if (!Number.isFinite(hour) || !Number.isFinite(minute)) return NaN;
	return hour * 60 + minute;
}

function minutesToTimeStr(totalMinutes) {
	// Convert minutes since midnight back into HH:MM
	const hour = Math.floor(totalMinutes / 60);
	const minute = totalMinutes % 60;
	return `${pad2(hour)}:${pad2(minute)}`;
}

function formatSqlDateTime(dateText, timeText) {
	// Build a MySQL DATETIME string
	return `${dateText} ${timeText}:00`;
}

function addDays(dateText, days) {
	// Add whole days to a YYYY-MM-DD date string
	const [year, month, day] = String(dateText).split("-").map((value) => Number(value));
	const nextDate = new Date(year, month - 1, day);
	nextDate.setDate(nextDate.getDate() + days);
	return `${nextDate.getFullYear()}-${pad2(nextDate.getMonth() + 1)}-${pad2(nextDate.getDate())}`;
}

function getTodayDateStr() {
	// Get today's local date in YYYY-MM-DD form
	const now = new Date();
	return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function getNowMinutesOfDay() {
	// Get the current local time as minutes since midnight
	const now = new Date();
	return now.getHours() * 60 + now.getMinutes();
}

function getDayOfWeekFromDateStr(dateText) {
	// Staff availability uses Monday 1 through Sunday 7
	const [year, month, day] = String(dateText).split("-").map((value) => Number(value));
	const jsDay = new Date(year, month - 1, day).getDay();
	return jsDay === 0 ? 7 : jsDay;
}

function sqlDateTimeToDate(value) {
	// Convert SQL datetime text into a JS Date
	if (value instanceof Date) return value;

	const raw = String(value || "");
	if (!raw) return new Date(NaN);

	if (/^\d{4}-\d{2}-\d{2} /.test(raw)) return new Date(raw.replace(" ", "T"));
	return new Date(raw);
}

function getDateOnly(value) {
	// Pull just the date piece out of a SQL datetime value
	const dateValue = sqlDateTimeToDate(value);

	if (!Number.isNaN(dateValue.getTime())) {
		return `${dateValue.getFullYear()}-${pad2(dateValue.getMonth() + 1)}-${pad2(dateValue.getDate())}`;
	}

	return String(value || "").split(" ")[0] || "";
}

function parseSqlDateTimeToMinutes(value) {
	// Convert a SQL datetime into minutes since midnight
	const dateValue = sqlDateTimeToDate(value);

	if (!Number.isNaN(dateValue.getTime())) return dateValue.getHours() * 60 + dateValue.getMinutes();

	const timePart = String(value || "").split(" ")[1] || "";
	return timeStrToMinutes(timePart.slice(0, 5));
}

function parseTimeValueToMinutes(value) {
	// Convert MySQL TIME into minutes since midnight
	const match = String(value || "").trim().match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
	if (!match) return NaN;
	return Number(match[1]) * 60 + Number(match[2]);
}

function buildSlotsForDay(dateText, durationMinutes) {
	// Build every possible start that still fits before close
	const slots = [];

	for (let startMin = OPEN_MINUTES; startMin + durationMinutes <= CLOSE_MINUTES; startMin += SLOT_STEP_MINUTES) {
		slots.push({ date: dateText, startMin });
	}

	return slots;
}

function buildStaffRoleMap(rows) {
	// Map roleKey to the staff IDs that can fill it
	const roleMap = new Map();

	for (const row of rows) {
		const roleKey = String(row.roleKey || "");
		const staffID = Number(row.staffID);

		if (!roleKey || !Number.isFinite(staffID)) continue;
		if (!roleMap.has(roleKey)) roleMap.set(roleKey, []);
		roleMap.get(roleKey).push(staffID);
	}

	return roleMap;
}

function buildStaffAvailabilityMap(rows) {
	// Organize each staff member's weekly availability by day
	const availabilityMap = new Map();

	for (const row of rows) {
		const staffID = Number(row.staffID);
		const dayOfWeek = Number(row.dayOfWeek);
		const startMin = parseTimeValueToMinutes(row.startTime);
		const endMin = parseTimeValueToMinutes(row.endTime);

		if (!Number.isFinite(staffID) || !Number.isFinite(dayOfWeek)) continue;
		if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) continue;

		if (!availabilityMap.has(staffID)) availabilityMap.set(staffID, new Map());
		availabilityMap.get(staffID).set(dayOfWeek, { startMin, endMin });
	}

	return availabilityMap;
}

function buildAppointmentStaffMap(rows) {
	// Map appointmentID to assigned staff IDs
	const appointmentStaffMap = new Map();

	for (const row of rows) {
		const appointmentID = Number(row.appointmentID);
		const staffID = Number(row.staffID);

		if (!Number.isFinite(appointmentID) || !Number.isFinite(staffID)) continue;
		if (!appointmentStaffMap.has(appointmentID)) appointmentStaffMap.set(appointmentID, []);
		appointmentStaffMap.get(appointmentID).push(staffID);
	}

	return appointmentStaffMap;
}

function buildItemKeyToRowMap(rows) {
	// Map inventory itemKey to its row
	const itemMap = new Map();

	for (const row of rows) {
		itemMap.set(String(row.itemKey || ""), row);
	}

	return itemMap;
}

function staffHasWeeklyAvailability(staffAvailabilityById, staffID, dayOfWeek, startMin, endMin) {
	// Staff can only be used if their saved window covers the whole appointment
	const availabilityByDay = staffAvailabilityById.get(staffID);
	if (!availabilityByDay) return false;

	const dayBlock = availabilityByDay.get(dayOfWeek);
	if (!dayBlock) return false;

	return dayBlock.startMin <= startMin && dayBlock.endMin >= endMin;
}

function appointmentHasStaffOverlap(appointment, assignedStaffIds, staffID, startMin, endMin) {
	// Reject a staff member if they are already on an overlapping appointment
	if (!assignedStaffIds.includes(staffID)) return false;

	const appointmentStartMin = parseSqlDateTimeToMinutes(appointment.date);
	const appointmentEndMin = appointmentStartMin + Number(appointment.durationMinutes || 0);
	return appointmentStartMin < endMin && startMin < appointmentEndMin;
}

function expandRequiredStaffSlots(rule) {
	// Expand qty rules into individual slots so one person cannot cover multiple required positions
	const slots = [];

	for (const need of rule.requiredStaff || []) {
		const qty = Number(need.qty || 0);

		for (let index = 0; index < qty; index++) {
			slots.push({ roleKey: need.roleKey, slotIndex: index });
		}
	}

	return slots;
}

function shuffleArray(values) {
	// Keep assignment from always favoring the same first IDs
	const copy = [...values];

	for (let index = copy.length - 1; index > 0; index--) {
		const swapIndex = Math.floor(Math.random() * (index + 1));
		[copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
	}

	return copy;
}

function findRandomStaffAssignment(rule, roleToStaffIds, staffAvailabilityById, dayOfWeek, dayAppointments, appointmentStaffByAppt, startMin, endMin) {
	// Try to find one complete valid set of staff assignments for this window
	const requiredSlots = expandRequiredStaffSlots(rule);
	if (!requiredSlots.length) return [];

	const preparedSlots = requiredSlots.map((slot) => {
		const rawCandidates = roleToStaffIds.get(slot.roleKey) || [];

		const filteredCandidates = rawCandidates.filter((staffID) => {
			if (!staffHasWeeklyAvailability(staffAvailabilityById, staffID, dayOfWeek, startMin, endMin)) return false;

			for (const appointment of dayAppointments) {
				const assignedStaffIds = appointmentStaffByAppt.get(Number(appointment.appointmentID)) || [];
				if (appointmentHasStaffOverlap(appointment, assignedStaffIds, staffID, startMin, endMin)) return false;
			}

			return true;
		});

		return {
			roleKey: slot.roleKey,
			candidates: shuffleArray(filteredCandidates),
			randomTie: Math.random(),
		};
	});

	preparedSlots.sort((left, right) => {
		if (left.candidates.length !== right.candidates.length) return left.candidates.length - right.candidates.length;
		return left.randomTie - right.randomTie;
	});

	if (preparedSlots.some((slot) => slot.candidates.length === 0)) return null;

	const usedStaffIds = new Set();

	function assign(slotIndex) {
		if (slotIndex >= preparedSlots.length) return [];

		const slot = preparedSlots[slotIndex];

		for (const staffID of slot.candidates) {
			if (usedStaffIds.has(staffID)) continue;

			usedStaffIds.add(staffID);
			const rest = assign(slotIndex + 1);

			if (rest) return [{ staffID, assignedRoleKey: slot.roleKey }, ...rest];

			usedStaffIds.delete(staffID);
		}

		return null;
	}

	return assign(0);
}

async function withTransaction(workFn) {
	// Keep patching and cleanup as one all-or-nothing unit
	const conn = await pool.getConnection();

	try {
		await conn.beginTransaction();
		const result = await workFn(conn);
		await conn.commit();
		return result;
	} catch (err) {
		try {
			await conn.rollback();
		} catch (_) {
			// Nothing else useful to do if rollback itself fails
		}
		throw err;
	} finally {
		conn.release();
	}
}

async function loadIssueAppointmentRowForUpdate(conn, appointmentID) {
	// Load the real appointment row and lock it before mutating anything
	const [rows] = await conn.query(
		`SELECT appointmentID, userID, petID, roomNumber, reasonKey, date, durationMinutes, underReview, isCanceled
		 FROM appointment
		 WHERE appointmentID = ?
		 LIMIT 1
		 FOR UPDATE`,
		[appointmentID]
	);

	if (!rows.length) return null;
	return rows[0];
}

async function loadRescheduleBaseAppointment(conn, appointmentID) {
	// Load enough appointment data to build reschedule options and patch the row later
	const [rows] = await conn.query(
		`SELECT
			a.appointmentID,
			a.userID,
			a.petID,
			a.reasonKey,
			a.date,
			a.durationMinutes,
			af.petName,
			TRIM(CONCAT(COALESCE(af.legalFirstName, ''), ' ', COALESCE(af.legalLastName, ''))) AS ownerName
		 FROM appointment a
		 LEFT JOIN appointment_form af
			on af.appointmentID = a.appointmentID
		 WHERE a.appointmentID = ?
		 AND COALESCE(a.underReview, 0) = 1
		 AND COALESCE(a.isCanceled, 0) = 0
		 LIMIT 1`,
		[appointmentID]
	);

	if (!rows.length) return null;
	return rows[0];
}

async function fetchInventoryByKeys(conn, itemKeys, isConsumable) {
	// Load only the inventory rows that matter for this appointment reason
	if (!itemKeys.length) return [];

	const placeholders = itemKeys.map(() => "?").join(",");
	const [rows] = await conn.execute(
		`SELECT itemID, itemKey, quantity
		 FROM inventory
		 WHERE itemKey IN (${placeholders})
		 AND isConsumable = ?
		 AND COALESCE(isActive, 1) = 1`,
		[...itemKeys, isConsumable ? 1 : 0]
	);

	return rows;
}

function buildSlotResponse(dateText, startMin, durationMinutes) {
	// Shape one calendar slot into the same kind of data the slot calendar expects
	const startTime = minutesToTimeStr(startMin);
	const endTime = minutesToTimeStr(startMin + durationMinutes);
	return {
		slotId: `slot_${dateText}_${startTime.replace(":", "")}_${endTime.replace(":", "")}`,
		date: dateText,
		startTime,
		endTime,
		startDateTime: formatSqlDateTime(dateText, startTime),
		endDateTime: formatSqlDateTime(dateText, endTime),
	};
}

async function getRescheduleOptionsForAppointment(conn, appointment, startDate, days) {
	// Generate calendar slots for this one under-review appointment while ignoring its own old row
	const rule = getRule(appointment.reasonKey);
	if (!rule) return [];

	const requiredConsumableKeys = rule.consumables.map((item) => item.itemKey);
	const requiredNonConsumableKeys = rule.nonConsumables || [];
	const consumableRows = buildItemKeyToRowMap(await fetchInventoryByKeys(conn, requiredConsumableKeys, true));
	const nonConsumableRows = buildItemKeyToRowMap(await fetchInventoryByKeys(conn, requiredNonConsumableKeys, false));

	for (const need of rule.consumables) {
		const row = consumableRows.get(need.itemKey);
		if (!row || Number(row.quantity) < need.qty) return [];
	}

	for (const itemKey of requiredNonConsumableKeys) {
		const row = nonConsumableRows.get(itemKey);
		if (!row || Number(row.quantity) < 1) return [];
	}

	const [roomRows] = await conn.execute(
		`SELECT roomNumber
		 FROM rooms
		 WHERE roomType = ?
		 AND COALESCE(isActive, 1) = 1
		 ORDER BY roomNumber ASC`,
		[rule.roomType]
	);

	const roomNumbers = roomRows.map((row) => Number(row.roomNumber)).filter((roomNumber) => Number.isFinite(roomNumber));
	if (!roomNumbers.length) return [];

	const [staffRoleRows] = await conn.execute(
		`SELECT sr.staffID, sr.roleKey
		 FROM staff_role sr
		 INNER JOIN staff s
			on s.staffID = sr.staffID
		 INNER JOIN customer c
			on c.userID = s.userID
		 WHERE COALESCE(s.isActive, 1) = 1
		 AND COALESCE(c.isDeactivated, 0) = 0
		 ORDER BY sr.staffID ASC, sr.roleKey ASC`
	);
	const roleToStaffIds = buildStaffRoleMap(staffRoleRows);

	const requiredRoleKeys = [...new Set((rule.requiredStaff || []).map((need) => need.roleKey))];
	if (requiredRoleKeys.some((roleKey) => !(roleToStaffIds.get(roleKey) || []).length)) return [];

	const [staffAvailabilityRows] = await conn.execute(
		`SELECT sa.staffID, sa.dayOfWeek, sa.startTime, sa.endTime
		 FROM staff_availability sa
		 INNER JOIN staff s
			on s.staffID = sa.staffID
		 INNER JOIN customer c
			on c.userID = s.userID
		 WHERE COALESCE(s.isActive, 1) = 1
		 AND COALESCE(c.isDeactivated, 0) = 0`
	);
	const staffAvailabilityById = buildStaffAvailabilityMap(staffAvailabilityRows);

	const rangeStart = `${startDate} 00:00:00`;
	const rangeEndExclusive = `${addDays(startDate, days)} 00:00:00`;

	const [appointmentRows] = await conn.execute(
		`SELECT appointmentID, userID, petID, roomNumber, reasonKey, date, durationMinutes
		 FROM appointment
		 WHERE date >= ?
		 AND date < ?
		 AND COALESCE(isCanceled, 0) = 0`,
		[rangeStart, rangeEndExclusive]
	);

	const otherAppointments = appointmentRows.filter((row) => Number(row.appointmentID) !== Number(appointment.appointmentID));
	const dayAppointmentIds = otherAppointments.map((row) => Number(row.appointmentID)).filter((appointmentID) => Number.isFinite(appointmentID));
	const appointmentStaffRows = dayAppointmentIds.length
		? (await conn.execute(
			`SELECT appointmentID, staffID
			 FROM appointment_staff
			 WHERE appointmentID IN (${dayAppointmentIds.map(() => "?").join(",")})`,
			dayAppointmentIds
		))[0]
		: [];
	const appointmentStaffByAppt = buildAppointmentStaffMap(appointmentStaffRows);

	const appointmentsByDate = new Map();

	for (const row of otherAppointments) {
		const dateText = getDateOnly(row.date);
		if (!appointmentsByDate.has(dateText)) appointmentsByDate.set(dateText, []);
		appointmentsByDate.get(dateText).push(row);
	}

	const slots = [];
	const todayDate = getTodayDateStr();
	const nowMinutes = getNowMinutesOfDay();

	for (let offset = 0; offset < days; offset++) {
		const dateText = addDays(startDate, offset);
		const dayAppointments = appointmentsByDate.get(dateText) || [];
		const dayOfWeek = getDayOfWeekFromDateStr(dateText);

		const roomBusyByNumber = new Map();
		for (const roomNumber of roomNumbers) roomBusyByNumber.set(roomNumber, Array(64).fill(false));

		const petBusy = appointment.petID ? Array(64).fill(false) : null;
		const equipmentBusyCounts = new Map();
		for (const itemKey of requiredNonConsumableKeys) equipmentBusyCounts.set(itemKey, Array(64).fill(0));

		for (const existingAppointment of dayAppointments) {
			const appointmentStartMin = parseSqlDateTimeToMinutes(existingAppointment.date);
			const appointmentEndMin = appointmentStartMin + Number(existingAppointment.durationMinutes || 0);
			const clampedStartMin = Math.max(appointmentStartMin, OPEN_MINUTES);
			const clampedEndMin = Math.min(appointmentEndMin, CLOSE_MINUTES);

			if (clampedEndMin <= clampedStartMin) continue;

			const startBucket = Math.floor((clampedStartMin - OPEN_MINUTES) / SLOT_STEP_MINUTES);
			const endBucketExclusive = Math.ceil((clampedEndMin - OPEN_MINUTES) / SLOT_STEP_MINUTES);

			const roomBusy = roomBusyByNumber.get(Number(existingAppointment.roomNumber));
			if (roomBusy) {
				for (let bucket = startBucket; bucket < endBucketExclusive; bucket++) roomBusy[bucket] = true;
			}

			if (petBusy && appointment.petID !== null && Number(existingAppointment.petID) === Number(appointment.petID)) {
				for (let bucket = startBucket; bucket < endBucketExclusive; bucket++) petBusy[bucket] = true;
			}

			const existingRule = getRule(existingAppointment.reasonKey);
			if (!existingRule) continue;

			for (const itemKey of existingRule.nonConsumables || []) {
				const usageBuckets = equipmentBusyCounts.get(itemKey);
				if (!usageBuckets) continue;
				for (let bucket = startBucket; bucket < endBucketExclusive; bucket++) usageBuckets[bucket] += 1;
			}
		}

		const dayCandidates = buildSlotsForDay(dateText, rule.durationMinutes);
		const bucketCount = Math.ceil(rule.durationMinutes / SLOT_STEP_MINUTES);

		for (const slot of dayCandidates) {
			if (dateText === todayDate && slot.startMin < nowMinutes) continue;

			const startBucket = Math.floor((slot.startMin - OPEN_MINUTES) / SLOT_STEP_MINUTES);

			if (petBusy) {
				let petCanUseSlot = true;

				for (let bucketOffset = 0; bucketOffset < bucketCount; bucketOffset++) {
					if (petBusy[startBucket + bucketOffset]) {
						petCanUseSlot = false;
						break;
					}
				}

				if (!petCanUseSlot) continue;
			}

			let availableRoomNumber = null;

			for (const roomNumber of roomNumbers) {
				const roomBusy = roomBusyByNumber.get(roomNumber);
				if (!roomBusy) continue;

				let roomCanUseSlot = true;

				for (let bucketOffset = 0; bucketOffset < bucketCount; bucketOffset++) {
					if (roomBusy[startBucket + bucketOffset]) {
						roomCanUseSlot = false;
						break;
					}
				}

				if (roomCanUseSlot) {
					availableRoomNumber = roomNumber;
					break;
				}
			}

			if (availableRoomNumber === null) continue;

			let equipmentCanUseSlot = true;

			for (const itemKey of requiredNonConsumableKeys) {
				const itemRow = nonConsumableRows.get(itemKey);
				const capacity = Number(itemRow?.quantity || 0);
				const usageBuckets = equipmentBusyCounts.get(itemKey) || [];

				for (let bucketOffset = 0; bucketOffset < bucketCount; bucketOffset++) {
					if ((usageBuckets[startBucket + bucketOffset] || 0) >= capacity) {
						equipmentCanUseSlot = false;
						break;
					}
				}

				if (!equipmentCanUseSlot) break;
			}

			if (!equipmentCanUseSlot) continue;

			const staffAssignment = findRandomStaffAssignment(
				rule,
				roleToStaffIds,
				staffAvailabilityById,
				dayOfWeek,
				dayAppointments,
				appointmentStaffByAppt,
				slot.startMin,
				slot.startMin + rule.durationMinutes
			);
			if (!staffAssignment) continue;

			slots.push(buildSlotResponse(dateText, slot.startMin, rule.durationMinutes));
		}
	}

	return slots;
}

async function safelyRefundAppointmentConsumables(conn, appointmentID) {
	// Put old reserved consumables back before reserving the new slot's consumables
	const [rows] = await conn.execute(
		`SELECT itemID, qtyUsed
		 FROM appointment_consumable
		 WHERE appointmentID = ?
		 FOR UPDATE`,
		[appointmentID]
	);

	for (const row of rows) {
		await conn.execute(
			`UPDATE inventory
			 SET quantity = quantity + ?
			 WHERE itemID = ?`,
			[Number(row.qtyUsed), Number(row.itemID)]
		);
	}

	await conn.execute(`DELETE FROM appointment_consumable WHERE appointmentID = ?`, [appointmentID]);
}

async function reserveConsumables(conn, rule) {
	// Reserve current consumables for the new slot after old ones were refunded
	if (!rule.consumables.length) return { ok: true, error: "", reserved: [] };

	const itemKeys = rule.consumables.map((item) => item.itemKey);
	const placeholders = itemKeys.map(() => "?").join(",");
	const [rows] = await conn.execute(
		`SELECT itemID, itemKey, quantity
		 FROM inventory
		 WHERE itemKey IN (${placeholders})
		 AND isConsumable = 1
		 AND COALESCE(isActive, 1) = 1
		 FOR UPDATE`,
		itemKeys
	);

	const inventoryByKey = buildItemKeyToRowMap(rows);

	for (const need of rule.consumables) {
		const row = inventoryByKey.get(need.itemKey);

		if (!row) return { ok: false, error: `missing consumable inventory itemKey ${need.itemKey}`, reserved: [] };
		if (Number(row.quantity) < need.qty) return { ok: false, error: `not enough stock for ${need.itemKey}`, reserved: [] };
	}

	for (const need of rule.consumables) {
		await conn.execute(
			`UPDATE inventory
			 SET quantity = quantity - ?
			 WHERE itemKey = ?
			 AND isConsumable = 1
			 AND COALESCE(isActive, 1) = 1`,
			[need.qty, need.itemKey]
		);
	}

	return {
		ok: true,
		error: "",
		reserved: rule.consumables.map((need) => ({
			itemID: Number(inventoryByKey.get(need.itemKey).itemID),
			qtyUsed: need.qty,
		})),
	};
}

async function selectAvailableRoom(conn, roomType, startSql, endSql, ignoredAppointmentID) {
	// Find one active room that is not blocked by another overlapping appointment
	const [rows] = await conn.execute(
		`SELECT r.roomNumber
		 FROM rooms r
		 WHERE r.roomType = ?
		 AND COALESCE(r.isActive, 1) = 1
		 AND NOT EXISTS (
			SELECT 1
			FROM appointment a
			WHERE a.roomNumber = r.roomNumber
			AND a.appointmentID <> ?
			AND a.date < ?
			AND DATE_ADD(a.date, INTERVAL a.durationMinutes MINUTE) > ?
			AND COALESCE(a.isCanceled, 0) = 0
		 )
		 ORDER BY r.roomNumber ASC
		 LIMIT 1
		 FOR UPDATE`,
		[roomType, ignoredAppointmentID, endSql, startSql]
	);

	if (!rows.length) return null;
	return Number(rows[0].roomNumber);
}

async function checkNonConsumableCapacityForInterval(conn, rule, startSql, endSql, ignoredAppointmentID) {
	// Make sure exact-key equipment capacity still works after ignoring this appointment's own old row
	if (!rule.nonConsumables.length) return { ok: true, error: "" };

	const itemKeys = rule.nonConsumables;
	const placeholders = itemKeys.map(() => "?").join(",");
	const [rows] = await conn.execute(
		`SELECT itemID, itemKey, quantity
		 FROM inventory
		 WHERE itemKey IN (${placeholders})
		 AND isConsumable = 0
		 AND COALESCE(isActive, 1) = 1
		 FOR UPDATE`,
		itemKeys
	);

	const inventoryByKey = buildItemKeyToRowMap(rows);

	for (const itemKey of itemKeys) {
		const row = inventoryByKey.get(itemKey);
		if (!row) return { ok: false, error: `missing non-consumable inventory itemKey ${itemKey}` };
		if (Number(row.quantity) < 1) return { ok: false, error: `no capacity for ${itemKey}` };
	}

	const [overlapRows] = await conn.execute(
		`SELECT appointmentID, reasonKey, date, durationMinutes
		 FROM appointment
		 WHERE appointmentID <> ?
		 AND date < ?
		 AND DATE_ADD(date, INTERVAL durationMinutes MINUTE) > ?
		 AND COALESCE(isCanceled, 0) = 0
		 FOR UPDATE`,
		[ignoredAppointmentID, endSql, startSql]
	);

	const startDate = new Date(startSql.replace(" ", "T"));
	const endDate = new Date(endSql.replace(" ", "T"));
	const bucketCount = Math.ceil((endDate.getTime() - startDate.getTime()) / (SLOT_STEP_MINUTES * 60000));

	for (const itemKey of itemKeys) {
		const capacity = Number(inventoryByKey.get(itemKey).quantity || 0);

		for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex++) {
			const bucketStart = new Date(startDate.getTime() + bucketIndex * SLOT_STEP_MINUTES * 60000);
			const bucketEnd = new Date(bucketStart.getTime() + SLOT_STEP_MINUTES * 60000);

			let used = 0;

			for (const appointment of overlapRows) {
				const ruleForAppointment = getRule(appointment.reasonKey);
				if (!ruleForAppointment) continue;
				if (!(ruleForAppointment.nonConsumables || []).includes(itemKey)) continue;

				const appointmentStart = sqlDateTimeToDate(appointment.date);
				const appointmentEnd = new Date(appointmentStart.getTime() + Number(appointment.durationMinutes || 0) * 60000);

				if (bucketStart < appointmentEnd && appointmentStart < bucketEnd) used += 1;
			}

			if (used >= capacity) return { ok: false, error: `no capacity for ${itemKey} in that time window` };
		}
	}

	return { ok: true, error: "" };
}

async function selectAvailableStaffAssignment(conn, rule, appointmentDate, startSql, endSql, ignoredAppointmentID) {
	// Rebuild staff assignment for the chosen slot while ignoring this appointment's own old row
	const dayOfWeek = getDayOfWeekFromDateStr(appointmentDate);
	const startMin = parseSqlDateTimeToMinutes(startSql);
	const endMin = parseSqlDateTimeToMinutes(endSql);

	const [staffRoleRows] = await conn.execute(
		`SELECT sr.staffID, sr.roleKey
		 FROM staff_role sr
		 INNER JOIN staff s
			on s.staffID = sr.staffID
		 INNER JOIN customer c
			on c.userID = s.userID
		 WHERE COALESCE(s.isActive, 1) = 1
		 AND COALESCE(c.isDeactivated, 0) = 0
		 ORDER BY sr.staffID ASC, sr.roleKey ASC`
	);
	const roleToStaffIds = buildStaffRoleMap(staffRoleRows);

	const [staffAvailabilityRows] = await conn.execute(
		`SELECT sa.staffID, sa.dayOfWeek, sa.startTime, sa.endTime
		 FROM staff_availability sa
		 INNER JOIN staff s
			on s.staffID = sa.staffID
		 INNER JOIN customer c
			on c.userID = s.userID
		 WHERE sa.dayOfWeek = ?
		 AND COALESCE(s.isActive, 1) = 1
		 AND COALESCE(c.isDeactivated, 0) = 0`,
		[dayOfWeek]
	);
	const staffAvailabilityById = buildStaffAvailabilityMap(staffAvailabilityRows);

	const [dayAppointments] = await conn.execute(
		`SELECT appointmentID, date, durationMinutes
		 FROM appointment
		 WHERE appointmentID <> ?
		 AND date >= ?
		 AND date < ?
		 AND COALESCE(isCanceled, 0) = 0
		 FOR UPDATE`,
		[ignoredAppointmentID, `${appointmentDate} 00:00:00`, `${addDays(appointmentDate, 1)} 00:00:00`]
	);

	const appointmentIds = dayAppointments.map((appointment) => Number(appointment.appointmentID)).filter((appointmentID) => Number.isFinite(appointmentID));
	const appointmentStaffRows = appointmentIds.length
		? (await conn.execute(
			`SELECT appointmentID, staffID
			 FROM appointment_staff
			 WHERE appointmentID IN (${appointmentIds.map(() => "?").join(",")})
			 FOR UPDATE`,
			appointmentIds
		))[0]
		: [];
	const appointmentStaffByAppt = buildAppointmentStaffMap(appointmentStaffRows);

	return findRandomStaffAssignment(rule, roleToStaffIds, staffAvailabilityById, dayOfWeek, dayAppointments, appointmentStaffByAppt, startMin, endMin);
}

async function writeAppointmentStaffRows(conn, appointmentID, assignments) {
	// Replace staff assignments with the newly chosen same-appointment patch result
	await conn.execute(`DELETE FROM appointment_staff WHERE appointmentID = ?`, [appointmentID]);

	for (const assignment of assignments) {
		await conn.execute(
			`INSERT INTO appointment_staff (appointmentID, staffID, assignedRoleKey)
			 VALUES (?, ?, ?)`,
			[appointmentID, assignment.staffID, assignment.assignedRoleKey]
		);
	}
}

async function writeAppointmentConsumableRows(conn, appointmentID, reservedConsumables) {
	// Store the new consumable reservations for the patched appointment
	for (const reserved of reservedConsumables) {
		await conn.execute(
			`INSERT INTO appointment_consumable (appointmentID, itemID, qtyUsed)
			 VALUES (?, ?, ?)`,
			[appointmentID, reserved.itemID, reserved.qtyUsed]
		);
	}
}

router.get("/", requireAdmin, async (_req, res) => {
	try {
		// Load the full under review appointment list for the admin issues page
		const appointments = await getUnderReviewAppointments();
		res.json(appointments);
	} catch (err) {
		console.error("GET /api/appointment-issues error:", err);
		res.status(500).json({ message: "Failed to fetch under-review appointments" });
	}
});

router.get("/:appointmentID", requireAdmin, async (req, res) => {
	try {
		// Load one under review appointment by its route param ID
		const appointment = await getUnderReviewAppointmentByID(req.params.appointmentID);

		// Return 404 if that appointment does not exist or is not currently under review
		if (!appointment) return res.status(404).json({ message: "Under-review appointment not found" });

		res.json(appointment);
	} catch (err) {
		console.error("GET /api/appointment-issues/:appointmentID error:", err);
		res.status(500).json({ message: "Failed to fetch under-review appointment" });
	}
});

router.get("/:appointmentID/reschedule-options", requireAdmin, async (req, res) => {
	try {
		// Build slot options for this under-review appointment and ignore its own old row while doing it
		const appointmentID = toPositiveInt(req.params.appointmentID);
		if (!appointmentID) return res.status(400).json({ message: "Invalid appointment id" });

		const appointment = await loadRescheduleBaseAppointment(pool, appointmentID);
		if (!appointment) return res.status(404).json({ message: "Under-review appointment not found" });

		const requestedStartDate = String(req.query.startDate || "");
		const startDate = isValidDateOnly(requestedStartDate) ? requestedStartDate : getDateOnly(appointment.date);
		const requestedDays = Number(req.query.days);
		const days = Number.isFinite(requestedDays) ? Math.max(1, Math.min(30, Math.trunc(requestedDays))) : 14;

		const conn = await pool.getConnection();

		try {
			const slots = await getRescheduleOptionsForAppointment(conn, appointment, startDate, days);
			res.json({
				appointmentID,
				startDate,
				days,
				slots,
			});
		} finally {
			conn.release();
		}
	} catch (err) {
		console.error("GET /api/appointment-issues/:appointmentID/reschedule-options error:", err);
		res.status(500).json({ message: "Failed to fetch reschedule options" });
	}
});

router.post("/:appointmentID/reschedule", requireAdmin, async (req, res) => {
	try {
		// Patch the same appointment to a newly chosen valid slot instead of deleting and recreating it
		const appointmentID = toPositiveInt(req.params.appointmentID);
		if (!appointmentID) return res.status(400).json({ message: "Invalid appointment id" });

		const slotId = String(req.body?.slotId || "");
		let appointmentDate = String(req.body?.appointmentDate || "");
		let startTime = String(req.body?.startTime || "");

		if ((!appointmentDate || !startTime) && slotId) {
			const parts = slotId.split("_");
			if (parts.length >= 4) {
				appointmentDate = parts[1] || appointmentDate;

				const startHHMM = String(parts[2] || "");
				if (/^\d{4}$/.test(startHHMM)) startTime = `${startHHMM.slice(0, 2)}:${startHHMM.slice(2, 4)}`;
			}
		}

		if (!isValidDateOnly(appointmentDate) || !isValidTimeOnly(startTime)) {
			return res.status(400).json({ message: "Valid appointmentDate and startTime are required" });
		}

		const result = await withTransaction(async (conn) => {
			const appointment = await loadIssueAppointmentRowForUpdate(conn, appointmentID);
			if (!appointment || Number(appointment.underReview) !== 1 || Number(appointment.isCanceled) === 1) {
				return { ok: false, status: 404, message: "Under-review appointment not found" };
			}

			const rule = getRule(appointment.reasonKey);
			if (!rule) return { ok: false, status: 400, message: "Invalid appointment reason" };

			const startMinutes = timeStrToMinutes(startTime);
			if (!Number.isFinite(startMinutes) || startMinutes % SLOT_STEP_MINUTES !== 0) {
				return { ok: false, status: 400, message: "startTime must be on a 15 minute boundary" };
			}

			const endMinutes = startMinutes + Number(rule.durationMinutes || appointment.durationMinutes || 0);
			if (startMinutes < OPEN_MINUTES || endMinutes > CLOSE_MINUTES) {
				return { ok: false, status: 400, message: "Appointment time is outside clinic hours" };
			}

			const startSql = formatSqlDateTime(appointmentDate, startTime);
			const endSql = formatSqlDateTime(appointmentDate, minutesToTimeStr(endMinutes));

			if (appointment.petID !== null) {
				const [petOverlapRows] = await conn.execute(
					`SELECT appointmentID
					 FROM appointment
					 WHERE appointmentID <> ?
					 AND petID = ?
					 AND date < ?
					 AND DATE_ADD(date, INTERVAL durationMinutes MINUTE) > ?
					 AND COALESCE(isCanceled, 0) = 0
					 FOR UPDATE`,
					[appointmentID, Number(appointment.petID), endSql, startSql]
				);

				if (petOverlapRows.length) return { ok: false, status: 409, message: "That pet already has an overlapping appointment" };
			}

			const assignedStaff = await selectAvailableStaffAssignment(conn, rule, appointmentDate, startSql, endSql, appointmentID);
			if (!assignedStaff) return { ok: false, status: 409, message: "No staff are available for that time" };

			const roomNumber = await selectAvailableRoom(conn, rule.roomType, startSql, endSql, appointmentID);
			if (!roomNumber) return { ok: false, status: 409, message: "No room is available for that time" };

			const nonConsumableCheck = await checkNonConsumableCapacityForInterval(conn, rule, startSql, endSql, appointmentID);
			if (!nonConsumableCheck.ok) return { ok: false, status: 409, message: nonConsumableCheck.error };

			await safelyRefundAppointmentConsumables(conn, appointmentID);

			const consumableReserve = await reserveConsumables(conn, rule);
			if (!consumableReserve.ok) return { ok: false, status: 409, message: consumableReserve.error };

			await conn.execute(
				`UPDATE appointment
				 SET roomNumber = ?,
				     date = ?,
				     durationMinutes = ?,
				     underReview = 0
				 WHERE appointmentID = ?`,
				[roomNumber, startSql, Number(rule.durationMinutes || appointment.durationMinutes || 0), appointmentID]
			);

			await writeAppointmentStaffRows(conn, appointmentID, assignedStaff);
			await writeAppointmentConsumableRows(conn, appointmentID, consumableReserve.reserved);
			await clearAppointmentIssues(conn, appointmentID);

			return {
				ok: true,
				appointmentID,
				startAt: startSql,
				endAt: endSql,
				roomNumber,
			};
		});

		if (!result.ok) return res.status(result.status || 500).json({ message: result.message || "Failed to reschedule under-review appointment" });

		const updatedAppointment = await getUnderReviewAppointmentByID(appointmentID);

		res.json({
			message: "Under-review appointment rescheduled",
			result: {
				appointmentID: result.appointmentID,
				startAt: result.startAt,
				endAt: result.endAt,
				roomNumber: result.roomNumber,
			},
			appointment: updatedAppointment,
		});
	} catch (err) {
		console.error("POST /api/appointment-issues/:appointmentID/reschedule error:", err);
		res.status(500).json({ message: "Failed to reschedule under-review appointment" });
	}
});

router.post("/:appointmentID/cancel", requireAdmin, async (req, res) => {
	try {
		// Issue page cancel is still a normal admin cancellation
		const appointmentID = toPositiveInt(req.params.appointmentID);
		const adminUserID = Number(req.session?.userID);
		const cancellationReason = String(req.body?.cancellationReason || "").trim();

		if (!appointmentID) return res.status(400).json({ message: "Invalid appointment id" });
		if (!Number.isInteger(adminUserID) || adminUserID < 1) return res.status(401).json({ message: "Missing admin session" });
		if (!cancellationReason) return res.status(400).json({ message: "Cancellation reason is required" });

		const appointment = await getUnderReviewAppointmentByID(appointmentID);
		if (!appointment) return res.status(404).json({ message: "Under-review appointment not found" });

		const result = await cancelAppointment({
			appointmentID,
			canceledByUserID: adminUserID,
			canceledByType: "ADMIN",
			cancellationReason,
		});

		res.json({ message: "Appointment canceled", result });
	} catch (err) {
		const status = Number(err?.status || 500);
		console.error("POST /api/appointment-issues/:appointmentID/cancel error:", err);
		res.status(status).json({ message: err instanceof Error ? err.message : "Failed to cancel under-review appointment" });
	}
});

export default router;
