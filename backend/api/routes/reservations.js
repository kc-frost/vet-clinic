import express from "express";
import { pool } from "../db.js";
import { requireAuth } from "../lib/authMiddleware.js";
import { handleImmediateNotificationsForNewAppointment } from "../lib/notifications.js";
import { getRule, REASON_RULES } from "../lib/reservationRules.js";
import { cancelAppointment } from "../lib/appointmentCancellationService.js";

const router = express.Router();

/*
	Store clinic hours as minutes since midnight so all scheduling
	calculations use one consistent unit.
*/
const OPEN_MINUTES = 9 * 60;
const CLOSE_MINUTES = 17 * 60;
const SLOT_STEP_MINUTES = 15;

function pad2(n) {

	/*
		Pad one-digit date or time numbers so values like 9 become 09.
	*/
	return String(n).padStart(2, "0");
}

function isValidDateOnly(dateStr) {
	/*
		Require strict YYYY-MM-DD format for date-only values.
	*/
	return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

function isValidTimeOnly(timeStr) {
	/*
		Require strict HH:MM format for time-only values.
	*/
	return /^\d{2}:\d{2}$/.test(timeStr);
}

function timeStrToMinutes(timeStr) {
	/*
		Convert a time like HH:MM into minutes since midnight so
		time math can be done numerically.
	*/
	const [hStr, mStr] = timeStr.split(":");
	const h = Number(hStr);
	const m = Number(mStr);

	if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
	return h * 60 + m;
}

function minutesToTimeStr(totalMinutes) {
	/*
		Convert minutes since midnight back into HH:MM string form.
	*/
	const h = Math.floor(totalMinutes / 60);
	const m = totalMinutes % 60;
	return `${pad2(h)}:${pad2(m)}`;
}

function formatSqlDateTime(dateStr, timeStr) {
	/*
		Build the MySQL DATETIME string format used by the database.
	*/
	return `${dateStr} ${timeStr}:00`;
}

function parseSlotId(slotId) {
	/*
		Read a generated slot ID and pull out just the appointment
		date and start time needed for booking.
	*/
	if (!slotId) return null;

	const str = String(slotId);
	const parts = str.split("_");
	if (parts.length < 4) return null;

	const date = parts[1];
	const startHHMM = parts[2];

	if (!isValidDateOnly(date)) return null;
	if (!/^\d{4}$/.test(startHHMM)) return null;

	const startTime = `${startHHMM.slice(0, 2)}:${startHHMM.slice(2, 4)}`;
	if (!isValidTimeOnly(startTime)) return null;

	return { date, startTime };
}

function addDays(dateStr, days) {
	/*
		Add a number of days to a YYYY-MM-DD string and return
		the resulting YYYY-MM-DD date.
	*/
	const [y, m, d] = dateStr.split("-").map((v) => Number(v));
	const dt = new Date(y, m - 1, d);
	dt.setDate(dt.getDate() + days);

	return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function getTodayDateStr() {
	/*
		Get today's local date in YYYY-MM-DD format.
	*/
	const now = new Date();
	return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function getNowMinutesOfDay() {
	/*
		Get the current local time as minutes since midnight.
	*/
	const now = new Date();
	return now.getHours() * 60 + now.getMinutes();
}

function minutesOverlap(aStart, aEnd, bStart, bEnd) {
	/*
		Check whether two [start, end) minute ranges overlap.
	*/
	return aStart < bEnd && bStart < aEnd;
}

function clampInt(value, min, max, fallback) {
	/*
		Parse an incoming value as an integer and clamp it into the
		allowed range. If parsing fails, use the fallback.
	*/
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;

	return Math.max(min, Math.min(max, Math.trunc(n)));
}

function buildSlotsForDay(dateStr, durationMinutes) {
	/*
		Generate every valid appointment start time for a day,
		only keeping starts whose full duration fits before close.
	*/
	const slots = [];

	for (let startMin = OPEN_MINUTES; startMin + durationMinutes <= CLOSE_MINUTES; startMin += SLOT_STEP_MINUTES) {
		slots.push({ date: dateStr, startMin });
	}

	return slots;
}

function sqlDateTimeToDate(value) {
	/*
		Convert a database DATETIME value into a JavaScript Date
		whether MySQL returned it as a Date or as a string.
	*/
	if (value instanceof Date) return value;

	const str = String(value || "");
	if (!str) return new Date(NaN);

	if (/^\d{4}-\d{2}-\d{2} /.test(str)) {
		return new Date(str.replace(" ", "T"));
	}

	return new Date(str);
}

function parseSqlDateTimeToMinutes(sqlDateTime) {
	/*
		Convert a SQL DATETIME value into minutes since midnight.
	*/
	const dt = sqlDateTimeToDate(sqlDateTime);

	if (!Number.isNaN(dt.getTime())) {
		return dt.getHours() * 60 + dt.getMinutes();
	}

	const timePart = String(sqlDateTime || "").split(" ")[1] || "";
	const pieces = timePart.split(":");
	const hh = Number(pieces[0]);
	const mm = Number(pieces[1]);

	if (!Number.isFinite(hh) || !Number.isFinite(mm)) return 0;
	return hh * 60 + mm;
}

function getDateOnly(sqlDateTime) {
	/*
		Pull just the YYYY-MM-DD date portion out of a SQL DATETIME value.
	*/
	const dt = sqlDateTimeToDate(sqlDateTime);

	if (!Number.isNaN(dt.getTime())) {
		return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
	}

	return String(sqlDateTime || "").split(" ")[0] || "";
}

async function withTransaction(workFn) {
	/*
		Run the provided database work inside one transaction so all
		changes either succeed together or roll back together.
	*/
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
			/*
				If rollback itself fails, there is nothing more this
				helper can safely do here.
			*/
		}
		throw err;
	} finally {
		conn.release();
	}
}

async function fetchInventoryByKeys(conn, itemKeys, isConsumable) {
	/*
		Load inventory rows for a list of item keys, filtered by whether
		they are consumable or non-consumable.
	*/
	if (!itemKeys.length) return [];

	const placeholders = itemKeys.map(() => "?").join(",");
	const sql = `select itemID, itemKey, isConsumable, quantity
		from inventory
		where itemKey in (${placeholders})
		and isConsumable = ?
		and coalesce(isActive, 1) = 1`;
	const [rows] = await conn.execute(sql, [...itemKeys, isConsumable ? 1 : 0]);

	return rows;
}

function buildItemKeyToRowMap(rows) {
	/*
		Build a fast lookup map so itemKey can directly return
		its matching inventory row.
	*/
	const map = new Map();

	for (const row of rows) {
		map.set(row.itemKey, row);
	}

	return map;
}

function validateRequiredInventory(rule, consumableRows, nonConsumableRows) {
	/*
		Before generating slots, make sure every required inventory item
		exists and currently has enough stock or capacity.
	*/
	for (const need of rule.consumables) {
		const row = consumableRows.get(need.itemKey);
		if (!row) return { ok: false, error: `missing consumable inventory itemKey ${need.itemKey}` };
		if (Number(row.quantity) < need.qty) return { ok: false, error: `not enough stock for ${need.itemKey}` };
	}

	for (const key of rule.nonConsumables) {
		const row = nonConsumableRows.get(key);
		if (!row) return { ok: false, error: `missing non-consumable inventory itemKey ${key}` };
		if (Number(row.quantity) < 1) return { ok: false, error: `no capacity for ${key}` };
	}

	return { ok: true, error: "" };
}

function parseTimeValueToMinutes(value) {
	/*
		Convert a MySQL TIME value like HH:MM or HH:MM:SS into
		minutes since midnight.
	*/
	const raw = String(value || "").trim();
	const match = raw.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);

	if (!match) return NaN;
	return Number(match[1]) * 60 + Number(match[2]);
}

function getDayOfWeekFromDateStr(dateStr) {
	/*
		Convert a YYYY-MM-DD date into the backend day numbering
		where Monday is 1 and Sunday is 7.
	*/
	const [y, m, d] = String(dateStr).split("-").map((v) => Number(v));
	const dt = new Date(y, m - 1, d);
	const jsDay = dt.getDay();

	return jsDay === 0 ? 7 : jsDay;
}

function expandRequiredStaffSlots(rule) {
	/*
		Expand a rule like qty: 2 into two separate required staff slots
		so one staff member cannot fill multiple required positions.
	*/
	const slots = [];

	for (const need of rule.requiredStaff || []) {
		const qty = Number(need.qty || 0);
		for (let i = 0; i < qty; i++) {
			slots.push({ roleKey: need.roleKey, slotIndex: i });
		}
	}

	return slots;
}

