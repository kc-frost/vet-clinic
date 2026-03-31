import express from "express";
import { pool } from "../db.js";
import { requireAuth, requireAdmin } from "../lib/authMiddleware.js";

const router = express.Router();

/*
	Clinic hours are represented in minutes from midnight.
	This keeps time math simple when checking slot boundaries.
*/
const OPEN_MINUTES = 9 * 60;
const CLOSE_MINUTES = 17 * 60;
const SLOT_STEP_MINUTES = 15;

/*
	These rules define how each appointment reason should be scheduled.
	Each reason includes:
	- its canonical reasonKey
	- duration
	- required staff roles and quantities
	- required room type
	- required non-consumable equipment
	- required consumable inventory items
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
	and map them back to the canonical keys in REASON_RULES.
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
	emergency: "EMERGENCY_TRAUMA",
	emergency_trauma: "EMERGENCY_TRAUMA",
	ultrasound: "ULTRASOUND",
};

/*
	Normalizes an incoming reason key.
	First tries the canonical uppercase version.
	If not found, tries the alias table.
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
	Gets the full scheduling rule object for a reason.
	Returns null if the reason is invalid.
*/
function getRule(reasonKeyRaw) {
	const key = normalizeReasonKey(reasonKeyRaw);
	return REASON_RULES[key] || null;
}

/*
	Pads a number to two digits.
	Example: 5 becomes "05".
*/
function pad2(n) {
	return String(n).padStart(2, "0");
}

/*
	Validates YYYY-MM-DD format.
*/
function isValidDateOnly(dateStr) {
	return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

/*
	Validates HH:MM format.
*/
function isValidTimeOnly(timeStr) {
	return /^\d{2}:\d{2}$/.test(timeStr);
}

/*
	Converts a time string like HH:MM into total minutes from midnight.
*/
function timeStrToMinutes(timeStr) {
	const [hStr, mStr] = String(timeStr || "").split(":");
	const h = Number(hStr);
	const m = Number(mStr);
	if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
	return h * 60 + m;
}

/*
	Converts total minutes from midnight back into HH:MM format.
*/
function minutesToTimeStr(totalMinutes) {
	const h = Math.floor(totalMinutes / 60);
	const m = totalMinutes % 60;
	return `${pad2(h)}:${pad2(m)}`;
}

/*
	Builds a SQL datetime string from date and time parts.
*/
function formatSqlDateTime(dateStr, timeStr) {
	return `${dateStr} ${timeStr}:00`;
}

/*
	Converts a SQL datetime-like value into a JavaScript Date.
	Handles Date objects and strings.
*/
function sqlDateTimeToDate(value) {
	if (value instanceof Date) return value;
	const str = String(value || "");
	if (!str) return new Date(NaN);
	if (/^\d{4}-\d{2}-\d{2} /.test(str)) return new Date(str.replace(" ", "T"));
	return new Date(str);
}

/*
	Parses a SQL datetime and returns minutes from midnight.
	If Date parsing fails, it falls back to manual parsing.
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
	Checks whether two time intervals overlap.
*/
function minutesOverlap(aStart, aEnd, bStart, bEnd) {
	return aStart < bEnd && bStart < aEnd;
}

/*
	Parses a time value from the database into minutes.
	Accepts HH:MM or HH:MM:SS.
*/
function parseTimeValueToMinutes(value) {
	const raw = String(value || "").trim();
	const match = raw.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
	if (!match) return NaN;
	return Number(match[1]) * 60 + Number(match[2]);
}

/*
	Gets ISO-style day of week from a date string.
	JavaScript uses Sunday = 0, but this converts Sunday to 7.
*/
function getDayOfWeekFromDateStr(dateStr) {
	const [y, m, d] = String(dateStr).split("-").map((v) => Number(v));
	const dt = new Date(y, m - 1, d);
	const jsDay = dt.getDay();
	return jsDay === 0 ? 7 : jsDay;
}

/*
	Expands the requiredStaff array into individual assignment slots.
	Example: qty 2 for a role becomes two separate slot objects.
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
	Returns a shuffled copy of an array.
	Used so staff assignment is not always picked in the same order.
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
	Builds a Map where the key is itemKey and the value is the row.
*/
function buildItemKeyToRowMap(rows) {
	const map = new Map();
	for (const row of rows) map.set(row.itemKey, row);
	return map;
}

/*
	Builds a Map from roleKey to an array of staffIDs that have that role.
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
	Builds a nested map of staff weekly availability.
	Outer key: staffID
	Inner key: dayOfWeek
	Value: start and end minutes
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
	Builds a Map from appointmentID to all assigned staffIDs on that appointment.
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
	Checks whether a staff member is available on the requested day
	and fully covers the requested time window.
*/
function staffHasWeeklyAvailability(staffAvailabilityById, staffID, dayOfWeek, startMin, endMin) {
	const byDay = staffAvailabilityById.get(staffID);
	if (!byDay) return false;
	const block = byDay.get(dayOfWeek);
	if (!block) return false;
	return block.startMin <= startMin && block.endMin >= endMin;
}

/*
	Checks whether a given staff member is already assigned to an overlapping appointment.
*/
function appointmentHasStaffOverlap(appt, assignedStaffIds, staffID, startMin, endMin) {
	if (!assignedStaffIds.includes(staffID)) return false;
	const apptStartMin = parseSqlDateTimeToMinutes(appt.date);
	const apptEndMin = apptStartMin + Number(appt.durationMinutes || 0);
	return minutesOverlap(apptStartMin, apptEndMin, startMin, endMin);
}

/*
	Attempts to assign staff to all required role slots for an appointment.
	It:
	- expands required role slots
	- filters candidates by weekly availability
	- filters candidates by overlapping appointments
	- shuffles candidates for variety
	- uses backtracking to assign unique staff members
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
		Sorts slots so the hardest slots to fill are assigned first.
		This improves the backtracking search.
	*/
	preparedSlots.sort((a, b) => {
		if (a.candidates.length !== b.candidates.length) return a.candidates.length - b.candidates.length;
		return a.randomTie - b.randomTie;
	});

	if (preparedSlots.some((slot) => slot.candidates.length === 0)) return null;

	const usedStaffIds = new Set();

	/*
		Recursive backtracking assignment.
		Each staff member can only be used once per appointment.
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
	Converts an appointment duration into the number of 15 minute buckets it uses.
*/
function bucketCountFromDuration(durationMinutes) {
	return Math.ceil(durationMinutes / SLOT_STEP_MINUTES);
}

/*
	Wrapper for running database work inside a transaction.
	Commits on success and rolls back on failure.
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
	Gets the logged in user's userID from the session.
	Returns null if it is missing or invalid.
*/
function getRequestUserId(req) {
	const sessionUser = req.session?.user || null;
	const raw = sessionUser?.userID ?? req.session?.userID ?? null;
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) return null;
	return n;
}

