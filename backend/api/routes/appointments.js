import express from "express";
import { pool } from "../db.js";
import { requireAuth, requireAdmin } from "../lib/authMiddleware.js";
import { cancelAppointment } from "../lib/appointmentCancellationService.js";

const router = express.Router();

/*
	Clinic hours are stored in minutes from midnight so the time math stays simple
*/
const OPEN_MINUTES = 9 * 60;
const CLOSE_MINUTES = 17 * 60;
const SLOT_STEP_MINUTES = 15;

/*
	These rules define what each appointment type needs in order to be scheduled
*/
const REASON_RULES = {
	WELLNESS_EXAM: {
		reasonKey: "WELLNESS_EXAM",
		durationMinutes: 45,
		requiredStaff: [{ roleKey: "GP_VET", qty: 1 }],
		roomType: "EXAM",
		nonConsumables: [],
		consumables: [{ itemKey: "EXAM_SUPPLY_KIT", qty: 1 }],
	},

	RABIES_VACCINATION: {
		reasonKey: "RABIES_VACCINATION",
		durationMinutes: 15,
		requiredStaff: [{ roleKey: "GP_VET", qty: 1 }],
		roomType: "EXAM",
		nonConsumables: [],
		consumables: [
			{ itemKey: "RABIES_VACCINE_DOSE", qty: 1 },
			{ itemKey: "SYRINGE_3ML", qty: 1 },
			{ itemKey: "ALCOHOL_WIPE", qty: 1 },
			{ itemKey: "GAUZE_PAD", qty: 1 },
		],
	},

	BORDETELLA_VACCINATION: {
		reasonKey: "BORDETELLA_VACCINATION",
		durationMinutes: 15,
		requiredStaff: [{ roleKey: "GP_VET", qty: 1 }],
		roomType: "EXAM",
		nonConsumables: [],
		consumables: [
			{ itemKey: "BORDETELLA_VACCINE_DOSE", qty: 1 },
			{ itemKey: "SYRINGE_3ML", qty: 1 },
			{ itemKey: "ALCOHOL_WIPE", qty: 1 },
			{ itemKey: "GAUZE_PAD", qty: 1 },
		],
	},

	DENTAL_CLEANING: {
		reasonKey: "DENTAL_CLEANING",
		durationMinutes: 75,
		requiredStaff: [
			{ roleKey: "DENTIST", qty: 1 },
			{ roleKey: "SURGEON_ASSISTANT", qty: 1 },
		],
		roomType: "SURGERY",
		nonConsumables: ["ANESTHESIA_MACHINE", "DENTAL_SCALER_UNIT"],
		consumables: [
			{ itemKey: "DENTAL_CLEANING_KIT", qty: 1 },
			{ itemKey: "DENTAL_POLISH_PASTE_DOSE", qty: 1 },
			{ itemKey: "CARPROFEN_DOSE", qty: 1 },
		],
	},

	DENTAL_EXTRACTION: {
		reasonKey: "DENTAL_EXTRACTION",
		durationMinutes: 90,
		requiredStaff: [
			{ roleKey: "DENTIST", qty: 1 },
			{ roleKey: "SURGEON_ASSISTANT", qty: 1 },
		],
		roomType: "SURGERY",
		nonConsumables: ["ANESTHESIA_MACHINE", "ORAL_SURGICAL_INSTRUMENT_SET"],
		consumables: [
			{ itemKey: "DENTAL_EXTRACTION_PACK", qty: 1 },
			{ itemKey: "SUTURE_KIT", qty: 1 },
			{ itemKey: "AMOXICILLIN_DOSE", qty: 1 },
			{ itemKey: "CARPROFEN_DOSE", qty: 1 },
		],
	},

	XRAY_EVALUATION: {
		reasonKey: "XRAY_EVALUATION",
		durationMinutes: 45,
		requiredStaff: [
			{ roleKey: "GP_VET", qty: 1 },
			{ roleKey: "XRAY_TECH", qty: 1 },
		],
		roomType: "IMAGING",
		nonConsumables: ["XRAY_MACHINE"],
		consumables: [{ itemKey: "POSITIONING_WEDGE", qty: 1 }],
	},

	CAST_CHANGE: {
		reasonKey: "CAST_CHANGE",
		durationMinutes: 30,
		requiredStaff: [
			{ roleKey: "GP_VET", qty: 1 },
			{ roleKey: "XRAY_TECH", qty: 1 },
		],
		roomType: "EXAM",
		nonConsumables: [],
		consumables: [{ itemKey: "CAST_CHANGE_SUPPLY_KIT", qty: 1 }],
	},

	BASIC_GROOMING: {
		reasonKey: "BASIC_GROOMING",
		durationMinutes: 60,
		requiredStaff: [{ roleKey: "GROOMER", qty: 1 }],
		roomType: "GROOMING",
		nonConsumables: [],
		consumables: [
			{ itemKey: "TROPICLEAN_SHAMPOO_DOSE", qty: 1 },
			{ itemKey: "EAR_CLEANING_SOLUTION_DOSE", qty: 1 },
			{ itemKey: "NAIL_GRINDER_DISPOSABLE_HEAD", qty: 1 },
			{ itemKey: "PET_WIPE_PACK", qty: 1 },
		],
	},

	FLEA_BATH_GROOMING: {
		reasonKey: "FLEA_BATH_GROOMING",
		durationMinutes: 60,
		requiredStaff: [{ roleKey: "GROOMER", qty: 1 }],
		roomType: "GROOMING",
		nonConsumables: [],
		consumables: [
			{ itemKey: "FLEA_TREATMENT_SHAMPOO_DOSE", qty: 1 },
			{ itemKey: "EAR_CLEANING_SOLUTION_DOSE", qty: 1 },
			{ itemKey: "NAIL_GRINDER_DISPOSABLE_HEAD", qty: 1 },
			{ itemKey: "PET_WIPE_PACK", qty: 1 },
		],
	},

	GROOMING_DYE: {
		reasonKey: "GROOMING_DYE",
		durationMinutes: 75,
		requiredStaff: [{ roleKey: "GROOMER", qty: 1 }],
		roomType: "GROOMING",
		nonConsumables: [],
		consumables: [
			{ itemKey: "TROPICLEAN_SHAMPOO_DOSE", qty: 1 },
			{ itemKey: "EAR_CLEANING_SOLUTION_DOSE", qty: 1 },
			{ itemKey: "NAIL_GRINDER_DISPOSABLE_HEAD", qty: 1 },
			{ itemKey: "PET_WIPE_PACK", qty: 1 },
			{ itemKey: "PET_SAFE_DYE_DOSE", qty: 1 },
		],
	},

	EMERGENCY_TRAUMA: {
		reasonKey: "EMERGENCY_TRAUMA",
		durationMinutes: 120,
		requiredStaff: [
			{ roleKey: "SURGEON", qty: 1 },
			{ roleKey: "SURGEON_ASSISTANT", qty: 1 },
		],
		roomType: "SURGERY",
		nonConsumables: ["ANESTHESIA_MACHINE"],
		consumables: [
			{ itemKey: "STERILE_BANDAGE_PACK", qty: 2 },
			{ itemKey: "AMOXICILLIN_DOSE", qty: 1 },
			{ itemKey: "CARPROFEN_DOSE", qty: 1 },
			{ itemKey: "SUTURE_KIT", qty: 1 },
			{ itemKey: "SALINE_FLUSH", qty: 1 },
		],
	},

	ULTRASOUND: {
		reasonKey: "ULTRASOUND",
		durationMinutes: 45,
		requiredStaff: [
			{ roleKey: "GP_VET", qty: 1 },
			{ roleKey: "ULTRASOUND_TECH", qty: 1 },
		],
		roomType: "IMAGING",
		nonConsumables: ["ULTRASOUND_MACHINE"],
		consumables: [],
	},
};