function shuffleArray(values) {
	/*
		Shuffle candidates so staff assignment is not always biased
		toward the same earliest IDs.
	*/
	const copy = [...values];

	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}

	return copy;
}

function buildStaffRoleMap(roleRows) {
	/*
		Build a map from roleKey to all staff IDs that can fill that role.
	*/
	const map = new Map();

	for (const row of roleRows) {
		const roleKey = String(row.roleKey || "");
		const staffID = Number(row.staffID);

		if (!roleKey || !Number.isFinite(staffID)) continue;
		if (!map.has(roleKey)) map.set(roleKey, []);
		map.get(roleKey).push(staffID);
	}

	return map;
}

function buildStaffAvailabilityMap(rows) {
	/*
		Build a map of each staff member's weekly availability blocks
		organized by day of week.
	*/
	const map = new Map();

	for (const row of rows) {
		const staffID = Number(row.staffID);
		const dayOfWeek = Number(row.dayOfWeek);
		const startMin = parseTimeValueToMinutes(row.startTime);
		const endMin = parseTimeValueToMinutes(row.endTime);

		if (!Number.isFinite(staffID) || !Number.isFinite(dayOfWeek)) continue;
		if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) continue;

		if (!map.has(staffID)) map.set(staffID, new Map());
		map.get(staffID).set(dayOfWeek, { startMin, endMin });
	}

	return map;
}

function buildAppointmentStaffMap(rows) {
	/*
		Build a map from appointmentID to the staff members already
		assigned to that appointment.
	*/
	const map = new Map();

	for (const row of rows) {
		const appointmentID = Number(row.appointmentID);
		const staffID = Number(row.staffID);

		if (!Number.isFinite(appointmentID) || !Number.isFinite(staffID)) continue;
		if (!map.has(appointmentID)) map.set(appointmentID, []);
		map.get(appointmentID).push(staffID);
	}

	return map;
}

function staffHasWeeklyAvailability(staffAvailabilityById, staffID, dayOfWeek, startMin, endMin) {
	/*
		A staff member is only usable if their saved weekly availability
		covers the full requested appointment time window.
	*/
	const byDay = staffAvailabilityById.get(staffID);
	if (!byDay) return false;

	const block = byDay.get(dayOfWeek);
	if (!block) return false;

	return block.startMin <= startMin && block.endMin >= endMin;
}

function appointmentHasStaffOverlap(appt, assignedStaffIds, staffID, startMin, endMin) {
	/*
		Check whether one staff member is already assigned to another
		overlapping appointment.
	*/
	if (!assignedStaffIds.includes(staffID)) return false;

	const apptStartMin = parseSqlDateTimeToMinutes(appt.date);
	const apptEndMin = apptStartMin + Number(appt.durationMinutes || 0);

	return minutesOverlap(apptStartMin, apptEndMin, startMin, endMin);
}