/*
	Finds one available room of the required type that does not overlap
	with any existing appointment in the requested time interval.
	The row is locked with FOR UPDATE inside the transaction.
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
	Checks whether all required non-consumable equipment has enough capacity
	for the requested interval.

	For non-consumables:
	- the inventory row must exist
	- quantity acts like simultaneous capacity
	- overlapping appointments using the same equipment are counted bucket by bucket
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
		Returns the start and end Date objects for one 15 minute bucket
		inside the requested interval.
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
	Reserves all consumable inventory required by the rule.
	It first validates stock, then subtracts the quantities.
	It returns the reserved rows so they can be inserted into appointment_consumable.
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
	Inserts the appointment_form snapshot row for a newly created appointment.
	This preserves the submitted form values at booking time.
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
			knownAllergies,
			pastInjuriesConditions,
			vaccinationsUpToDate,
			heartwormPreventionCurrent,
			insuranceProvider,
			insuranceMemberId,
			consentToFormInfo
		) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
			form.knownAllergies,
			form.pastInjuriesConditions,
			form.vaccinationsUpToDate,
			form.heartwormPreventionCurrent,
			form.insuranceProvider || null,
			form.insuranceMemberId || null,
			form.consentToFormInfo ? 1 : 0,
		]
	);
}

/*
	Deletes an appointment and restores any consumed inventory.
	This is used by both cancel and reschedule logic.
	Order matters because dependent rows must be removed first.
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
		Refund previously consumed consumables back into inventory.
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
	Creates a brand new appointment during a reschedule operation.
	It re-runs scheduling logic rather than simply changing the old row.
*/
async function createRescheduledAppointmentInsideTransaction(conn, oldApptRow, oldFormRow, newDate, newStartTime) {
	const rule = getRule(oldApptRow.reasonKey);
	if (!rule) return { ok: false, status: 400, error: "invalid appointment reason for reschedule" };
	if (!isValidDateOnly(newDate) || !isValidTimeOnly(newStartTime)) return { ok: false, status: 400, error: "invalid appointmentDate or startTime" };

	const startMinutes = timeStrToMinutes(newStartTime);

	/*
		Start time must land exactly on the 15 minute scheduling grid.
	*/
	if (!Number.isFinite(startMinutes) || startMinutes % SLOT_STEP_MINUTES !== 0) {
		return { ok: false, status: 400, error: "startTime must be on a 15 minute boundary" };
	}

	const endMinutes = startMinutes + rule.durationMinutes;

	/*
		Reject appointments outside clinic hours.
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
		The same pet cannot have overlapping appointments.
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
		Load all staff that can fulfill the required roles.
	*/
	const requiredRoleKeys = [...new Set((rule.requiredStaff || []).map((need) => need.roleKey))];
	const rolePlaceholders = requiredRoleKeys.map(() => "?").join(",");
	const [roleRows] = await conn.execute(
		`select staffID, roleKey from staff_role where roleKey in (${rolePlaceholders}) for update`,
		requiredRoleKeys
	);
	const roleToStaffIds = buildStaffRoleMap(roleRows);

	/*
		Load weekly availability for all candidate staff.
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
		Load all appointments on that day so staff overlap can be checked.
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
		Load which staff are already assigned to those day appointments.
	*/
	const apptStaffRows = dayApptIds.length
		? (await conn.execute(
			`select appointmentID, staffID from appointment_staff where appointmentID in (${dayApptIds.map(() => "?").join(",")}) for update`,
			dayApptIds
		))[0]
		: [];
	const appointmentStaffByAppt = buildAppointmentStaffMap(apptStaffRows);

	/*
		Try to find a valid staff assignment for this new appointment.
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
		Find an available room that matches the appointment's room type.
	*/
	const roomNumber = await selectAvailableRoom(conn, rule.roomType, startSql, endSql);
	if (!roomNumber) return { ok: false, status: 409, error: "no room available for that time" };

	/*
		Check non-consumable equipment capacity.
	*/
	const equipCheck = await checkNonConsumableCapacityForInterval(conn, rule, startSql, endSql);
	if (!equipCheck.ok) return { ok: false, status: 409, error: equipCheck.error };

	/*
		Reserve consumable inventory now that the appointment is valid.
	*/
	const consumableReserve = await reserveConsumables(conn, rule);
	if (!consumableReserve.ok) return { ok: false, status: 409, error: consumableReserve.error };

	/*
		Create the appointment row itself.
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
		Insert all staff assignments for the new appointment.
	*/
	for (const assignment of assignedStaff) {
		await conn.execute(
			`insert into appointment_staff (appointmentID, staffID, assignedRoleKey)
			 values (?,?,?)`,
			[newAppointmentID, assignment.staffID, assignment.assignedRoleKey]
		);
	}

	/*
		Copy the old appointment's form snapshot into the new appointment.
	*/
	await insertAppointmentFormFromSnapshot(conn, newAppointmentID, oldFormRow);

	/*
		Record which consumables were reserved for this appointment.
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
	Admin-only route that returns all appointments.
	It includes room information, assigned staff summary,
	and consumables/equipment summary for display.
*/
router.get("/", requireAdmin, async (req, res) => {
	try {
		const [rows] = await pool.query(`
			SELECT
				a.appointmentID,
				a.userID,
				c.email AS userEmail,
				a.roomNumber,
				r.roomType,
				a.petID,
				a.reasonKey,
				a.date,
				a.durationMinutes,
				DATE_ADD(a.date, INTERVAL a.durationMinutes MINUTE) AS endDateTime,
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
			LEFT JOIN appointment_staff aps ON aps.appointmentID = a.appointmentID
			LEFT JOIN staff s ON s.staffID = aps.staffID
			LEFT JOIN customer sc ON sc.userID = s.userID
			LEFT JOIN appointment_consumable ac ON ac.appointmentID = a.appointmentID
			LEFT JOIN inventory i ON i.itemID = ac.itemID
			GROUP BY a.appointmentID, a.userID, c.email, a.roomNumber, r.roomType, a.petID, a.reasonKey, a.date, a.durationMinutes
			ORDER BY a.date ASC
		`);

		res.json(rows);
	} catch (err) {
		console.error("GET /api/appointments error:", err);
		res.status(500).json({ error: "failed to fetch appointments" });
	}
});

/*
	Logged-in user route that returns only their own appointments.
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
			WHERE a.userID = ?
			GROUP BY a.appointmentID, a.userID, a.roomNumber, a.petID, a.reasonKey, a.date, a.durationMinutes
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
	Logged-in user route to cancel one of their own current or future appointments.
	The delete happens inside a transaction so related cleanup stays consistent.
*/
router.delete("/mine/:id", requireAuth, async (req, res) => {
	try {
		const userID = getRequestUserId(req);
		const appointmentID = Number(req.params.id);
		if (!Number.isInteger(appointmentID) || appointmentID <= 0) return res.status(400).json({ error: "invalid appointment id" });

		const result = await withTransaction(async (conn) => {
			const [rows] = await conn.execute(
				`select appointmentID, userID, date
				 from appointment
				 where appointmentID = ?
				 for update`,
				[appointmentID]
			);
			if (!rows.length) return { ok: false, status: 404, error: "appointment not found" };
			const appt = rows[0];

			/*
				Users can only cancel their own appointments.
			*/
			if (Number(appt.userID) !== userID) return { ok: false, status: 403, error: "not allowed to cancel this appointment" };

			const startDt = sqlDateTimeToDate(appt.date);

			/*
				Past appointments cannot be canceled.
			*/
			if (startDt.getTime() < Date.now()) return { ok: false, status: 400, error: "past appointments cannot be canceled" };

			await deleteAppointmentInsideTransaction(conn, appointmentID);
			return { ok: true };
		});

		if (!result.ok) return res.status(result.status || 500).json({ error: result.error || "failed to cancel appointment" });
		res.json({ message: "appointment canceled" });
	} catch (err) {
		console.error("DELETE /api/appointments/mine/:id error:", err);
		res.status(500).json({ error: "failed to cancel appointment" });
	}
});

/*
	Logged-in user route to reschedule one of their own current or future appointments.

	The old appointment is deleted first, then a new one is created
	using the same scheduling logic as normal booking, all inside one transaction.
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
				Users can only reschedule their own appointments.
			*/
			if (Number(oldAppt.userID) !== userID) return { ok: false, status: 403, error: "not allowed to reschedule this appointment" };

			const oldStartDt = sqlDateTimeToDate(oldAppt.date);

			/*
				Past appointments cannot be rescheduled.
			*/
			if (oldStartDt.getTime() < Date.now()) return { ok: false, status: 400, error: "past appointments cannot be rescheduled" };

			/*
				Load the old snapshot row so it can be copied to the new appointment.
			*/
			const [formRows] = await conn.execute(`select * from appointment_form where appointmentID = ? for update`, [oldAppointmentID]);
			if (!formRows.length) return { ok: false, status: 404, error: "appointment snapshot not found" };
			const oldForm = formRows[0];

			/*
				Delete old appointment and attempt to create the new one.
			*/
			await deleteAppointmentInsideTransaction(conn, oldAppointmentID);
			return createRescheduledAppointmentInsideTransaction(conn, oldAppt, oldForm, appointmentDate, startTime);
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
	Admin-only delete route.
	Deletes any appointment and refunds tied consumables.
*/
router.delete("/:id", requireAdmin, async (req, res) => {
	try {
		const appointmentID = Number(req.params.id);
		if (!Number.isInteger(appointmentID) || appointmentID <= 0) return res.status(400).json({ error: "invalid appointment id" });

		const result = await withTransaction(async (conn) => {
			const [rows] = await conn.execute(`select appointmentID from appointment where appointmentID = ? for update`, [appointmentID]);
			if (!rows.length) return { ok: false, status: 404, error: "appointment not found" };
			await deleteAppointmentInsideTransaction(conn, appointmentID);
			return { ok: true };
		});

		if (!result.ok) return res.status(result.status || 500).json({ error: result.error || "failed to delete appointment" });
		res.status(204).send();
	} catch (err) {
		console.error("DELETE /api/appointments/:id error:", err);
		res.status(500).json({ error: "failed to delete appointment" });
	}
});

export default router;