/*
	These aliases let the backend accept alternate reason spellings
	and map them back to the canonical key
*/
const REASON_ALIASES = {
	wellness_exam: "WELLNESS_EXAM",
	rabies_vaccination: "RABIES_VACCINATION",
	bordetella_vaccination: "BORDETELLA_VACCINATION",
	dental_cleaning: "DENTAL_CLEANING",
	dental_extraction: "DENTAL_EXTRACTION",
	xray_evaluation: "XRAY_EVALUATION",
	cast_change: "CAST_CHANGE",
	basic_grooming: "BASIC_GROOMING",
	flea_bath_grooming: "FLEA_BATH_GROOMING",
	grooming_dye: "GROOMING_DYE",
	emergency: "EMERGENCY_TRAUMA",
	emergency_trauma: "EMERGENCY_TRAUMA",
	ultrasound: "ULTRASOUND",
};

/*
	Normalizes an incoming reason key
	It first checks the canonical uppercase key, then the alias table
*/
function normalizeReasonKey(raw) {
	if (!raw) return "";
	const key = String(raw).trim();
	if (!key) return "";
	const upper = key.toUpperCase();
	if (REASON_RULES[upper]) return upper;
	const lower = key.toLowerCase();
	if (REASON_ALIASES[lower]) return REASON_ALIASES[lower];
	return upper;
}

/*
	Gets the full scheduling rule for a reason
*/
function getRule(reasonKeyRaw) {
	const key = normalizeReasonKey(reasonKeyRaw);
	return REASON_RULES[key] || null;
}

/*
	Pads a number to two digits
*/
function pad2(n) {
	return String(n).padStart(2, "0");
}