function findRandomStaffAssignment(rule, roleToStaffIds, staffAvailabilityById, dayOfWeek, dayAppts, appointmentStaffByAppt, startMin, endMin) {
	/*
		Try to find one complete valid set of staff assignments for
		the requested appointment window.
	*/
	const requiredSlots = expandRequiredStaffSlots(rule);
	if (!requiredSlots.length) return null;

	const preparedSlots = requiredSlots.map((slot, index) => {
		const rawCandidates = roleToStaffIds.get(slot.roleKey) || [];

		const filteredCandidates = rawCandidates.filter((staffID) => {
			/*
				Reject staff who are not available for the full weekly
				time block on this day.
			*/
			if (!staffHasWeeklyAvailability(staffAvailabilityById, staffID, dayOfWeek, startMin, endMin)) return false;

			/*
				Reject staff who are already assigned to an overlapping
				appointment on that same day.
			*/
			for (const appt of dayAppts) {
				const assignedStaffIds = appointmentStaffByAppt.get(Number(appt.appointmentID)) || [];
				if (appointmentHasStaffOverlap(appt, assignedStaffIds, staffID, startMin, endMin)) return false;
			}

			return true;
		});

		return {
			roleKey: slot.roleKey,
			index,
			candidates: shuffleArray(filteredCandidates),
			randomTie: Math.random(),
		};
	});

	/*
		Assign the hardest slots first so the backtracking search
		fails sooner when no valid combination exists.
	*/
	preparedSlots.sort((a, b) => {
		if (a.candidates.length !== b.candidates.length) return a.candidates.length - b.candidates.length;
		return a.randomTie - b.randomTie;
	});

	if (preparedSlots.some((slot) => slot.candidates.length === 0)) return null;

	const usedStaffIds = new Set();

	function assign(slotIndex) {
		/*
			If all required slots were filled, return the full assignment.
		*/
		if (slotIndex >= preparedSlots.length) return [];

		const slot = preparedSlots[slotIndex];

		for (const staffID of slot.candidates) {
			/*
				Do not allow one person to fill multiple required slots
				on the same appointment.
			*/
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

function findFreeResourceId(resourceIds, busyById, startBucket, bucketCount) {
	/*
		Find the first resource whose entire bucket window is free.
		This is used for rooms and any similar bucket-tracked resource.
	*/
	for (const id of resourceIds) {
		const busy = busyById.get(id);
		if (!busy) continue;

		let ok = true;

		for (let i = 0; i < bucketCount; i++) {
			if (busy[startBucket + i]) {
				ok = false;
				break;
			}
		}

		if (ok) return id;
	}

	return null;
}

function bucketIndexFromMinutes(minutes) {
	/*
		Convert a minute-of-day value into its 15-minute bucket index
		relative to clinic opening time.
	*/
	return Math.floor((minutes - OPEN_MINUTES) / SLOT_STEP_MINUTES);
}

function bucketCountFromDuration(durationMinutes) {
	/*
		Convert an appointment duration into the number of 15-minute
		buckets it occupies, rounding up when needed.
	*/
	return Math.ceil(durationMinutes / SLOT_STEP_MINUTES);
}

function isStartAligned(minutes) {
	/*
		Only allow appointment starts exactly on the 15-minute grid.
	*/
	return minutes % SLOT_STEP_MINUTES === 0;
}

function getUserIdFromSession(req) {
	/*
		Read the authenticated user ID from whichever session shape
		the current auth implementation is using.
	*/
	const sessionUser = req.session?.user || null;
	const raw = sessionUser?.userID ?? req.session?.userID ?? null;

	if (raw === null || raw === undefined || raw === "") return null;

	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) return null;

	return n;
}

function resolveUserIdFromRequest(req) {
	/*
		Only trust the logged-in session user ID for reservation routes.
	*/
	return getUserIdFromSession(req);
}

router.get("/profile", requireAuth, async (req, res) => {
	try {
		/*
			Use the authenticated session user only for profile autofill.
		*/
		const userID = resolveUserIdFromRequest(req);

		if (!userID) {
			res.status(400).json({ error: "missing userID" });
			return;
		}

		/*
			Load the current user's saved profile fields so the reservation
			wizard can prefill owner details.
		*/
		const [rows] = await pool.execute(
			`select userID, email, legalFirstName, legalLastName, phone, addressLine1, city, state, zipCode
			 from customer
			 where userID = ?`,
			[userID]
		);

		if (!rows.length) {
			res.status(404).json({ error: "user not found" });
			return;
		}

		const r = rows[0];
		res.json({
			userID: Number(r.userID),
			email: String(r.email || ""),
			legalFirstName: r.legalFirstName || "",
			legalLastName: r.legalLastName || "",
			phone: r.phone || "",
			addressLine1: r.addressLine1 || "",
			city: r.city || "",
			state: r.state || "",
			zipCode: r.zipCode || "",
		});
	} catch (err) {
		console.error("profile error", err);
		res.status(500).json({ error: "failed to fetch profile" });
	}
});

router.get("/pets", requireAuth, async (req, res) => {
	try {
		/*
			Use the authenticated session user only when loading pets
			for the reservation wizard dropdown
		*/
		const userID = resolveUserIdFromRequest(req);

		if (!userID) {
			res.status(400).json({ error: "missing userID" });
			return;
		}

		/*
			Load all saved pets for this user in alphabetical order
		*/
		const [rows] = await pool.execute(
			`select
				petID,
				petName,
				petType,
				breed,
				petSex,
				spayedNeutered,
				age,
				weight,
				height,
				behavior,
				currentMedications,
				medicationHistory,
				knownAllergies,
				currentConditions,
				pastInjuriesConditions,
				vaccinationsUpToDate,
				heartwormPreventionCurrent
			 from pet
			 where userID = ?
			 order by petName asc`,
			[userID]
		);

		res.json({
			userID,
			pets: rows.map((p) => ({
				petID: Number(p.petID),
				petName: p.petName || "",
				petType: p.petType || "",
				breed: p.breed || "",
				petSex: p.petSex || "",
				spayedNeutered: p.spayedNeutered || "",
				age: p.age === null || p.age === undefined ? null : Number(p.age),
				weight: p.weight === null || p.weight === undefined ? null : Number(p.weight),
				height: p.height === null || p.height === undefined ? null : Number(p.height),
				behavior: p.behavior || "",
				currentMedications: p.currentMedications || "",
				medicationHistory: p.medicationHistory || "",
				knownAllergies: p.knownAllergies || "",
				currentConditions: p.currentConditions || "",
				pastInjuriesConditions: p.pastInjuriesConditions || "",
				vaccinationsUpToDate: p.vaccinationsUpToDate || "",
				heartwormPreventionCurrent: p.heartwormPreventionCurrent || "",
			})),
		});
	} catch (err) {
		console.error("pets error", err);
		res.status(500).json({ error: "failed to fetch pets" });
	}
});

router.patch("/pets/:petID", requireAuth, async (req, res) => {
	try {
		/*
			Only allow the logged-in user to update one of their own pets
		*/
		const userID = resolveUserIdFromRequest(req);
		const petID = Number(req.params.petID);

		if (!userID) {
			res.status(400).json({ error: "missing userID" });
			return;
		}

		if (!Number.isFinite(petID) || petID <= 0) {
			res.status(400).json({ error: "invalid petID" });
			return;
		}

		const body = req.body || {};

		/*
			Normalize all incoming editable pet fields before saving
		*/
		const petName = String(body.petName || "");
		const petType = String(body.petType || "");
		const breed = String(body.breed || "");
		const petSex = String(body.petSex || "");
		const spayedNeutered = String(body.spayedNeutered || "");
		const age = body.age === "" || body.age === null || body.age === undefined ? null : Number(body.age);
		const currentMedications = String(body.currentMedications || "");
		const medicationHistory = String(body.medicationHistory || "");
		const knownAllergies = String(body.knownAllergies || "");
		const currentConditions = String(body.currentConditions || "");
		const pastInjuriesConditions = String(body.pastInjuriesConditions || "");
		const vaccinationsUpToDate = String(body.vaccinationsUpToDate || "");
		const heartwormPreventionCurrent = String(body.heartwormPreventionCurrent || "");

		/*
			Update the pet only if it belongs to the currently logged-in user
		*/
		const [result] = await pool.execute(
			`update pet set
				petName = ?,
				petType = ?,
				breed = ?,
				petSex = ?,
				spayedNeutered = ?,
				age = ?,
				currentMedications = ?,
				medicationHistory = ?,
				knownAllergies = ?,
				currentConditions = ?,
				pastInjuriesConditions = ?,
				vaccinationsUpToDate = ?,
				heartwormPreventionCurrent = ?
			where petID = ? and userID = ?`,
			[
				petName,
				petType,
				breed,
				petSex,
				spayedNeutered,
				age,
				currentMedications,
				medicationHistory,
				knownAllergies,
				currentConditions,
				pastInjuriesConditions,
				vaccinationsUpToDate,
				heartwormPreventionCurrent,
				petID,
				userID,
			]
		);

		if (!result.affectedRows) {
			res.status(404).json({ error: "pet not found" });
			return;
		}

		/*
			Re-read the updated pet so the response matches the exact
			current database state
		*/
		const [rows] = await pool.execute(
			`select
				petID,
				petName,
				petType,
				breed,
				petSex,
				spayedNeutered,
				age,
				weight,
				height,
				behavior,
				currentMedications,
				medicationHistory,
				knownAllergies,
				currentConditions,
				pastInjuriesConditions,
				vaccinationsUpToDate,
				heartwormPreventionCurrent
			 from pet
			 where petID = ? and userID = ?`,
			[petID, userID]
		);

		if (!rows.length) {
			res.status(404).json({ error: "pet not found" });
			return;
		}

		const p = rows[0];
		res.json({
			petID: Number(p.petID),
			petName: p.petName || "",
			petType: p.petType || "",
			breed: p.breed || "",
			petSex: p.petSex || "",
			spayedNeutered: p.spayedNeutered || "",
			age: p.age === null || p.age === undefined ? null : Number(p.age),
			weight: p.weight === null || p.weight === undefined ? null : Number(p.weight),
			height: p.height === null || p.height === undefined ? null : Number(p.height),
			behavior: p.behavior || "",
			currentMedications: p.currentMedications || "",
			medicationHistory: p.medicationHistory || "",
			knownAllergies: p.knownAllergies || "",
			currentConditions: p.currentConditions || "",
			pastInjuriesConditions: p.pastInjuriesConditions || "",
			vaccinationsUpToDate: p.vaccinationsUpToDate || "",
			heartwormPreventionCurrent: p.heartwormPreventionCurrent || "",
		});
	} catch (err) {
		console.error("patch pet error", err);
		res.status(500).json({ error: "failed to update pet profile" });
	}
});

router.get("/availability", requireAuth, async (req, res) => {
	try {
		/*
			Resolve the appointment rule from the incoming reason key.
		*/
		const reasonKeyRaw = req.query.reasonKey;
		const rule = getRule(reasonKeyRaw);

		if (!rule) {
			res.status(400).json({ error: "invalid reasonKey" });
			return;
		}

		/*
			If a petID was provided, validate it so pet double-booking
			can also be checked during slot generation.
		*/
		const bookingPetIDRaw = req.query.petID;
		const bookingPetID = bookingPetIDRaw === null || bookingPetIDRaw === undefined || bookingPetIDRaw === "" ? null : Number(bookingPetIDRaw);
		const ignoreAppointmentIDRaw = req.query.ignoreAppointmentID;
		const ignoreAppointmentID =
			ignoreAppointmentIDRaw === null || ignoreAppointmentIDRaw === undefined || ignoreAppointmentIDRaw === "" ? null : Number(ignoreAppointmentIDRaw);

		if (bookingPetIDRaw !== null && bookingPetIDRaw !== undefined && bookingPetIDRaw !== "" && (!Number.isFinite(bookingPetID) || bookingPetID <= 0)) {
			res.status(400).json({ error: "invalid petID" });
			return;
		}

		if (
			ignoreAppointmentIDRaw !== null &&
			ignoreAppointmentIDRaw !== undefined &&
			ignoreAppointmentIDRaw !== "" &&
			(!Number.isFinite(ignoreAppointmentID) || ignoreAppointmentID <= 0)
		) {
			res.status(400).json({ error: "invalid ignoreAppointmentID" });
			return;
		}

		/*
			Use the requested date range if present, otherwise default
			to a forward-looking window starting today.
		*/
		const days = clampInt(req.query.days, 1, 120, 30);
		let startDate = String(req.query.startDate || "");
		let endDate = String(req.query.endDate || "");

		if (!startDate || !endDate) {
			startDate = getTodayDateStr();
			endDate = addDays(startDate, days - 1);
		}

		if (!isValidDateOnly(startDate) || !isValidDateOnly(endDate)) {
			res.status(400).json({ error: "invalid startDate or endDate" });
			return;
		}

		const conn = await pool.getConnection();

		try {
			/*
				Load the required inventory keys for this appointment type.
			*/
			const requiredConsumableKeys = rule.consumables.map((c) => c.itemKey);
			const requiredNonConsumableKeys = rule.nonConsumables;

			/*
				Load all staff role rows and organize them by role so we know
				who could possibly fill each required appointment role.
			*/
			const [staffRoleRows] = await conn.execute(
				`select sr.staffID, sr.roleKey
				 from staff_role sr
				 inner join staff s
					on s.staffID = sr.staffID
				 inner join customer c
					on c.userID = s.userID
				 where coalesce(s.isActive, 1) = 1
				 and coalesce(c.isDeactivated, 0) = 0
				 order by sr.staffID asc, sr.roleKey asc`
			);
			const roleToStaffIds = buildStaffRoleMap(staffRoleRows);

			/*
				Load the saved weekly availability blocks for all staff.
			*/
			const [staffAvailabilityRows] = await conn.execute(
				`select sa.staffID, sa.dayOfWeek, sa.startTime, sa.endTime
				 from staff_availability sa
				 inner join staff s
					on s.staffID = sa.staffID
				 inner join customer c
					on c.userID = s.userID
				 where coalesce(s.isActive, 1) = 1
				 and coalesce(c.isDeactivated, 0) = 0`
			);
			const staffAvailabilityById = buildStaffAvailabilityMap(staffAvailabilityRows);

			/*
				If even one required role has no matching staff at all,
				then this appointment type currently has no possible slots.
			*/
			const requiredRoleKeys = [...new Set((rule.requiredStaff || []).map((need) => need.roleKey))];
			if (requiredRoleKeys.some((roleKey) => !(roleToStaffIds.get(roleKey) || []).length)) {
				res.json({ ok: true, reasonKey: rule.reasonKey, durationMinutes: rule.durationMinutes, timezone: "local", range: { startDate, days }, slots: [] });
				return;
			}

			/*
				Load all rooms of the needed type for this appointment rule.
			*/
			const [roomRows] = await conn.execute(
				`select roomNumber
				 from rooms
				 where roomType = ?
				 and coalesce(isActive, 1) = 1
				 order by roomNumber asc`,
				[rule.roomType]
			);
			const roomNumbers = roomRows.map((r) => Number(r.roomNumber));

			if (!roomNumbers.length) {
				res.json({ ok: true, reasonKey: rule.reasonKey, durationMinutes: rule.durationMinutes, timezone: "local", range: { startDate, days }, slots: [] });
				return;
			}

			/*
				Load required consumable and non-consumable inventory rows
				and reject slot generation if required items are missing.
			*/
			const consumableRows = buildItemKeyToRowMap(await fetchInventoryByKeys(conn, requiredConsumableKeys, true));
			const nonConsumableRows = buildItemKeyToRowMap(await fetchInventoryByKeys(conn, requiredNonConsumableKeys, false));
			const invCheck = validateRequiredInventory(rule, consumableRows, nonConsumableRows);

			if (!invCheck.ok) {
				res.json({ ok: true, reasonKey: rule.reasonKey, durationMinutes: rule.durationMinutes, timezone: "local", range: { startDate, days }, slots: [] });
				return;
			}

			/*
				Load all appointments that overlap the requested date range
				so conflicts can be computed day by day.
			*/
			const rangeStart = `${startDate} 00:00:00`;
			const endExclusive = addDays(endDate, 1);
			const rangeEndExclusive = `${endExclusive} 00:00:00`;

			const [apptRows] = await conn.execute(
				`select appointmentID, userID, petID, roomNumber, reasonKey, date, durationMinutes
				 from appointment
				 where date >= ? and date < ?
				 and coalesce(isCanceled, 0) = 0
				 and (? is null or appointmentID <> ?)`,
				[rangeStart, rangeEndExclusive, ignoreAppointmentID, ignoreAppointmentID]
			);

			/*
				Also strip the ignored appointment in application code before any
				busy maps get built. This keeps reschedule availability from ever
				counting the appointment against itself even if the SQL exclusion
				behaves awkwardly.
			*/
			const filteredApptRows = ignoreAppointmentID
				? apptRows.filter((row) => Number(row.appointmentID) !== ignoreAppointmentID)
				: apptRows;

			/*
				Load the staff assignments already attached to those
				existing appointments.
			*/
			const appointmentIds = filteredApptRows.map((row) => Number(row.appointmentID)).filter((id) => Number.isFinite(id));
			let appointmentStaffRows = [];

			if (appointmentIds.length) {
				const placeholders = appointmentIds.map(() => "?").join(",");
				const [rows] = await conn.execute(
					`select appointmentID, staffID, assignedRoleKey
					 from appointment_staff
					 where appointmentID in (${placeholders})`,
					appointmentIds
				);
				appointmentStaffRows = rows;
			}

			const appointmentStaffByAppt = buildAppointmentStaffMap(appointmentStaffRows);

			/*
				Group appointments by their date-only value so each day can
				be processed independently.
			*/
			const apptsByDate = new Map();

			for (const row of filteredApptRows) {
				const dateOnly = getDateOnly(row.date);
				if (!apptsByDate.has(dateOnly)) apptsByDate.set(dateOnly, []);
				apptsByDate.get(dateOnly).push(row);
			}

			const slots = [];
			const bucketCount = bucketCountFromDuration(rule.durationMinutes);
			const today = getTodayDateStr();
			const nowMinutes = getNowMinutesOfDay();

			let curDate = startDate;

			while (curDate <= endDate) {
				/*
					Prepare all conflict tracking structures for this one day.
				*/
				const dayAppts = apptsByDate.get(curDate) || [];
				const dayOfWeek = getDayOfWeekFromDateStr(curDate);

				const roomBusy = new Map();
				for (const rn of roomNumbers) roomBusy.set(rn, Array(64).fill(false));

				const petBusy = bookingPetID ? Array(64).fill(false) : null;

				const equipBusyCount = new Map();
				for (const key of requiredNonConsumableKeys) equipBusyCount.set(key, Array(64).fill(0));

				/*
					Mark buckets already occupied by existing appointments.
				*/
				for (const appt of dayAppts) {
					const apptStartMin = parseSqlDateTimeToMinutes(appt.date);
					const apptEndMin = apptStartMin + Number(appt.durationMinutes || 0);
					const startClamped = Math.max(apptStartMin, OPEN_MINUTES);
					const endClamped = Math.min(apptEndMin, CLOSE_MINUTES);

					if (endClamped <= startClamped) continue;

					const startBucket = bucketIndexFromMinutes(startClamped);
					const endBucketExclusive = Math.ceil((endClamped - OPEN_MINUTES) / SLOT_STEP_MINUTES);

					const roomArr = roomBusy.get(Number(appt.roomNumber));
					if (roomArr) {
						for (let b = startBucket; b < endBucketExclusive; b++) roomArr[b] = true;
					}

					if (petBusy && Number(appt.petID) === bookingPetID) {
						for (let b = startBucket; b < endBucketExclusive; b++) petBusy[b] = true;
					}

					const apptRule = getRule(appt.reasonKey);
					if (!apptRule) continue;

					for (const equipKey of apptRule.nonConsumables || []) {
						const arr = equipBusyCount.get(equipKey);
						if (!arr) continue;
						for (let b = startBucket; b < endBucketExclusive; b++) arr[b] += 1;
					}
				}

				/*
					Generate all possible starts for the day and then filter
					them down by pet, room, equipment, and staff availability.
				*/
				const dayCandidates = buildSlotsForDay(curDate, rule.durationMinutes);

				for (const c of dayCandidates) {
					const startMin = c.startMin;
					const startBucket = bucketIndexFromMinutes(startMin);

					/*
						Do not offer past times on the current day.
					*/
					if (curDate === today && startMin < nowMinutes) continue;

					/*
						If a pet was selected, reject any slot where that same pet
						already has an overlapping appointment.
					*/
					if (petBusy) {
						let petOk = true;

						for (let i = 0; i < bucketCount; i++) {
							if (petBusy[startBucket + i]) {
								petOk = false;
								break;
							}
						}

						if (!petOk) continue;
					}

					/*
						Reject the slot if no room stays free across the full
						appointment bucket window.
					*/
					const freeRoomNumber = findFreeResourceId(roomNumbers, roomBusy, startBucket, bucketCount);
					if (!freeRoomNumber) continue;

					/*
						Reject the slot if any required non-consumable item would
						exceed its allowed capacity during this time window.
					*/
					let equipOk = true;

					for (const equipKey of requiredNonConsumableKeys) {
						const capRow = nonConsumableRows.get(equipKey);
						const capacity = Number(capRow?.quantity || 0);
						const usageArr = equipBusyCount.get(equipKey) || [];

						for (let i = 0; i < bucketCount; i++) {
							if ((usageArr[startBucket + i] || 0) >= capacity) {
								equipOk = false;
								break;
							}
						}

						if (!equipOk) break;
					}

					if (!equipOk) continue;

					/*
						Try to find a full staff assignment for this slot.
					*/
					const staffAssignment = findRandomStaffAssignment(rule, roleToStaffIds, staffAvailabilityById, dayOfWeek, dayAppts, appointmentStaffByAppt, startMin, startMin + rule.durationMinutes);
					if (!staffAssignment) continue;

					/*
						Build the final slot object returned to the frontend.
					*/
					const startTime = minutesToTimeStr(startMin);
					const endTime = minutesToTimeStr(startMin + rule.durationMinutes);
					const slotId = `slot_${curDate}_${startTime.replace(":", "")}_${endTime.replace(":", "")}`;

					slots.push({
						slotId,
						date: curDate,
						startTime,
						endTime,
						startDateTime: formatSqlDateTime(curDate, startTime),
						endDateTime: formatSqlDateTime(curDate, endTime),
						staffID: Number(staffAssignment[0]?.staffID || 0),
						roomNumber: freeRoomNumber,
					});
				}

				curDate = addDays(curDate, 1);
			}

			res.json({ ok: true, reasonKey: rule.reasonKey, durationMinutes: rule.durationMinutes, timezone: "local", range: { startDate, days }, slots });
		} finally {
			conn.release();
		}
	} catch (err) {
		console.error("availability error", err);
		res.status(500).json({ error: "failed to fetch availability" });
	}
});

function pickFormData(body) {
	/*
		Support either a flattened request body or a nested
		{ formData: {...} } payload shape.
	*/
	if (body && typeof body.formData === "object" && body.formData) return body.formData;
	return body || {};
}

function stringOrEmpty(v) {
	/*
		Normalize nullish values into empty strings so string operations
		do not crash later.
	*/
	if (v === null || v === undefined) return "";
	return String(v);
}

function trimOrNull(v) {
	/*
		Trim a value and return null if it ends up empty.
	*/
	const s = stringOrEmpty(v).trim();
	return s ? s : null;
}

function requireField(value, fieldName, errors) {
	/*
		Require a non-empty string field and record its field name
		if it is missing or blank.
	*/
	const s = stringOrEmpty(value).trim();
	if (!s) errors.push(fieldName);
	return s;
}

function requireBoolean(value, fieldName, errors) {
	/*
		Require a real boolean value rather than allowing missing
		or ambiguous truthy/falsy input.
	*/
	if (value === true) return true;
	if (value === false) return false;

	errors.push(fieldName);
	return false;
}

function toIntOrNull(value) {
	/*
		Parse a whole number when present, but allow null for
		missing or blank values.
	*/
	if (value === "" || value === null || value === undefined) return null;

	const n = Number(value);
	if (!Number.isFinite(n)) return null;

	return Math.trunc(n);
}

async function resolveUserId(conn, req) {
	/*
		Resolve and verify the logged-in user's userID against the database
		before allowing booking or cancellation work.
	*/
	const raw = req?.session?.userID;

	if (raw === null || raw === undefined || raw === "") return null;

	const userID = Number(raw);
	if (!Number.isFinite(userID) || userID <= 0) return null;

	const [rows] = await conn.execute(
		"select userID from customer where userID = ? and coalesce(isDeactivated, 0) = 0",
		[userID]
	);
	if (!rows.length) return null;

	return userID;
}

async function selectAvailableStaffAssignment(conn, rule, appointmentDate, startSql, endSql) {
	/*
		Inside the booking transaction, pick one full valid staff
		assignment set for the requested appointment window.
	*/
	const dayOfWeek = getDayOfWeekFromDateStr(appointmentDate);
	const startMin = parseSqlDateTimeToMinutes(startSql);
	const endMin = parseSqlDateTimeToMinutes(endSql);

	const [staffRoleRows] = await conn.execute(
		`select sr.staffID, sr.roleKey
		 from staff_role sr
		 inner join staff s
			on s.staffID = sr.staffID
		 inner join customer c
			on c.userID = s.userID
		 where coalesce(s.isActive, 1) = 1
		 and coalesce(c.isDeactivated, 0) = 0
		 order by sr.staffID asc, sr.roleKey asc`
	);
	const roleToStaffIds = buildStaffRoleMap(staffRoleRows);

	const [staffAvailabilityRows] = await conn.execute(
		`select sa.staffID, sa.dayOfWeek, sa.startTime, sa.endTime
		 from staff_availability sa
		 inner join staff s
			on s.staffID = sa.staffID
		 inner join customer c
			on c.userID = s.userID
		 where sa.dayOfWeek = ?
		 and coalesce(s.isActive, 1) = 1
		 and coalesce(c.isDeactivated, 0) = 0`,
		[dayOfWeek]
	);
	const staffAvailabilityById = buildStaffAvailabilityMap(staffAvailabilityRows);

	/*
		Lock overlapping appointments so assignment stays safe even if
		multiple booking attempts happen at the same time.
	*/
	const [apptRows] = await conn.execute(
		`select appointmentID, date, durationMinutes
		 from appointment
		 where date < ?
		 and date_add(date, interval durationMinutes minute) > ?
		 and coalesce(isCanceled, 0) = 0
		 for update`,
		[endSql, startSql]
	);

	const appointmentIds = apptRows.map((row) => Number(row.appointmentID)).filter((id) => Number.isFinite(id));
	let appointmentStaffRows = [];

	if (appointmentIds.length) {
		const placeholders = appointmentIds.map(() => "?").join(",");
		const [rows] = await conn.execute(
			`select appointmentID, staffID, assignedRoleKey
			 from appointment_staff
			 where appointmentID in (${placeholders})
			 for update`,
			appointmentIds
		);
		appointmentStaffRows = rows;
	}

	const appointmentStaffByAppt = buildAppointmentStaffMap(appointmentStaffRows);

	return findRandomStaffAssignment(rule, roleToStaffIds, staffAvailabilityById, dayOfWeek, apptRows, appointmentStaffByAppt, startMin, endMin);
}

async function insertAppointmentStaffRows(conn, appointmentID, assignments) {
	/*
		Store one row per staff member assigned to the appointment.
	*/
	for (const assignment of assignments) {
		await conn.execute(
			`insert into appointment_staff (appointmentID, staffID, assignedRoleKey)
			 values (?,?,?)`,
			[appointmentID, assignment.staffID, assignment.assignedRoleKey]
		);
	}
}

async function selectAvailableRoom(conn, roomType, startSql, endSql) {
	/*
		Find one room of the needed type that has no overlapping
		appointment during the requested time window.
	*/
	const [rows] = await conn.execute(
		`select r.roomNumber
		 from rooms r
		 where r.roomType = ?
		 and coalesce(r.isActive, 1) = 1
		 and not exists (
			select 1 from appointment a
			where a.roomNumber = r.roomNumber
			and a.date < ?
			and date_add(a.date, interval a.durationMinutes minute) > ?
			and coalesce(a.isCanceled, 0) = 0
		 )
		 order by r.roomNumber asc
		 limit 1
		 for update`,
		[roomType, endSql, startSql]
	);

	if (!rows.length) return null;
	return Number(rows[0].roomNumber);
}

async function checkNonConsumableCapacityForInterval(conn, rule, startSql, endSql) {
	/*
		Check whether every required non-consumable item has enough
		capacity for the full requested interval.
	*/
	if (!rule.nonConsumables.length) return { ok: true, error: "" };

	const neededKeys = rule.nonConsumables;
	const placeholders = neededKeys.map(() => "?").join(",");

	/*
		Lock the needed inventory rows so capacity cannot change while
		this booking transaction is still deciding.
	*/
	const [invRows] = await conn.execute(
		`select itemID, itemKey, quantity from inventory
		 where isConsumable = 0
		 and itemKey in (${placeholders})
		 and coalesce(isActive, 1) = 1
		 for update`,
		neededKeys
	);

	const capMap = buildItemKeyToRowMap(invRows);

	for (const key of neededKeys) {
		const row = capMap.get(key);
		if (!row) return { ok: false, error: `missing non-consumable inventory itemKey ${key}` };
		if (Number(row.quantity) < 1) return { ok: false, error: `no capacity for ${key}` };
	}

	/*
		Lock overlapping appointments so equipment usage counts stay
		consistent during this same booking transaction.
	*/
	const [overlapRows] = await conn.execute(
		`select reasonKey, date, durationMinutes from appointment
		 where date < ?
		 and date_add(date, interval durationMinutes minute) > ?
		 and coalesce(isCanceled, 0) = 0
		 for update`,
		[endSql, startSql]
	);

	const startDt = new Date(startSql.replace(" ", "T"));
	const endDt = new Date(endSql.replace(" ", "T"));
	const intervalMinutes = Math.round((endDt.getTime() - startDt.getTime()) / 60000);
	const bucketCount = bucketCountFromDuration(intervalMinutes);

	function bucketWindow(i) {
		/*
			Build the exact start and end time of one 15-minute bucket
			inside the requested interval.
		*/
		const bStart = new Date(startDt.getTime() + i * SLOT_STEP_MINUTES * 60000);
		const bEnd = new Date(bStart.getTime() + SLOT_STEP_MINUTES * 60000);
		return { bStart, bEnd };
	}

	for (const equipKey of neededKeys) {
		const capacity = Number(capMap.get(equipKey).quantity || 0);

		for (let i = 0; i < bucketCount; i++) {
			const { bStart, bEnd } = bucketWindow(i);

			let used = 0;

			for (const appt of overlapRows) {
				const apptRule = getRule(appt.reasonKey);
				if (!apptRule) continue;
				if (!(apptRule.nonConsumables || []).includes(equipKey)) continue;

				const apptStart = sqlDateTimeToDate(appt.date);
				const apptEnd = new Date(apptStart.getTime() + Number(appt.durationMinutes) * 60000);

				if (bStart < apptEnd && apptStart < bEnd) used += 1;
			}

			/*
				The new appointment would add one more usage, so existing
				usage must stay strictly below capacity in every bucket.
			*/
			if (used >= capacity) {
				return { ok: false, error: `no capacity for ${equipKey} in that time window` };
			}
		}
	}

	return { ok: true, error: "" };
}

async function reserveConsumables(conn, rule) {
	/*
		Reserve and decrement consumable stock inside the transaction
		so double-booking the same stock cannot happen.
	*/
	if (!rule.consumables.length) return { ok: true, error: "", reserved: [] };

	const itemKeys = rule.consumables.map((c) => c.itemKey);
	const placeholders = itemKeys.map(() => "?").join(",");

	const [rows] = await conn.execute(
		`select itemID, itemKey, quantity from inventory
		 where isConsumable = 1
		 and itemKey in (${placeholders})
		 and coalesce(isActive, 1) = 1
		 for update`,
		itemKeys
	);

	const map = buildItemKeyToRowMap(rows);

	for (const need of rule.consumables) {
		const row = map.get(need.itemKey);
		if (!row) return { ok: false, error: `missing consumable inventory itemKey ${need.itemKey}`, reserved: [] };
		if (Number(row.quantity) < need.qty) return { ok: false, error: `not enough stock for ${need.itemKey}`, reserved: [] };
	}

	/*
		Now that stock checks passed, decrement inventory for each
		required consumable item.
	*/
	for (const need of rule.consumables) {
		await conn.execute(
			"update inventory set quantity = quantity - ? where itemKey = ? and isConsumable = 1 and coalesce(isActive, 1) = 1",
			[need.qty, need.itemKey]
		);
	}

	const reserved = rule.consumables.map((need) => ({
		itemID: Number(map.get(need.itemKey).itemID),
		itemKey: need.itemKey,
		qtyUsed: need.qty,
	}));

	return { ok: true, error: "", reserved };
}

async function insertAppointmentForm(conn, appointmentID, form) {
	/*
		Store a snapshot of the submitted reservation form so the exact
		booking-time information is preserved even if profiles change later
	*/
	const sql = `insert into appointment_form (
		appointmentID,
		legalFirstName,
		legalLastName,
		email,
		phone,
		addressLine1,
		city,
		state,
		zipCode,
		petName,
		petType,
		breed,
		petSex,
		spayedNeutered,
		petAge,
		reasonDetails,
		currentMedications,
		medicationHistory,
		knownAllergies,
		currentConditions,
		pastInjuriesConditions,
		vaccinationsUpToDate,
		heartwormPreventionCurrent,
		groomingDyeStyleKey,
		groomingReferencePhotoPath,
		groomingStyleNotes,
		insuranceProvider,
		insuranceMemberId,
		consentToFormInfo
	) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

	const params = [
		appointmentID,
		form.legalFirstName,
		form.legalLastName,
		form.email,
		form.phone,
		form.addressLine1,
		form.city,
		form.state,
		form.zipCode,
		form.petName,
		form.petType,
		form.breed,
		form.petSex,
		form.spayedNeutered,
		form.petAge,
		form.reasonDetails || "",
		form.currentMedications,
		form.medicationHistory,
		form.knownAllergies,
		form.currentConditions,
		form.pastInjuriesConditions,
		form.vaccinationsUpToDate,
		form.heartwormPreventionCurrent,
		form.groomingDyeStyleKey || null,
		form.groomingReferencePhotoPath || null,
		form.groomingStyleNotes || null,
		form.insuranceProvider || null,
		form.insuranceMemberId || null,
		form.consentToFormInfo ? 1 : 0,
	];

	await conn.execute(sql, params);
}

async function maybeFillCustomerProfileIfEmpty(conn, userID, form) {
	/*
		Use booking form data to fill in missing customer profile fields,
		but never overwrite profile fields that already have values.
	*/
	const [rows] = await conn.execute(
		`select legalFirstName, legalLastName, phone, addressLine1, city, state, zipCode
		 from customer where userID = ?
		 for update`,
		[userID]
	);

	if (!rows.length) return;
	const existing = rows[0];

	const update = {
		legalFirstName: trimOrNull(existing.legalFirstName) ? null : trimOrNull(form.legalFirstName),
		legalLastName: trimOrNull(existing.legalLastName) ? null : trimOrNull(form.legalLastName),
		phone: trimOrNull(existing.phone) ? null : trimOrNull(form.phone),
		addressLine1: trimOrNull(existing.addressLine1) ? null : trimOrNull(form.addressLine1),
		city: trimOrNull(existing.city) ? null : trimOrNull(form.city),
		state: trimOrNull(existing.state) ? null : trimOrNull(form.state),
		zipCode: trimOrNull(existing.zipCode) ? null : trimOrNull(form.zipCode),
	};

	const setParts = [];
	const params = [];

	for (const [k, v] of Object.entries(update)) {
		/*
			Only include fields that are currently empty in the profile
			and have a usable non-blank value from the form.
		*/
		if (v !== null && v !== undefined && String(v).trim()) {
			setParts.push(`${k} = ?`);
			params.push(v);
		}
	}

	if (!setParts.length) return;

	params.push(userID);
	await conn.execute(`update customer set ${setParts.join(", ")} where userID = ?`, params);
}

async function maybeCreateOrUpdatePetProfile(conn, userID, body, form) {
	/*
		Pet profile behavior is optional. If pet profiles are disabled and
		no existing petID was chosen, the appointment just stores the
		snapshot form data and leaves appointment.petID as null
	*/
	const createPetProfile = body?.createPetProfile === true || body?.enablePetProfiles === true;

	if (!createPetProfile && !body?.petID) return { petID: null };

	const petIDRaw = body?.petID;
	const petID = petIDRaw !== null && petIDRaw !== undefined && petIDRaw !== "" ? Number(petIDRaw) : null;

	const petFields = {
		petName: form.petName,
		petType: form.petType,
		breed: form.breed,
		petSex: form.petSex,
		spayedNeutered: form.spayedNeutered,
		age: Number(form.petAge),
		currentMedications: form.currentMedications,
		medicationHistory: form.medicationHistory,
		knownAllergies: form.knownAllergies,
		currentConditions: form.currentConditions,
		pastInjuriesConditions: form.pastInjuriesConditions,
		vaccinationsUpToDate: form.vaccinationsUpToDate,
		heartwormPreventionCurrent: form.heartwormPreventionCurrent,
	};

	if (petID) {
		/*
			If an existing pet was chosen, update that saved pet profile
			so it matches the newest submitted information
		*/
		await conn.execute(
			`update pet set
			petName = ?,
			petType = ?,
			breed = ?,
			petSex = ?,
			spayedNeutered = ?,
			age = ?,
			currentMedications = ?,
			medicationHistory = ?,
			knownAllergies = ?,
			currentConditions = ?,
			pastInjuriesConditions = ?,
			vaccinationsUpToDate = ?,
			heartwormPreventionCurrent = ?
			where petID = ? and userID = ?`,
			[
				petFields.petName,
				petFields.petType,
				petFields.breed,
				petFields.petSex,
				petFields.spayedNeutered,
				petFields.age,
				petFields.currentMedications,
				petFields.medicationHistory,
				petFields.knownAllergies,
				petFields.currentConditions,
				petFields.pastInjuriesConditions,
				petFields.vaccinationsUpToDate,
				petFields.heartwormPreventionCurrent,
				petID,
				userID,
			]
		);

		return { petID };
	}

	/*
		Otherwise create a brand-new saved pet profile for this user
	*/
	const [result] = await conn.execute(
		`insert into pet (
			userID,
			petName,
			petType,
			breed,
			petSex,
			spayedNeutered,
			age,
			currentMedications,
			medicationHistory,
			knownAllergies,
			currentConditions,
			pastInjuriesConditions,
			vaccinationsUpToDate,
			heartwormPreventionCurrent
		) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		[
			userID,
			petFields.petName,
			petFields.petType,
			petFields.breed,
			petFields.petSex,
			petFields.spayedNeutered,
			petFields.age,
			petFields.currentMedications,
			petFields.medicationHistory,
			petFields.knownAllergies,
			petFields.currentConditions,
			petFields.pastInjuriesConditions,
			petFields.vaccinationsUpToDate,
			petFields.heartwormPreventionCurrent,
		]
	);

	return { petID: Number(result.insertId) };
}

function validateAndBuildForm(body) {
	/*
		Validate required reservation wizard fields and return a cleaned
		form object ready for saving if everything passes
	*/
	const form = pickFormData(body);
	const missing = [];

	const legalFirstName = requireField(form.legalFirstName, "legalFirstName", missing);
	const legalLastName = requireField(form.legalLastName, "legalLastName", missing);
	const email = requireField(form.email, "email", missing);
	const phone = requireField(form.phone, "phone", missing);
	const addressLine1 = requireField(form.addressLine1, "addressLine1", missing);
	const city = requireField(form.city, "city", missing);
	const state = requireField(form.state, "state", missing);
	const zipCode = requireField(form.zipCode, "zipCode", missing);

	const petName = requireField(form.petName, "petName", missing);
	const petType = requireField(form.petType, "petType", missing);
	const breed = requireField(form.breed, "breed", missing);
	const petSex = requireField(form.petSex, "petSex", missing);
	const spayedNeutered = requireField(form.spayedNeutered, "spayedNeutered", missing);

	const petAgeRaw = form.petAge;
	const petAge = toIntOrNull(petAgeRaw);
	if (petAge === null || petAge < 0) missing.push("petAge");

	const currentMedications = requireField(form.currentMedications, "currentMedications", missing);
	const medicationHistory = requireField(form.medicationHistory, "medicationHistory", missing);
	const knownAllergies = requireField(form.knownAllergies, "knownAllergies", missing);
	const currentConditions = requireField(form.currentConditions, "currentConditions", missing);
	const pastInjuriesConditions = requireField(form.pastInjuriesConditions, "pastInjuriesConditions", missing);
	const vaccinationsUpToDate = requireField(form.vaccinationsUpToDate, "vaccinationsUpToDate", missing);
	const heartwormPreventionCurrent = requireField(form.heartwormPreventionCurrent, "heartwormPreventionCurrent", missing);

	const consentToFormInfo = requireBoolean(form.consentToFormInfo, "consentToFormInfo", missing);

	if (missing.length) {
		return { ok: false, error: `missing or invalid fields: ${missing.join(", ")}` };
	}

	return {
		ok: true,
		form: {
			legalFirstName: legalFirstName.trim(),
			legalLastName: legalLastName.trim(),
			email: email.trim(),
			phone: phone.trim(),
			addressLine1: addressLine1.trim(),
			city: city.trim(),
			state: state.trim(),
			zipCode: zipCode.trim(),

			petName: petName.trim(),
			petType: petType.trim(),
			breed: breed.trim(),
			petSex: petSex.trim(),
			spayedNeutered: spayedNeutered.trim(),
			petAge,

			reasonDetails: stringOrEmpty(form.reasonDetails).trim(),

			currentMedications: currentMedications.trim(),
			medicationHistory: medicationHistory.trim(),
			knownAllergies: knownAllergies.trim(),
			currentConditions: currentConditions.trim(),
			pastInjuriesConditions: pastInjuriesConditions.trim(),
			vaccinationsUpToDate: vaccinationsUpToDate.trim(),
			heartwormPreventionCurrent: heartwormPreventionCurrent.trim(),
			groomingDyeStyleKey: trimOrNull(form.groomingDyeStyleKey),
			groomingReferencePhotoPath: trimOrNull(form.groomingReferencePhotoPath),
			groomingStyleNotes: trimOrNull(form.groomingStyleNotes),

			insuranceProvider: trimOrNull(form.insuranceProvider),
			insuranceMemberId: trimOrNull(form.insuranceMemberId),

			consentToFormInfo,
		},
	};
}

export async function createReservationForUser(conn, userID, body) {
	const rule = getRule(body.reasonKey || body.reasonForVisit);
	if (!rule) {
		const error = new Error("invalid reasonKey");
		error.status = 400;
		throw error;
	}

	let appointmentDate = String(body.appointmentDate || "");
	let startTime = String(body.startTime || "");

	if ((!appointmentDate || !startTime) && body.slotId) {
		const parsed = parseSlotId(body.slotId);
		appointmentDate = parsed?.date || appointmentDate;
		startTime = parsed?.startTime || startTime;
	}

	if ((!appointmentDate || !startTime) && body.appointmentTimeSlot) {
		const parsed = parseSlotId(body.appointmentTimeSlot);
		appointmentDate = parsed?.date || appointmentDate;
		startTime = parsed?.startTime || startTime;
	}

	if (!isValidDateOnly(appointmentDate) || !isValidTimeOnly(startTime)) {
		const error = new Error("invalid appointmentDate or startTime");
		error.status = 400;
		throw error;
	}

	const startMinutes = timeStrToMinutes(startTime);
	const endMinutes = startMinutes + Number(rule.durationMinutes || 0);
	if (Number.isNaN(startMinutes) || startMinutes % SLOT_STEP_MINUTES !== 0) {
		const error = new Error("startTime must be on the 15 minute grid");
		error.status = 400;
		throw error;
	}
	if (startMinutes < OPEN_MINUTES || endMinutes > CLOSE_MINUTES) {
		const error = new Error("requested time is outside clinic hours");
		error.status = 400;
		throw error;
	}

	const endTime = minutesToTimeStr(endMinutes);
	const startSql = formatSqlDateTime(appointmentDate, startTime);
	const endSql = formatSqlDateTime(appointmentDate, endTime);

	const formResult = validateAndBuildForm(body);
	if (!formResult.ok) {
		const error = new Error(formResult.error);
		error.status = 400;
		throw error;
	}

	const form = formResult.form;

	const [userRows] = await conn.execute(
		"select userID from customer where userID = ? and coalesce(isDeactivated, 0) = 0",
		[userID]
	);
	if (!userRows.length) {
		const error = new Error("missing or invalid userID");
		error.status = 400;
		throw error;
	}

	const petResult = await maybeCreateOrUpdatePetProfile(conn, userID, body, form);
	const petID = petResult.petID;

	if (petID) {
		const [petOverlapRows] = await conn.execute(
			`select appointmentID
			 from appointment
			 where petID = ?
			 and date < ?
			 and date_add(date, interval durationMinutes minute) > ?
			 and coalesce(isCanceled, 0) = 0
			 for update`,
			[petID, endSql, startSql]
		);

		if (petOverlapRows.length) {
			const error = new Error("that pet already has an overlapping appointment");
			error.status = 409;
			throw error;
		}
	}

	const staffAssignments = await selectAvailableStaffAssignment(conn, rule, appointmentDate, startSql, endSql);
	if (!staffAssignments) {
		const error = new Error("no staff available for that time");
		error.status = 409;
		throw error;
	}

	const roomNumber = await selectAvailableRoom(conn, rule.roomType, startSql, endSql);
	if (!roomNumber) {
		const error = new Error("no room available for that time");
		error.status = 409;
		throw error;
	}

	const equipCheck = await checkNonConsumableCapacityForInterval(conn, rule, startSql, endSql);
	if (!equipCheck.ok) {
		const error = new Error(equipCheck.error);
		error.status = 409;
		throw error;
	}

	const consumableReserve = await reserveConsumables(conn, rule);
	if (!consumableReserve.ok) {
		const error = new Error(consumableReserve.error);
		error.status = 409;
		throw error;
	}

	await maybeFillCustomerProfileIfEmpty(conn, userID, form);

	const [apptInsert] = await conn.execute(
		`insert into appointment (
			userID,
			petID,
			roomNumber,
			reasonKey,
			date,
			durationMinutes
		) values (?,?,?,?,?,?)`,
		[userID, petID, roomNumber, rule.reasonKey, startSql, rule.durationMinutes]
	);

	const appointmentID = Number(apptInsert.insertId);

	await insertAppointmentForm(conn, appointmentID, form);
	await insertAppointmentStaffRows(conn, appointmentID, staffAssignments);

	for (const r of consumableReserve.reserved || []) {
		await conn.execute(
			"insert into appointment_consumable (appointmentID, itemID, qtyUsed) values (?,?,?)",
			[appointmentID, r.itemID, r.qtyUsed]
		);
	}

	return {
		ok: true,
		appointmentID,
		reasonKey: rule.reasonKey,
		date: appointmentDate,
		durationMinutes: rule.durationMinutes,
		assignedStaff: staffAssignments,
		roomNumber,
		petID,
	};
}

router.post("/", requireAuth, async (req, res) => {
	try {
		const body = req.body || {};

		/*
			Resolve the appointment rule from either reasonKey or
			reasonForVisit, depending on what the frontend sent.
		*/
		const rule = getRule(body.reasonKey || body.reasonForVisit);

		if (!rule) {
			res.status(400).json({ error: "invalid reasonKey" });
			return;
		}

		/*
			The frontend may send date/time directly or may send a slot ID
			that needs to be parsed back into date and start time.
		*/
		let appointmentDate = String(body.appointmentDate || "");
		let startTime = String(body.startTime || "");

		if ((!appointmentDate || !startTime) && body.slotId) {
			const parsed = parseSlotId(body.slotId);
			appointmentDate = parsed?.date || appointmentDate;
			startTime = parsed?.startTime || startTime;
		}

		if ((!appointmentDate || !startTime) && body.appointmentTimeSlot) {
			const parsed = parseSlotId(body.appointmentTimeSlot);
			appointmentDate = parsed?.date || appointmentDate;
			startTime = parsed?.startTime || startTime;
		}

		if (!isValidDateOnly(appointmentDate) || !isValidTimeOnly(startTime)) {
			res.status(400).json({ error: "invalid appointmentDate or startTime" });
			return;
		}

		/*
			Make sure the requested start time sits exactly on the 15-minute grid
			and that the full appointment stays inside clinic hours.
		*/
		const startMinutes = timeStrToMinutes(startTime);

		if (!Number.isFinite(startMinutes) || !isStartAligned(startMinutes)) {
			res.status(400).json({ error: "startTime must be on a 15 minute boundary" });
			return;
		}

		const endMinutes = startMinutes + rule.durationMinutes;
		if (startMinutes < OPEN_MINUTES || endMinutes > CLOSE_MINUTES) {
			res.status(400).json({ error: "appointment time outside clinic hours" });
			return;
		}

		const startSql = formatSqlDateTime(appointmentDate, startTime);
		const endTime = minutesToTimeStr(endMinutes);
		const endSql = formatSqlDateTime(appointmentDate, endTime);

		/*
			Validate and normalize all reservation wizard form fields.
		*/
		const formResult = validateAndBuildForm(body);
		if (!formResult.ok) {
			res.status(400).json({ error: formResult.error });
			return;
		}

		const form = formResult.form;

		/*
			Run booking inside a transaction so staff, room, and inventory
			cannot be double-allocated by overlapping requests.
		*/
		const result = await withTransaction(async (conn) => {
			const userID = await resolveUserId(conn, req);
			if (!userID) {
				return { ok: false, status: 400, error: "missing or invalid userID" };
			}

			/*
				Create or update the pet profile if pet profiles are being used.
			*/
			const petResult = await maybeCreateOrUpdatePetProfile(conn, userID, body, form);
			const petID = petResult.petID;

			/*
				Do not allow the same saved pet to have overlapping appointments.
			*/
			if (petID) {
				const [petOverlapRows] = await conn.execute(
					`select appointmentID
					 from appointment
					 where petID = ?
					 and date < ?
					 and date_add(date, interval durationMinutes minute) > ?
					 and coalesce(isCanceled, 0) = 0
					 for update`,
					[petID, endSql, startSql]
				);

				if (petOverlapRows.length) {
					return { ok: false, status: 409, error: "that pet already has an overlapping appointment" };
				}
			}

			/*
				Automatically choose available staff and a room based on the
				scheduling rule and requested time.
			*/
			const staffAssignments = await selectAvailableStaffAssignment(conn, rule, appointmentDate, startSql, endSql);
			if (!staffAssignments) {
				return { ok: false, status: 409, error: "no staff available for that time" };
			}

			const roomNumber = await selectAvailableRoom(conn, rule.roomType, startSql, endSql);
			if (!roomNumber) {
				return { ok: false, status: 409, error: "no room available for that time" };
			}

			/*
				Non-consumables are checked by time-window capacity.
			*/
			const equipCheck = await checkNonConsumableCapacityForInterval(conn, rule, startSql, endSql);
			if (!equipCheck.ok) {
				return { ok: false, status: 409, error: equipCheck.error };
			}

			/*
				Consumables are checked and decremented immediately inside
				the transaction.
			*/
			const consumableReserve = await reserveConsumables(conn, rule);
			if (!consumableReserve.ok) {
				return { ok: false, status: 409, error: consumableReserve.error };
			}

			/*
				Fill blank customer profile fields from the submitted form
				without overwriting existing profile values.
			*/
			await maybeFillCustomerProfileIfEmpty(conn, userID, form);

			/*
				Create the main appointment row first.
			*/
			const [apptInsert] = await conn.execute(
				`insert into appointment (
					userID,
					petID,
					roomNumber,
					reasonKey,
					date,
					durationMinutes
				) values (?,?,?,?,?,?)`,
				[userID, petID, roomNumber, rule.reasonKey, startSql, rule.durationMinutes]
			);

			const appointmentID = Number(apptInsert.insertId);

			/*
				Store the submitted form snapshot, the assigned staff,
				and the reserved consumables for this appointment.
			*/
			await insertAppointmentForm(conn, appointmentID, form);
			await insertAppointmentStaffRows(conn, appointmentID, staffAssignments);

			for (const r of consumableReserve.reserved || []) {
				await conn.execute(
					"insert into appointment_consumable (appointmentID, itemID, qtyUsed) values (?,?,?)",
					[appointmentID, r.itemID, r.qtyUsed]
				);
			}

			return {
				ok: true,
				appointmentID,
				reasonKey: rule.reasonKey,
				date: body.appointmentDate,
				durationMinutes: rule.durationMinutes,
				assignedStaff: staffAssignments,
				roomNumber,
				petID,
			};
		});

		if (!result.ok) {
			res.status(result.status || 500).json({ error: result.error || "failed to create appointment" });
			return;
		}

		/*
			After the appointment is fully committed, run any immediate
			notification rules for bookings that are already happening soon.
			This is intentionally outside the transaction so reminder sending
			never risks rolling back the successful appointment itself.
		*/
		try {
			await handleImmediateNotificationsForNewAppointment(result.appointmentID);
		} catch (notificationError) {
			/*
				Log reminder issues, but do not fail the actual appointment
				creation response after the booking has already succeeded.
			*/
			console.error("immediate appointment notification error", notificationError);
		}

		res.json({
			ok: true,
			appointmentId: result.appointmentID,
			reasonKey: result.reasonKey,
			date: result.date,
			durationMinutes: result.durationMinutes,
			assignedStaff: result.assignedStaff,
			roomNumber: result.roomNumber,
			petID: result.petID,
			message: "appointment created",
		});
	} catch (err) {
		console.error("create reservation error", err);
		res.status(500).json({ error: "failed to create appointment" });
	}
});

router.delete("/:appointmentID/cancel", requireAuth, async (req, res) => {
	try {
	  const appointmentID = Number(req.params.appointmentID);
	  const userID = Number(req.session.userID);
  
	  if (!Number.isInteger(appointmentID) || appointmentID <= 0) {
		return res.status(400).json({ message: "Invalid appointment id" });
	  }
  
	  const [rows] = await pool.query(
		`SELECT appointmentID, userID
		 FROM appointment
		 WHERE appointmentID = ?
		 LIMIT 1`,
		[appointmentID]
	  );
  
	  if (!rows.length) {
		return res.status(404).json({ message: "Appointment not found" });
	  }
  
	  if (Number(rows[0].userID) !== userID) {
		return res.status(403).json({ message: "Not allowed to cancel this appointment" });
	  }
  
	  const result = await cancelAppointment({
		appointmentID,
		canceledByUserID: userID,
		canceledByType: "CUSTOMER",
		cancellationReason: null,
	  });
  
	  res.json({ message: "Appointment canceled", result });
	} catch (err) {
	  const status = Number(err?.status || 500);
	  res.status(status).json({
		message: err instanceof Error ? err.message : "Failed to cancel appointment",
	  });
	}
  });

export default router;