/*
	Checks YYYY-MM-DD format
*/
function isValidDateOnly(dateStr) {
	return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

/*
	Checks HH:MM format
*/
function isValidTimeOnly(timeStr) {
	return /^\d{2}:\d{2}$/.test(timeStr);
}

/*
	Turns HH:MM into total minutes from midnight
*/
function timeStrToMinutes(timeStr) {
	const [hStr, mStr] = String(timeStr || "").split(":");
	const h = Number(hStr);
	const m = Number(mStr);
	if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
	return h * 60 + m;
}

/*
	Turns total minutes from midnight back into HH:MM
*/
function minutesToTimeStr(totalMinutes) {
	const h = Math.floor(totalMinutes / 60);
	const m = totalMinutes % 60;
	return `${pad2(h)}:${pad2(m)}`;
}

/*
	Builds a SQL datetime string from date and time parts
*/
function formatSqlDateTime(dateStr, timeStr) {
	return `${dateStr} ${timeStr}:00`;
}

/*
	Converts a SQL datetime-like value into a JavaScript Date
*/
function sqlDateTimeToDate(value) {
	if (value instanceof Date) return value;
	const str = String(value || "");
	if (!str) return new Date(NaN);
	if (/^\d{4}-\d{2}-\d{2} /.test(str)) return new Date(str.replace(" ", "T"));
	return new Date(str);
}

/*
	Parses a SQL datetime and returns minutes from midnight
	If Date parsing fails it falls back to reading the time string manually
*/
function parseSqlDateTimeToMinutes(sqlDateTime) {
	const dt = sqlDateTimeToDate(sqlDateTime);
	if (!Number.isNaN(dt.getTime())) return dt.getHours() * 60 + dt.getMinutes();
	const timePart = String(sqlDateTime || "").split(" ")[1] || "";
	const pieces = timePart.split(":");
	const hh = Number(pieces[0]);
	const mm = Number(pieces[1]);
	if (!Number.isFinite(hh) || !Number.isFinite(mm)) return 0;
	return hh * 60 + mm;
}

/*
	Checks whether two time intervals overlap
*/
function minutesOverlap(aStart, aEnd, bStart, bEnd) {
	return aStart < bEnd && bStart < aEnd;
}

/*
	Parses a database time value into minutes
	Accepts HH:MM or HH:MM:SS
*/
function parseTimeValueToMinutes(value) {
	const raw = String(value || "").trim();
	const match = raw.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
	if (!match) return NaN;
	return Number(match[1]) * 60 + Number(match[2]);
}

/*
	Gets ISO-style day of week from a date string
	JavaScript uses Sunday = 0, so this converts Sunday to 7
*/
function getDayOfWeekFromDateStr(dateStr) {
	const [y, m, d] = String(dateStr).split("-").map((v) => Number(v));
	const dt = new Date(y, m - 1, d);
	const jsDay = dt.getDay();
	return jsDay === 0 ? 7 : jsDay;
}

/*
	Expands requiredStaff into individual assignment slots
*/
function expandRequiredStaffSlots(rule) {
	const slots = [];
	for (const need of rule.requiredStaff || []) {
		const qty = Number(need.qty || 0);
		for (let i = 0; i < qty; i++) slots.push({ roleKey: need.roleKey, slotIndex: i });
	}
	return slots;
}

/*
	Returns a shuffled copy so staff are not always picked in the same order
*/
function shuffleArray(values) {
	const copy = [...values];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}

/*
	Builds a Map where itemKey points to the matching inventory row
*/
function buildItemKeyToRowMap(rows) {
	const map = new Map();
	for (const row of rows) map.set(row.itemKey, row);
	return map;
}

/*
	Builds a Map from roleKey to the staffIDs that have that role
*/
function buildStaffRoleMap(roleRows) {
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

/*
	Builds a nested map of weekly staff availability
*/
function buildStaffAvailabilityMap(rows) {
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

/*
	Builds a Map from appointmentID to its assigned staffIDs
*/
function buildAppointmentStaffMap(rows) {
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

/*
	Checks whether a staff member is available for the full requested time window
*/
function staffHasWeeklyAvailability(staffAvailabilityById, staffID, dayOfWeek, startMin, endMin) {
	const byDay = staffAvailabilityById.get(staffID);
	if (!byDay) return false;
	const block = byDay.get(dayOfWeek);
	if (!block) return false;
	return block.startMin <= startMin && block.endMin >= endMin;
}

/*
	Checks whether a staff member is already assigned to an overlapping appointment
*/
function appointmentHasStaffOverlap(appt, assignedStaffIds, staffID, startMin, endMin) {
	if (!assignedStaffIds.includes(staffID)) return false;
	const apptStartMin = parseSqlDateTimeToMinutes(appt.date);
	const apptEndMin = apptStartMin + Number(appt.durationMinutes || 0);
	return minutesOverlap(apptStartMin, apptEndMin, startMin, endMin);
}

/*
	Tries to assign staff to all required role slots for an appointment
	It filters candidates first, then uses backtracking so the same person is not used twice
*/
function findRandomStaffAssignment(rule, roleToStaffIds, staffAvailabilityById, dayOfWeek, dayAppts, appointmentStaffByAppt, startMin, endMin) {
	const requiredSlots = expandRequiredStaffSlots(rule);
	if (!requiredSlots.length) return null;

	const preparedSlots = requiredSlots.map((slot, index) => {
		const rawCandidates = roleToStaffIds.get(slot.roleKey) || [];
		const filteredCandidates = rawCandidates.filter((staffID) => {
			if (!staffHasWeeklyAvailability(staffAvailabilityById, staffID, dayOfWeek, startMin, endMin)) return false;

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
		Sort harder slots first so backtracking has a better chance of succeeding
	*/
	preparedSlots.sort((a, b) => {
		if (a.candidates.length !== b.candidates.length) return a.candidates.length - b.candidates.length;
		return a.randomTie - b.randomTie;
	});

	if (preparedSlots.some((slot) => slot.candidates.length === 0)) return null;

	const usedStaffIds = new Set();

	/*
		Recursive backtracking assignment
		One staff member can only fill one slot on the appointment
	*/
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

/*
	Converts a duration into the number of 15 minute buckets it covers
*/
function bucketCountFromDuration(durationMinutes) {
	return Math.ceil(durationMinutes / SLOT_STEP_MINUTES);
}

/*
	Runs database work inside a transaction
*/
async function withTransaction(workFn) {
	const conn = await pool.getConnection();
	try {
		await conn.beginTransaction();
		const result = await workFn(conn);
		await conn.commit();
		return result;
	} catch (err) {
		await conn.rollback();
		throw err;
	} finally {
		conn.release();
	}
}

/*
	Gets the logged-in user's userID from the session
*/
function getRequestUserId(req) {
	const sessionUser = req.session?.user || null;
	const raw = sessionUser?.userID ?? req.session?.userID ?? null;
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) return null;
	return n;
}

/*
	Finds one available room of the required type that does not overlap the requested interval
	The row is locked inside the transaction
*/
async function selectAvailableRoom(conn, roomType, startSql, endSql) {
	const [rows] = await conn.execute(
		`select r.roomNumber
		 from rooms r
		 where r.roomType = ?
		 and not exists (
			select 1 from appointment a
			where a.roomNumber = r.roomNumber
			and a.date < ?
			and date_add(a.date, interval a.durationMinutes minute) > ?
		 )
		 order by r.roomNumber asc
		 limit 1
		 for update`,
		[roomType, endSql, startSql]
	);

	if (!rows.length) return null;
	return Number(rows[0].roomNumber);
}

/*
	Checks whether the required non-consumable equipment has enough capacity for the requested interval
*/
async function checkNonConsumableCapacityForInterval(conn, rule, startSql, endSql) {
	if (!rule.nonConsumables.length) return { ok: true, error: "" };

	const neededKeys = rule.nonConsumables;
	const placeholders = neededKeys.map(() => "?").join(",");

	const [invRows] = await conn.execute(
		`select itemID, itemKey, quantity from inventory
		 where isConsumable = 0 and itemKey in (${placeholders})
		 for update`,
		neededKeys
	);

	const capMap = buildItemKeyToRowMap(invRows);

	for (const key of neededKeys) {
		const row = capMap.get(key);
		if (!row) return { ok: false, error: `missing non-consumable inventory itemKey ${key}` };
		if (Number(row.quantity) < 1) return { ok: false, error: `no capacity for ${key}` };
	}

	const [overlapRows] = await conn.execute(
		`select reasonKey, date, durationMinutes from appointment
		 where date < ? and date_add(date, interval durationMinutes minute) > ?
		 for update`,
		[endSql, startSql]
	);

	const startDt = new Date(startSql.replace(" ", "T"));
	const endDt = new Date(endSql.replace(" ", "T"));
	const intervalMinutes = Math.round((endDt.getTime() - startDt.getTime()) / 60000);
	const bucketCount = bucketCountFromDuration(intervalMinutes);

	/*
		Returns the start and end Date objects for one 15 minute bucket inside the requested interval
	*/
	function bucketWindow(i) {
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
			if (used >= capacity) return { ok: false, error: `no capacity for ${equipKey} in that time window` };
		}
	}

	return { ok: true, error: "" };
}

/*
	Reserves the consumable inventory required by the rule
	It validates stock first, then subtracts the quantities
*/
async function reserveConsumables(conn, rule) {
	if (!rule.consumables.length) return { ok: true, error: "", reserved: [] };

	const itemKeys = rule.consumables.map((c) => c.itemKey);
	const placeholders = itemKeys.map(() => "?").join(",");

	const [rows] = await conn.execute(
		`select itemID, itemKey, quantity from inventory
		 where isConsumable = 1 and itemKey in (${placeholders})
		 for update`,
		itemKeys
	);

	const map = buildItemKeyToRowMap(rows);

	for (const need of rule.consumables) {
		const row = map.get(need.itemKey);
		if (!row) return { ok: false, error: `missing consumable inventory itemKey ${need.itemKey}`, reserved: [] };
		if (Number(row.quantity) < need.qty) return { ok: false, error: `not enough stock for ${need.itemKey}`, reserved: [] };
	}

	for (const need of rule.consumables) {
		await conn.execute("update inventory set quantity = quantity - ? where itemKey = ? and isConsumable = 1", [need.qty, need.itemKey]);
	}

	const reserved = rule.consumables.map((need) => ({
		itemID: Number(map.get(need.itemKey).itemID),
		itemKey: need.itemKey,
		qtyUsed: need.qty,
	}));

	return { ok: true, error: "", reserved };
}

/*
	Inserts the appointment_form snapshot row for a new appointment
	This keeps the submitted form values exactly as they were at booking time
*/
async function insertAppointmentFormFromSnapshot(conn, appointmentID, form) {
	await conn.execute(
		`insert into appointment_form (
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
		) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		[
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
			form.medicationHistory || "",
			form.knownAllergies,
			form.currentConditions || "",
			form.pastInjuriesConditions,
			form.vaccinationsUpToDate,
			form.heartwormPreventionCurrent,
			form.groomingDyeStyleKey || null,
			form.groomingReferencePhotoPath || null,
			form.groomingStyleNotes || null,
			form.insuranceProvider || null,
			form.insuranceMemberId || null,
			form.consentToFormInfo ? 1 : 0,
		]
	);
}

/*
	Deletes an appointment and restores tied consumables
	Order matters because dependent rows have to be removed first
*/
async function deleteAppointmentInsideTransaction(conn, appointmentID) {
	const [consRows] = await conn.execute(
		`select ac.itemID, ac.qtyUsed
		 from appointment_consumable ac
		 where ac.appointmentID = ?
		 for update`,
		[appointmentID]
	);

	/*
		Refund reserved consumables back into inventory
	*/
	for (const row of consRows) {
		await conn.execute("update inventory set quantity = quantity + ? where itemID = ? and isConsumable = 1", [Number(row.qtyUsed), Number(row.itemID)]);
	}

	await conn.execute("delete from notification where appointmentID = ?", [appointmentID]);
	await conn.execute("delete from email_log where appointmentID = ?", [appointmentID]);
	await conn.execute("delete from appointment_staff where appointmentID = ?", [appointmentID]);
	await conn.execute("delete from appointment_consumable where appointmentID = ?", [appointmentID]);
	await conn.execute("delete from appointment_form where appointmentID = ?", [appointmentID]);
	await conn.execute("delete from appointment where appointmentID = ?", [appointmentID]);
}

/*
	Creates a brand new appointment during reschedule
	It reruns the normal scheduling checks instead of just changing the old row
*/
async function createRescheduledAppointmentInsideTransaction(conn, oldApptRow, oldFormRow, newDate, newStartTime) {
	const rule = getRule(oldApptRow.reasonKey);
	if (!rule) return { ok: false, status: 400, error: "invalid appointment reason for reschedule" };
	if (!isValidDateOnly(newDate) || !isValidTimeOnly(newStartTime)) return { ok: false, status: 400, error: "invalid appointmentDate or startTime" };

	const startMinutes = timeStrToMinutes(newStartTime);

	/*
		Start time has to land on the 15 minute grid
	*/
	if (!Number.isFinite(startMinutes) || startMinutes % SLOT_STEP_MINUTES !== 0) {
		return { ok: false, status: 400, error: "startTime must be on a 15 minute boundary" };
	}

	const endMinutes = startMinutes + rule.durationMinutes;

	/*
		Reject anything outside clinic hours
	*/
	if (startMinutes < OPEN_MINUTES || endMinutes > CLOSE_MINUTES) {
		return { ok: false, status: 400, error: "appointment time outside clinic hours" };
	}

	const startSql = formatSqlDateTime(newDate, newStartTime);
	const endTime = minutesToTimeStr(endMinutes);
	const endSql = formatSqlDateTime(newDate, endTime);

	const userID = Number(oldApptRow.userID);
	const petID = oldApptRow.petID === null ? null : Number(oldApptRow.petID);
	const dayOfWeek = getDayOfWeekFromDateStr(newDate);

	/*
		The same pet cannot have overlapping appointments
	*/
	if (petID !== null) {
		const [petOverlapRows] = await conn.execute(
			`select appointmentID
			 from appointment
			 where petID = ?
			 and date < ?
			 and date_add(date, interval durationMinutes minute) > ?
			 for update`,
			[petID, endSql, startSql]
		);
		if (petOverlapRows.length) return { ok: false, status: 409, error: "this pet already has an overlapping appointment" };
	}

	/*
		Load all staff that can fill the required roles
	*/
	const requiredRoleKeys = [...new Set((rule.requiredStaff || []).map((need) => need.roleKey))];
	const rolePlaceholders = requiredRoleKeys.map(() => "?").join(",");
	const [roleRows] = await conn.execute(
		`select staffID, roleKey from staff_role where roleKey in (${rolePlaceholders}) for update`,
		requiredRoleKeys
	);
	const roleToStaffIds = buildStaffRoleMap(roleRows);

	/*
		Load weekly availability for every candidate staff member
	*/
	const allCandidateStaffIds = [...new Set(roleRows.map((row) => Number(row.staffID)).filter((id) => Number.isFinite(id)))];
	const availPlaceholders = allCandidateStaffIds.map(() => "?").join(",");
	const availabilityRows = allCandidateStaffIds.length
		? (await conn.execute(
			`select staffID, dayOfWeek, startTime, endTime from staff_availability where staffID in (${availPlaceholders}) for update`,
			allCandidateStaffIds
		))[0]
		: [];
	const staffAvailabilityById = buildStaffAvailabilityMap(availabilityRows);

	/*
		Load all appointments on that day so overlap checks can be done
	*/
	const [dayAppts] = await conn.execute(
		`select appointmentID, date, durationMinutes
		 from appointment
		 where date >= ? and date < ?
		 for update`,
		[`${newDate} 00:00:00`, `${newDate} 23:59:59`]
	);

	const dayApptIds = dayAppts.map((appt) => Number(appt.appointmentID)).filter((id) => Number.isFinite(id));

	/*
		Load which staff are already assigned to those appointments
	*/
	const apptStaffRows = dayApptIds.length
		? (await conn.execute(
			`select appointmentID, staffID from appointment_staff where appointmentID in (${dayApptIds.map(() => "?").join(",")}) for update`,
			dayApptIds
		))[0]
		: [];
	const appointmentStaffByAppt = buildAppointmentStaffMap(apptStaffRows);

	/*
		Try to find a valid staff assignment
	*/
	const assignedStaff = findRandomStaffAssignment(
		rule,
		roleToStaffIds,
		staffAvailabilityById,
		dayOfWeek,
		dayAppts,
		appointmentStaffByAppt,
		startMinutes,
		endMinutes
	);
	if (!assignedStaff) return { ok: false, status: 409, error: "no staff available for that time" };

	/*
		Find an available room with the required room type
	*/
	const roomNumber = await selectAvailableRoom(conn, rule.roomType, startSql, endSql);
	if (!roomNumber) return { ok: false, status: 409, error: "no room available for that time" };

	/*
		Check non-consumable capacity before committing to the appointment
	*/
	const equipCheck = await checkNonConsumableCapacityForInterval(conn, rule, startSql, endSql);
	if (!equipCheck.ok) return { ok: false, status: 409, error: equipCheck.error };

	/*
		Reserve consumables now that everything else passed
	*/
	const consumableReserve = await reserveConsumables(conn, rule);
	if (!consumableReserve.ok) return { ok: false, status: 409, error: consumableReserve.error };

	/*
		Create the appointment row
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

	const newAppointmentID = Number(apptInsert.insertId);

	/*
		Insert all staff assignments for the new appointment
	*/
	for (const assignment of assignedStaff) {
		await conn.execute(
			`insert into appointment_staff (appointmentID, staffID, assignedRoleKey)
			 values (?,?,?)`,
			[newAppointmentID, assignment.staffID, assignment.assignedRoleKey]
		);
	}

	/*
		Copy the old appointment form snapshot onto the new appointment
	*/
	await insertAppointmentFormFromSnapshot(conn, newAppointmentID, oldFormRow);

	/*
		Record which consumables were reserved for this appointment
	*/
	for (const r of consumableReserve.reserved || []) {
		await conn.execute("insert into appointment_consumable (appointmentID, itemID, qtyUsed) values (?,?,?)", [newAppointmentID, r.itemID, r.qtyUsed]);
	}

	return {
		ok: true,
		appointmentID: newAppointmentID,
		reasonKey: rule.reasonKey,
		date: newDate,
		durationMinutes: rule.durationMinutes,
		assignedStaff,
		roomNumber,
		petID,
	};
}

/*
	Admin-only route that returns all appointments
	It includes room info, assigned staff summary, and equipment or consumable summary for display
*/
router.get("/", requireAdmin, async (req, res) => {
	try {
		// This toggle powers active appointments vs canceled history
		const includeCanceled = String(req.query.includeCanceled || "").trim() === "1";

		const orderByClause = includeCanceled ? "COALESCE(acxl.canceledAt, a.date) DESC, a.date DESC" : "a.date ASC";

		const [rows] = await pool.query(
			`SELECT
				a.appointmentID,
				a.userID,
				c.email AS userEmail,
				a.roomNumber,
				r.roomType,
				a.petID,
				COALESCE(p.petName, af.petName, '') AS petName,
				a.reasonKey,
				a.date,
				a.durationMinutes,
				DATE_ADD(a.date, INTERVAL a.durationMinutes MINUTE) AS endDateTime,
				COALESCE(a.isCanceled, 0) AS isCanceled,
				acxl.canceledByUserID,
				acxl.canceledByType,
				acxl.cancellationReason,
				acxl.canceledAt,
				TRIM(CONCAT(COALESCE(canceler.legalFirstName, ''), ' ', COALESCE(canceler.legalLastName, ''))) AS canceledByName,
				COALESCE(
					GROUP_CONCAT(
						DISTINCT CONCAT(
							aps.assignedRoleKey,
							': ',
							COALESCE(NULLIF(TRIM(CONCAT(COALESCE(sc.legalFirstName, ''), ' ', COALESCE(sc.legalLastName, ''))), ''), CONCAT('Staff ', aps.staffID)),
							' (#',
							aps.staffID,
							')'
						)
						ORDER BY aps.assignedRoleKey, aps.staffID
						SEPARATOR ', '
					),
					''
				) AS assignedStaffSummary,
				COALESCE(
					GROUP_CONCAT(
						DISTINCT CONCAT(COALESCE(i.displayName, i.itemKey), ' (x', ac.qtyUsed, ')')
						ORDER BY COALESCE(i.displayName, i.itemKey)
						SEPARATOR ', '
					),
					''
				) AS equipmentUsed
			FROM appointment a
			LEFT JOIN customer c ON c.userID = a.userID
			LEFT JOIN rooms r ON r.roomNumber = a.roomNumber
			LEFT JOIN pet p ON p.petID = a.petID
			LEFT JOIN appointment_form af ON af.appointmentID = a.appointmentID
			LEFT JOIN appointment_review ar ON ar.appointmentID = a.appointmentID
			LEFT JOIN appointment_cancellation acxl ON acxl.appointmentID = a.appointmentID
			LEFT JOIN customer canceler ON canceler.userID = acxl.canceledByUserID
			LEFT JOIN appointment_staff aps ON aps.appointmentID = a.appointmentID
			LEFT JOIN staff s ON s.staffID = aps.staffID
			LEFT JOIN customer sc ON sc.userID = s.userID
			LEFT JOIN appointment_consumable ac ON ac.appointmentID = a.appointmentID
			LEFT JOIN inventory i ON i.itemID = ac.itemID
			WHERE COALESCE(a.isCanceled, 0) = ?
				AND (? = 1 OR COALESCE(a.underReview, 0) = 0)
			GROUP BY
				a.appointmentID,
				a.userID,
				c.email,
				a.roomNumber,
				r.roomType,
				a.petID,
				p.petName,
				af.petName,
				a.reasonKey,
				a.date,
				a.durationMinutes,
				a.isCanceled,
				acxl.canceledByUserID,
				acxl.canceledByType,
				acxl.cancellationReason,
				acxl.canceledAt,
				canceler.legalFirstName,
				canceler.legalLastName
			ORDER BY ${orderByClause}
			`,
			[includeCanceled ? 1 : 0, includeCanceled ? 1 : 0]
		);

		res.json(rows);
	} catch (err) {
		console.error("GET /api/appointments error:", err);
		res.status(500).json({ error: "failed to fetch appointments" });
	}
});

/*
	Logged-in user route that returns only that user's appointments
*/
router.get("/mine", requireAuth, async (req, res) => {
	try {
		const userID = getRequestUserId(req);
		const [rows] = await pool.query(
			`
			SELECT
				a.appointmentID,
				a.userID,
				a.roomNumber,
				a.petID,
				a.reasonKey,
				a.date,
				a.durationMinutes,
				COALESCE(p.petName, af.petName, '') AS petName,
				ar.rating,
				ar.reviewText,
				ar.createdAt AS reviewCreatedAt,
				COALESCE(summary.isFinalized, 0) AS summaryIsFinalized,
				COALESCE(
					GROUP_CONCAT(
						DISTINCT CONCAT(
							aps.assignedRoleKey,
							': ',
							COALESCE(NULLIF(TRIM(CONCAT(COALESCE(sc.legalFirstName, ''), ' ', COALESCE(sc.legalLastName, ''))), ''), CONCAT('Staff ', aps.staffID))
						)
						ORDER BY aps.assignedRoleKey, aps.staffID
						SEPARATOR ', '
					),
					''
				) AS assignedStaffSummary
			FROM appointment a
			LEFT JOIN appointment_staff aps ON aps.appointmentID = a.appointmentID
			LEFT JOIN staff s ON s.staffID = aps.staffID
			LEFT JOIN customer sc ON sc.userID = s.userID
			LEFT JOIN pet p ON p.petID = a.petID
			LEFT JOIN appointment_review ar ON ar.appointmentID = a.appointmentID
			LEFT JOIN appointment_form af ON af.appointmentID = a.appointmentID
			LEFT JOIN appointment_summary summary ON summary.appointmentID = a.appointmentID
			WHERE a.userID = ?
				AND COALESCE(a.isCanceled, 0) = 0
				AND COALESCE(a.underReview, 0) = 0
			GROUP BY a.appointmentID, a.userID, a.roomNumber, a.petID, a.reasonKey, a.date, a.durationMinutes, p.petName, af.petName, ar.rating, ar.reviewText, ar.createdAt, summary.isFinalized
			ORDER BY a.date ASC
			`,
			[userID]
		);

		res.json(rows);
	} catch (err) {
		console.error("GET /api/appointments/mine error:", err);
		res.status(500).json({ error: "failed to fetch user appointments" });
	}
});

/*
	Logged-in user route to cancel one of their own appointments
	The shared helper handles metadata and cleanup
*/
router.delete("/mine/:id", requireAuth, async (req, res) => {
	try {
		const appointmentID = Number(req.params.id);
		const userID = Number(req.session.userID);

		if (!Number.isInteger(appointmentID) || appointmentID <= 0) return res.status(400).json({ error: "invalid appointment id" });

		const [rows] = await pool.execute(
			`SELECT appointmentID, userID, date, isCanceled
			 FROM appointment
			 WHERE appointmentID = ?
			 LIMIT 1`,
			[appointmentID]
		);

		if (!rows.length) return res.status(404).json({ error: "appointment not found" });

		const appt = rows[0];

		if (Number(appt.userID) !== userID) return res.status(403).json({ error: "not allowed to cancel this appointment" });

		const result = await cancelAppointment({
			appointmentID,
			canceledByUserID: userID,
			canceledByType: "CUSTOMER",
			cancellationReason: null,
		});

		res.json({ message: "appointment canceled", result });
	} catch (err) {
		const status = Number(err?.status || 500);
		res.status(status).json({ error: err instanceof Error ? err.message : "failed to cancel appointment" });
	}
});

/*
	Logged-in user route to reschedule one of their own appointments

	The old appointment is deleted first, then a new one is created
	using the same scheduling logic as normal booking, all inside one transaction
*/
router.post("/mine/:id/reschedule", requireAuth, async (req, res) => {
	try {
		const userID = getRequestUserId(req);
		const oldAppointmentID = Number(req.params.id);
		const appointmentDate = String(req.body?.appointmentDate || "");
		const startTime = String(req.body?.startTime || "");

		if (!Number.isInteger(oldAppointmentID) || oldAppointmentID <= 0) return res.status(400).json({ error: "invalid appointment id" });

		const result = await withTransaction(async (conn) => {
			const [apptRows] = await conn.execute(`select * from appointment where appointmentID = ? for update`, [oldAppointmentID]);
			if (!apptRows.length) return { ok: false, status: 404, error: "appointment not found" };

			const oldAppt = apptRows[0];

			/*
				Users can only reschedule their own appointments
			*/
			if (Number(oldAppt.userID) !== userID) return { ok: false, status: 403, error: "not allowed to reschedule this appointment" };

			const oldStartDt = sqlDateTimeToDate(oldAppt.date);

			/*
				Past appointments cannot be rescheduled
			*/
			if (oldStartDt.getTime() < Date.now()) return { ok: false, status: 400, error: "Appointments that have already started cannot be rescheduled" };

			/*
				Load the old snapshot row so it can be copied to the new appointment
			*/
			const [formRows] = await conn.execute(`select * from appointment_form where appointmentID = ? for update`, [oldAppointmentID]);
			if (!formRows.length) return { ok: false, status: 404, error: "appointment snapshot not found" };

			const oldForm = formRows[0];

			/*
				Delete the old appointment only inside this transaction so a failed rebuild
				can roll the whole thing back and keep the original appointment alive
			*/
			await deleteAppointmentInsideTransaction(conn, oldAppointmentID);

			const createResult = await createRescheduledAppointmentInsideTransaction(conn, oldAppt, oldForm, appointmentDate, startTime);
			if (!createResult.ok) {
				const createError = new Error(createResult.error || "failed to reschedule appointment");
				createError.status = createResult.status || 500;
				throw createError;
			}

			return createResult;
		});

		if (!result.ok) return res.status(result.status || 500).json({ error: result.error || "failed to reschedule appointment" });

		res.json({
			ok: true,
			appointmentId: result.appointmentID,
			reasonKey: result.reasonKey,
			date: result.date,
			durationMinutes: result.durationMinutes,
			assignedStaff: result.assignedStaff,
			roomNumber: result.roomNumber,
			petID: result.petID,
			message: "appointment rescheduled",
		});
	} catch (err) {
		console.error("POST /api/appointments/mine/:id/reschedule error:", err);
		res.status(500).json({ error: "failed to reschedule appointment" });
	}
});

/*
	Admin-only cancel route
*/
router.post("/:id/cancel", requireAdmin, async (req, res) => {
	try {
		const appointmentID = Number(req.params.id);
		const canceledByUserID = Number(req.session.userID);
		const cancellationReason = String(req.body?.cancellationReason || "").trim();

		if (!Number.isInteger(appointmentID) || appointmentID <= 0) return res.status(400).json({ error: "invalid appointment id" });
		if (!cancellationReason) return res.status(400).json({ error: "cancellationReason is required" });

		const result = await cancelAppointment({
			appointmentID,
			canceledByUserID,
			canceledByType: "ADMIN",
			cancellationReason,
		});

		res.json({ message: "appointment canceled", result });
	} catch (err) {
		const status = Number(err?.status || 500);
		res.status(status).json({ error: err instanceof Error ? err.message : "failed to cancel appointment" });
	}
});

export default router;