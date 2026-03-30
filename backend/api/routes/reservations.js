import express from "express";
import { pool } from "../db.js";

const router = express.Router();

// clinic hours expressed in minutes so time math stays consistent
// open is 9:00am and close is 5:00pm
// slots are generated on a 15 minute grid
const OPEN_MINUTES = 9 * 60;
const CLOSE_MINUTES = 17 * 60;
const SLOT_STEP_MINUTES = 15;

// scheduling rules per appointment reason
// reasonKey matches what the frontend sends (or gets normalized to it)
// staffRole is used to pick staff
// roomType is used to pick rooms
// nonConsumables are capacity-based (no stock decrement, just need capacity available)
// consumables are stock-based (inventory.quantity is decremented on booking)

const REASON_RULES = {
	WELLNESS_EXAM: {
		reasonKey: "WELLNESS_EXAM",
		durationMinutes: 45,
		requiredStaff: [{ roleKey: "GENERAL", qty: 1 }],
		roomType: "EXAM",
		nonConsumables: [],
		consumables: [{ itemKey: "EXAM_SUPPLY_KIT", qty: 1 }],
	},
	VACCINATION: {
		reasonKey: "VACCINATION",
		durationMinutes: 15,
		requiredStaff: [{ roleKey: "GENERAL", qty: 1 }],
		roomType: "EXAM",
		nonConsumables: [],
		consumables: [{ itemKey: "VACCINE_DOSE", qty: 1 }],
	},
	DENTAL_CLEANING: {
		reasonKey: "DENTAL_CLEANING",
		durationMinutes: 75,
		requiredStaff: [
			{ roleKey: "DENTIST", qty: 1 },
			{ roleKey: "TECHNICIAN", qty: 1 },
		],
		roomType: "SURGERY",
		nonConsumables: ["ANESTHESIA_MACHINE", "DENTAL_UNIT"],
		consumables: [
			{ itemKey: "DENTAL_CLEANING_KIT", qty: 1 },
			{ itemKey: "PAIN_MED_DOSE", qty: 1 },
		],
	},
	FRACTURE: {
		reasonKey: "FRACTURE",
		durationMinutes: 60,
		requiredStaff: [
			{ roleKey: "GENERAL", qty: 1 },
			{ roleKey: "XRAY_TECH", qty: 1 },
		],
		roomType: "IMAGING",
		nonConsumables: ["XRAY_MACHINE"],
		consumables: [
			{ itemKey: "BANDAGE_PACK", qty: 1 },
			{ itemKey: "PAIN_MED_DOSE", qty: 1 },
		],
	},
	GROOMING: {
		reasonKey: "GROOMING",
		durationMinutes: 60,
		requiredStaff: [{ roleKey: "GROOMER", qty: 1 }],
		roomType: "GROOMING",
		nonConsumables: [],
		consumables: [{ itemKey: "SHAMPOO_DOSE", qty: 1 }],
	},
	EMERGENCY_TRAUMA: {
		reasonKey: "EMERGENCY_TRAUMA",
		durationMinutes: 120,
		requiredStaff: [
			{ roleKey: "SURGEON", qty: 1 },
			{ roleKey: "SURGEON_ASSISTANT", qty: 1 },
			{ roleKey: "TECHNICIAN", qty: 1 },
		],
		roomType: "SURGERY",
		nonConsumables: ["ANESTHESIA_MACHINE"],
		consumables: [
			{ itemKey: "BANDAGE_PACK", qty: 2 },
			{ itemKey: "ANTIBIOTIC_DOSE", qty: 1 },
			{ itemKey: "PAIN_MED_DOSE", qty: 1 },
			{ itemKey: "SUTURE_KIT", qty: 1 },
		],
	},
	ULTRASOUND: {
		reasonKey: "ULTRASOUND",
		durationMinutes: 45,
		requiredStaff: [
			{ roleKey: "GENERAL", qty: 1 },
			{ roleKey: "ULTRASOUND_TECH", qty: 1 },
		],
		roomType: "IMAGING",
		nonConsumables: ["ULTRASOUND_MACHINE"],
		consumables: [],
	},
};

// accepted frontend spellings/aliases for reasonKey
// this keeps the backend stable even if the UI sends different casing or short names
const REASON_ALIASES = {
	wellness_exam: "WELLNESS_EXAM",
	vaccination: "VACCINATION",
	dental_cleaning: "DENTAL_CLEANING",
	fracture: "FRACTURE",
	grooming: "GROOMING",
	emergency: "EMERGENCY_TRAUMA",
	emergency_trauma: "EMERGENCY_TRAUMA",
	ultrasound: "ULTRASOUND",
};

function normalizeReasonKey(raw) {
	// normalize to a canonical rule key
	// 1) trim
	// 2) try direct match in REASON_RULES
	// 3) try alias map
	// 4) fallback to uppercase string
	if (!raw) return "";
	const key = String(raw).trim();
	if (!key) return "";
	const upper = key.toUpperCase();
	if (REASON_RULES[upper]) return upper;
	const lower = key.toLowerCase();
	if (REASON_ALIASES[lower]) return REASON_ALIASES[lower];
	return upper;
}

function getRule(reasonKeyRaw) {
	// returns the rule object for a reasonKey, or null if no match
	const key = normalizeReasonKey(reasonKeyRaw);
	return REASON_RULES[key] || null;
}

function pad2(n) {
	// used for formatting dates/times so "9" becomes "09"
	return String(n).padStart(2, "0");
}

function isValidDateOnly(dateStr) {
	// strict YYYY-MM-DD
	return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

function isValidTimeOnly(timeStr) {
	// strict HH:MM
	return /^\d{2}:\d{2}$/.test(timeStr);
}

function timeStrToMinutes(timeStr) {
	// "HH:MM" -> minutes since midnight
	const [hStr, mStr] = timeStr.split(":");
	const h = Number(hStr);
	const m = Number(mStr);
	if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
	return h * 60 + m;
}

function minutesToTimeStr(totalMinutes) {
	// minutes since midnight -> "HH:MM"
	const h = Math.floor(totalMinutes / 60);
	const m = totalMinutes % 60;
	return `${pad2(h)}:${pad2(m)}`;
}

function formatSqlDateTime(dateStr, timeStr) {
	// mysql datetime format "YYYY-MM-DD HH:MM:SS"
	return `${dateStr} ${timeStr}:00`;
}

function parseSlotId(slotId) {
	// expected format: slot_YYYY-MM-DD_HHMM_HHMM
	// only date and startTime are needed for booking
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
	// dateStr is YYYY-MM-DD (local time)
	const [y, m, d] = dateStr.split("-").map((v) => Number(v));
	const dt = new Date(y, m - 1, d);
	dt.setDate(dt.getDate() + days);
	return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function getTodayDateStr() {
	// today as YYYY-MM-DD (local)
	const now = new Date();
	return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function getNowMinutesOfDay() {
	// minutes since midnight (local)
	const now = new Date();
	return now.getHours() * 60 + now.getMinutes();
}

function minutesOverlap(aStart, aEnd, bStart, bEnd) {
	// overlap check for [start, end) intervals
	return aStart < bEnd && bStart < aEnd;
}

function clampInt(value, min, max, fallback) {
	// parse and clamp query values like days
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.max(min, Math.min(max, Math.trunc(n)));
}

function buildSlotsForDay(dateStr, durationMinutes) {
	// generate candidate slot start times for a single day
	// only include starts where start + duration <= close time
	const slots = [];
	for (let startMin = OPEN_MINUTES; startMin + durationMinutes <= CLOSE_MINUTES; startMin += SLOT_STEP_MINUTES) {
		slots.push({ date: dateStr, startMin });
	}
	return slots;
}

function sqlDateTimeToDate(value) {
	// mysql may return a Date object or a string depending on config
	if (value instanceof Date) return value;

	const str = String(value || "");
	if (!str) return new Date(NaN);

	// mysql DATETIME often looks like "YYYY-MM-DD HH:mm:ss"
	if (/^\d{4}-\d{2}-\d{2} /.test(str)) {
		return new Date(str.replace(" ", "T"));
	}

	return new Date(str);
}

function parseSqlDateTimeToMinutes(sqlDateTime) {
	// datetime -> minutes since midnight (local)
	const dt = sqlDateTimeToDate(sqlDateTime);
	if (!Number.isNaN(dt.getTime())) {
		return dt.getHours() * 60 + dt.getMinutes();
	}

	// fallback parse if Date parsing fails
	const timePart = String(sqlDateTime || "").split(" ")[1] || "";
	const pieces = timePart.split(":");
	const hh = Number(pieces[0]);
	const mm = Number(pieces[1]);
	if (!Number.isFinite(hh) || !Number.isFinite(mm)) return 0;
	return hh * 60 + mm;
}

function getDateOnly(sqlDateTime) {
	// datetime -> "YYYY-MM-DD"
	const dt = sqlDateTimeToDate(sqlDateTime);
	if (!Number.isNaN(dt.getTime())) {
		return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
	}

	return String(sqlDateTime || "").split(" ")[0] || "";
}

async function withTransaction(workFn) {
	// runs workFn(conn) inside a mysql transaction
	// commit on success, rollback on error, always release connection
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
			// if rollback fails, there is nothing else to do here
		}
		throw err;
	} finally {
		conn.release();
	}
}

async function fetchInventoryByKeys(conn, itemKeys, isConsumable) {
	// fetch inventory rows by itemKey list and consumable flag
	// isConsumable is stored as 1/0 in mysql
	if (!itemKeys.length) return [];
	const placeholders = itemKeys.map(() => "?").join(",");
	const sql = `select itemID, itemKey, isConsumable, quantity from inventory where itemKey in (${placeholders}) and isConsumable = ?`;
	const [rows] = await conn.execute(sql, [...itemKeys, isConsumable ? 1 : 0]);
	return rows;
}

function buildItemKeyToRowMap(rows) {
	// build map: itemKey -> row for fast lookups
	const map = new Map();
	for (const row of rows) {
		map.set(row.itemKey, row);
	}
	return map;
}

function validateRequiredInventory(rule, consumableRows, nonConsumableRows) {
	// quick pre-check for "do required items exist" and "is stock/capacity non-zero"
	// if required inventory is missing or empty, no slots are bookable

	// consumables check (stock based)
	for (const need of rule.consumables) {
		const row = consumableRows.get(need.itemKey);
		if (!row) return { ok: false, error: `missing consumable inventory itemKey ${need.itemKey}` };
		if (Number(row.quantity) < need.qty) return { ok: false, error: `not enough stock for ${need.itemKey}` };
	}

	// non-consumables check (capacity based)
	for (const key of rule.nonConsumables) {
		const row = nonConsumableRows.get(key);
		if (!row) return { ok: false, error: `missing non-consumable inventory itemKey ${key}` };
		if (Number(row.quantity) < 1) return { ok: false, error: `no capacity for ${key}` };
	}

	return { ok: true, error: "" };
}


function parseTimeValueToMinutes(value) {
	// mysql TIME may come back as HH:MM:SS or HH:MM
	const raw = String(value || "").trim();
	const match = raw.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
	if (!match) return NaN;
	return Number(match[1]) * 60 + Number(match[2]);
}

function getDayOfWeekFromDateStr(dateStr) {
	// js getDay is 0=Sunday ... 6=Saturday
	// backend availability uses 1=Monday ... 7=Sunday
	const [y, m, d] = String(dateStr).split("-").map((v) => Number(v));
	const dt = new Date(y, m - 1, d);
	const jsDay = dt.getDay();
	return jsDay === 0 ? 7 : jsDay;
}

function expandRequiredStaffSlots(rule) {
	// one staff member can only fill one required slot on one appointment
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
	// this is for random-enough distribution without building every full combination
	const copy = [...values];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}

function buildStaffRoleMap(roleRows) {
	// map roleKey -> [staffID]
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
	// map staffID -> map(dayOfWeek -> { startMin, endMin })
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
	// map appointmentID -> [staffID]
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
	// staff must cover the full appointment window
	const byDay = staffAvailabilityById.get(staffID);
	if (!byDay) return false;
	const block = byDay.get(dayOfWeek);
	if (!block) return false;
	return block.startMin <= startMin && block.endMin >= endMin;
}

function appointmentHasStaffOverlap(appt, assignedStaffIds, staffID, startMin, endMin) {
	// assignedStaffIds comes from appointment_staff rows for that appointment
	if (!assignedStaffIds.includes(staffID)) return false;
	const apptStartMin = parseSqlDateTimeToMinutes(appt.date);
	const apptEndMin = apptStartMin + Number(appt.durationMinutes || 0);
	return minutesOverlap(apptStartMin, apptEndMin, startMin, endMin);
}

function findRandomStaffAssignment(rule, roleToStaffIds, staffAvailabilityById, dayOfWeek, dayAppts, appointmentStaffByAppt, startMin, endMin) {
	// this returns one valid assignment set or null
	// shuffle first, then backtrack into the first valid full set
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

	preparedSlots.sort((a, b) => {
		if (a.candidates.length !== b.candidates.length) return a.candidates.length - b.candidates.length;
		return a.randomTie - b.randomTie;
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

function findFreeResourceId(resourceIds, busyById, startBucket, bucketCount) {
	// used for staff and rooms
	// returns first id that is free across the full bucket window
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
	// minutes since midnight -> 15-min bucket index starting at OPEN_MINUTES
	return Math.floor((minutes - OPEN_MINUTES) / SLOT_STEP_MINUTES);
}

function bucketCountFromDuration(durationMinutes) {
	// duration -> number of 15-min buckets (round up)
	return Math.ceil(durationMinutes / SLOT_STEP_MINUTES);
}

function isStartAligned(minutes) {
	// start times must align to the slot grid
	return minutes % SLOT_STEP_MINUTES === 0;
}

function getUserIdFromSession(req) {
	// session shape could be { user: { userID } } or { userID } depending on auth implementation
	const sessionUser = req.session?.user || null;
	const raw = sessionUser?.userID ?? req.session?.userID ?? null;
	if (raw === null || raw === undefined || raw === "") return null;
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) return null;
	return n;
}

function resolveUserIdFromRequest(req, fallback) {
	// prefer session userID if present, fallback to query param for local/dev use
	const fromSession = getUserIdFromSession(req);
	if (fromSession) return fromSession;

	const n = Number(fallback);
	if (!Number.isFinite(n) || n <= 0) return null;
	return n;
}

// fetch current user profile fields for the reservation wizard autofill
router.get("/profile", async (req, res) => {
	try {
		const userID = resolveUserIdFromRequest(req, req.query.userID);
		if (!userID) {
			res.status(400).json({ error: "missing userID" });
			return;
		}

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

// fetch saved pets for the reservation wizard dropdown
router.get("/pets", async (req, res) => {
	try {
		const userID = resolveUserIdFromRequest(req, req.query.userID);
		if (!userID) {
			res.status(400).json({ error: "missing userID" });
			return;
		}

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
				knownAllergies,
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
				knownAllergies: p.knownAllergies || "",
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

// updates one existing pet profile for the logged in user
// used by the user profile page for editable mini pet profile cards
router.patch("/pets/:petID", async (req, res) => {
	try {
		const userID = resolveUserIdFromRequest(req, req.query.userID);
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

		const petName = String(body.petName || "");
		const petType = String(body.petType || "");
		const breed = String(body.breed || "");
		const petSex = String(body.petSex || "");
		const spayedNeutered = String(body.spayedNeutered || "");
		const age =
			body.age === "" || body.age === null || body.age === undefined
				? null
				: Number(body.age);
		const currentMedications = String(body.currentMedications || "");
		const knownAllergies = String(body.knownAllergies || "");
		const pastInjuriesConditions = String(body.pastInjuriesConditions || "");
		const vaccinationsUpToDate = String(body.vaccinationsUpToDate || "");
		const heartwormPreventionCurrent = String(body.heartwormPreventionCurrent || "");

		const [result] = await pool.execute(
			`update pet set
				petName = ?,
				petType = ?,
				breed = ?,
				petSex = ?,
				spayedNeutered = ?,
				age = ?,
				currentMedications = ?,
				knownAllergies = ?,
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
				knownAllergies,
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
				knownAllergies,
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
			knownAllergies: p.knownAllergies || "",
			pastInjuriesConditions: p.pastInjuriesConditions || "",
			vaccinationsUpToDate: p.vaccinationsUpToDate || "",
			heartwormPreventionCurrent: p.heartwormPreventionCurrent || "",
		});
	} catch (err) {
		console.error("patch pet error", err);
		res.status(500).json({ error: "failed to update pet profile" });
	}
});



// returns availability slots for a reasonKey
router.get("/availability", async (req, res) => {
	try {
		const reasonKeyRaw = req.query.reasonKey;
		const rule = getRule(reasonKeyRaw);

		if (!rule) {
			res.status(400).json({ error: "invalid reasonKey" });
			return;
		}

		const bookingPetIDRaw = req.query.petID;
		const bookingPetID = bookingPetIDRaw === null || bookingPetIDRaw === undefined || bookingPetIDRaw === "" ? null : Number(bookingPetIDRaw);
		if (bookingPetIDRaw !== null && bookingPetIDRaw !== undefined && bookingPetIDRaw !== "" && (!Number.isFinite(bookingPetID) || bookingPetID <= 0)) {
			res.status(400).json({ error: "invalid petID" });
			return;
		}

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
			const requiredConsumableKeys = rule.consumables.map((c) => c.itemKey);
			const requiredNonConsumableKeys = rule.nonConsumables;

			const [staffRoleRows] = await conn.execute(
				`select staffID, roleKey
				 from staff_role
				 order by staffID asc, roleKey asc`
			);
			const roleToStaffIds = buildStaffRoleMap(staffRoleRows);

			const [staffAvailabilityRows] = await conn.execute(
				`select staffID, dayOfWeek, startTime, endTime
				 from staff_availability`
			);
			const staffAvailabilityById = buildStaffAvailabilityMap(staffAvailabilityRows);

			const requiredRoleKeys = [...new Set((rule.requiredStaff || []).map((need) => need.roleKey))];
			if (requiredRoleKeys.some((roleKey) => !(roleToStaffIds.get(roleKey) || []).length)) {
				res.json({ ok: true, reasonKey: rule.reasonKey, durationMinutes: rule.durationMinutes, timezone: "local", range: { startDate, days }, slots: [] });
				return;
			}

			const [roomRows] = await conn.execute(
				"select roomNumber from rooms where roomType = ? order by roomNumber asc",
				[rule.roomType]
			);
			const roomNumbers = roomRows.map((r) => Number(r.roomNumber));
			if (!roomNumbers.length) {
				res.json({ ok: true, reasonKey: rule.reasonKey, durationMinutes: rule.durationMinutes, timezone: "local", range: { startDate, days }, slots: [] });
				return;
			}

			const consumableRows = buildItemKeyToRowMap(await fetchInventoryByKeys(conn, requiredConsumableKeys, true));
			const nonConsumableRows = buildItemKeyToRowMap(await fetchInventoryByKeys(conn, requiredNonConsumableKeys, false));
			const invCheck = validateRequiredInventory(rule, consumableRows, nonConsumableRows);
			if (!invCheck.ok) {
				res.json({ ok: true, reasonKey: rule.reasonKey, durationMinutes: rule.durationMinutes, timezone: "local", range: { startDate, days }, slots: [] });
				return;
			}

			const rangeStart = `${startDate} 00:00:00`;
			const endExclusive = addDays(endDate, 1);
			const rangeEndExclusive = `${endExclusive} 00:00:00`;

			const [apptRows] = await conn.execute(
				`select appointmentID, userID, petID, roomNumber, reasonKey, date, durationMinutes
				 from appointment
				 where date >= ? and date < ?`,
				[rangeStart, rangeEndExclusive]
			);

			const appointmentIds = apptRows.map((row) => Number(row.appointmentID)).filter((id) => Number.isFinite(id));
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

			const apptsByDate = new Map();
			for (const row of apptRows) {
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
				const dayAppts = apptsByDate.get(curDate) || [];
				const dayOfWeek = getDayOfWeekFromDateStr(curDate);

				const roomBusy = new Map();
				for (const rn of roomNumbers) roomBusy.set(rn, Array(64).fill(false));

				const petBusy = bookingPetID ? Array(64).fill(false) : null;

				const equipBusyCount = new Map();
				for (const key of requiredNonConsumableKeys) equipBusyCount.set(key, Array(64).fill(0));

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

				const dayCandidates = buildSlotsForDay(curDate, rule.durationMinutes);
				for (const c of dayCandidates) {
					const startMin = c.startMin;
					const startBucket = bucketIndexFromMinutes(startMin);

					if (curDate === today && startMin < nowMinutes) continue;

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

					const freeRoomNumber = findFreeResourceId(roomNumbers, roomBusy, startBucket, bucketCount);
					if (!freeRoomNumber) continue;

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

					const staffAssignment = findRandomStaffAssignment(rule, roleToStaffIds, staffAvailabilityById, dayOfWeek, dayAppts, appointmentStaffByAppt, startMin, startMin + rule.durationMinutes);
					if (!staffAssignment) continue;

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
	// support either { formData: {...} } or a flattened payload
	if (body && typeof body.formData === "object" && body.formData) return body.formData;
	return body || {};
}

function stringOrEmpty(v) {
	// normalize null/undefined into "" so string ops dont crash
	if (v === null || v === undefined) return "";
	return String(v);
}

function trimOrNull(v) {
	// trim string and return null if empty
	const s = stringOrEmpty(v).trim();
	return s ? s : null;
}

function requireField(value, fieldName, errors) {
	// basic required field validation for form payloads
	const s = stringOrEmpty(value).trim();
	if (!s) errors.push(fieldName);
	return s;
}

function requireBoolean(value, fieldName, errors) {
	// required boolean validation (must be true/false, not missing)
	if (value === true) return true;
	if (value === false) return false;
	errors.push(fieldName);
	return false;
}

function toIntOrNull(value) {
	// parse int but allow null for blank/missing
	if (value === "" || value === null || value === undefined) return null;
	const n = Number(value);
	if (!Number.isFinite(n)) return null;
	return Math.trunc(n);
}

async function resolveUserId(conn, body) {
	// userID is the primary linker for customer
	// email is stored as a snapshot field in appointment_form, not the join key
	const raw = body?.userID;
	if (raw === null || raw === undefined || raw === "") return null;

	const userID = Number(raw);
	if (!Number.isFinite(userID) || userID <= 0) return null;

	const [rows] = await conn.execute("select userID from customer where userID = ?", [userID]);
	if (!rows.length) return null;

	return userID;
}


async function selectAvailableStaffAssignment(conn, rule, appointmentDate, startSql, endSql) {
	// this picks one full valid assignment set inside the transaction
	const dayOfWeek = getDayOfWeekFromDateStr(appointmentDate);
	const startMin = parseSqlDateTimeToMinutes(startSql);
	const endMin = parseSqlDateTimeToMinutes(endSql);

	const [staffRoleRows] = await conn.execute(
		`select staffID, roleKey
		 from staff_role
		 order by staffID asc, roleKey asc`
	);
	const roleToStaffIds = buildStaffRoleMap(staffRoleRows);

	const [staffAvailabilityRows] = await conn.execute(
		`select staffID, dayOfWeek, startTime, endTime
		 from staff_availability
		 where dayOfWeek = ?`,
		[dayOfWeek]
	);
	const staffAvailabilityById = buildStaffAvailabilityMap(staffAvailabilityRows);

	const [apptRows] = await conn.execute(
		`select appointmentID, date, durationMinutes
		 from appointment
		 where date < ?
		 and date_add(date, interval durationMinutes minute) > ?
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
	// one row per staff assignment on the appointment
	for (const assignment of assignments) {
		await conn.execute(
			`insert into appointment_staff (appointmentID, staffID, assignedRoleKey)
			 values (?,?,?)`,
			[appointmentID, assignment.staffID, assignment.assignedRoleKey]
		);
	}
}

async function selectAvailableRoom(conn, roomType, startSql, endSql) {
	// select one room with no overlapping appointment
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

async function checkNonConsumableCapacityForInterval(conn, rule, startSql, endSql) {
	// non-consumables are capacity-based
	// capacity must not be exceeded in any 15-min bucket during the requested interval
	if (!rule.nonConsumables.length) return { ok: true, error: "" };

	// lock inventory rows so capacity can't change mid-booking
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

	// lock overlapping appointments so usage counts stay consistent during this transaction
	const [overlapRows] = await conn.execute(
		`select reasonKey, date, durationMinutes from appointment
		 where date < ? and date_add(date, interval durationMinutes minute) > ?
		 for update`,
		[endSql, startSql]
	);

	// build bucket windows only for the requested interval
	const startDt = new Date(startSql.replace(" ", "T"));
	const endDt = new Date(endSql.replace(" ", "T"));
	const intervalMinutes = Math.round((endDt.getTime() - startDt.getTime()) / 60000);
	const bucketCount = bucketCountFromDuration(intervalMinutes);

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

			// the new appointment would add +1 usage, so used must be < capacity for the full window
			if (used >= capacity) {
				return { ok: false, error: `no capacity for ${equipKey} in that time window` };
			}
		}
	}

	return { ok: true, error: "" };
}

async function reserveConsumables(conn, rule) {
	// consumables are stock-based
	// quantity is decremented inside the transaction and recorded for refund on cancel
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

	// decrement stock
	for (const need of rule.consumables) {
		await conn.execute(
			"update inventory set quantity = quantity - ? where itemKey = ? and isConsumable = 1",
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
	// snapshot of everything from the reservation wizard
	// this stores the exact submitted info even if profiles change later
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
		knownAllergies,
		pastInjuriesConditions,
		vaccinationsUpToDate,
		heartwormPreventionCurrent,
		insuranceProvider,
		insuranceMemberId,
		consentToFormInfo
	) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

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
		form.knownAllergies,
		form.pastInjuriesConditions,
		form.vaccinationsUpToDate,
		form.heartwormPreventionCurrent,
		form.insuranceProvider || null,
		form.insuranceMemberId || null,
		form.consentToFormInfo ? 1 : 0,
	];

	await conn.execute(sql, params);
}

async function maybeFillCustomerProfileIfEmpty(conn, userID, form) {
	// only fill customer profile fields if they are currently empty
	// booking should not overwrite existing profile info
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
	// pet profile logic is optional
	// if disabled, appointment.petID stays null and appointment_form holds the snapshot
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
		knownAllergies: form.knownAllergies,
		pastInjuriesConditions: form.pastInjuriesConditions,
		vaccinationsUpToDate: form.vaccinationsUpToDate,
		heartwormPreventionCurrent: form.heartwormPreventionCurrent,
	};

	if (petID) {
		// update existing pet record for this user so pet profile stays current
		await conn.execute(
			`update pet set
			petName = ?,
			petType = ?,
			breed = ?,
			petSex = ?,
			spayedNeutered = ?,
			age = ?,
			currentMedications = ?,
			knownAllergies = ?,
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
				petFields.knownAllergies,
				petFields.pastInjuriesConditions,
				petFields.vaccinationsUpToDate,
				petFields.heartwormPreventionCurrent,
				petID,
				userID,
			]
		);

		return { petID };
	}

	// create a new pet record for this user
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
			knownAllergies,
			pastInjuriesConditions,
			vaccinationsUpToDate,
			heartwormPreventionCurrent
		) values (?,?,?,?,?,?,?,?,?,?,?,?)`,
		[
			userID,
			petFields.petName,
			petFields.petType,
			petFields.breed,
			petFields.petSex,
			petFields.spayedNeutered,
			petFields.age,
			petFields.currentMedications,
			petFields.knownAllergies,
			petFields.pastInjuriesConditions,
			petFields.vaccinationsUpToDate,
			petFields.heartwormPreventionCurrent,
		]
	);

	return { petID: Number(result.insertId) };
}

function validateAndBuildForm(body) {
	// validate required wizard fields and produce a cleaned form object
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
	const knownAllergies = requireField(form.knownAllergies, "knownAllergies", missing);
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
			knownAllergies: knownAllergies.trim(),
			pastInjuriesConditions: pastInjuriesConditions.trim(),
			vaccinationsUpToDate: vaccinationsUpToDate.trim(),
			heartwormPreventionCurrent: heartwormPreventionCurrent.trim(),

			insuranceProvider: trimOrNull(form.insuranceProvider),
			insuranceMemberId: trimOrNull(form.insuranceMemberId),

			consentToFormInfo,
		},
	};
}

// create appointment booking
router.post("/", async (req, res) => {
	try {
		const body = req.body || {};
		const rule = getRule(body.reasonKey || body.reasonForVisit);

		if (!rule) {
			res.status(400).json({ error: "invalid reasonKey" });
			return;
		}

		// date/time comes from schedule picker (backend still validates)
		let appointmentDate = String(body.appointmentDate || "");
		let startTime = String(body.startTime || "");

		// allow slotId formats too (frontend may send slotId instead of date+time)
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

		const formResult = validateAndBuildForm(body);
		if (!formResult.ok) {
			res.status(400).json({ error: formResult.error });
			return;
		}

		const form = formResult.form;

		// booking is done in a transaction so staff/room/inventory cant be double-allocated
		const result = await withTransaction(async (conn) => {
			const userID = await resolveUserId(conn, body);
			if (!userID) {
				return { ok: false, status: 400, error: "missing or invalid userID" };
			}

			// optional pet profiles
			const petResult = await maybeCreateOrUpdatePetProfile(conn, userID, body, form);
			const petID = petResult.petID;

			// same pet cannot be double-booked on overlapping appointments
			if (petID) {
				const [petOverlapRows] = await conn.execute(
					`select appointmentID
					 from appointment
					 where petID = ?
					 and date < ?
					 and date_add(date, interval durationMinutes minute) > ?
					 for update`,
					[petID, endSql, startSql]
				);

				if (petOverlapRows.length) {
					return { ok: false, status: 409, error: "that pet already has an overlapping appointment" };
				}
			}

			// staff and room are assigned automatically based on availability
			const staffAssignments = await selectAvailableStaffAssignment(conn, rule, appointmentDate, startSql, endSql);
			if (!staffAssignments) {
				return { ok: false, status: 409, error: "no staff available for that time" };
			}

			const roomNumber = await selectAvailableRoom(conn, rule.roomType, startSql, endSql);
			if (!roomNumber) {
				return { ok: false, status: 409, error: "no room available for that time" };
			}

			// non-consumables: capacity check across the whole time interval
			const equipCheck = await checkNonConsumableCapacityForInterval(conn, rule, startSql, endSql);
			if (!equipCheck.ok) {
				return { ok: false, status: 409, error: equipCheck.error };
			}

			// consumables: decrement stock inside the transaction
			const consumableReserve = await reserveConsumables(conn, rule);
			if (!consumableReserve.ok) {
				return { ok: false, status: 409, error: consumableReserve.error };
			}

			// fill customer profile only if empty (does not overwrite existing values)
			await maybeFillCustomerProfileIfEmpty(conn, userID, form);

			// create appointment row (scheduling record)
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

			// snapshot the submitted form fields
			await insertAppointmentForm(conn, appointmentID, form);

			// store the actual staff assignments for this appointment
			await insertAppointmentStaffRows(conn, appointmentID, staffAssignments);

			// store reserved consumables so cancel can refund stock correctly
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

// cancel appointment and refund consumables
router.delete("/:appointmentID", async (req, res) => {
	try {
		const appointmentID = Number(req.params.appointmentID);
		if (!Number.isFinite(appointmentID)) {
			res.status(400).json({ error: "invalid appointmentID" });
			return;
		}

		const result = await withTransaction(async (conn) => {
			// lock appointment so cancel is safe even if two requests happen at once
			const [apptRows] = await conn.execute(
				"select appointmentID from appointment where appointmentID = ? for update",
				[appointmentID]
			);

			if (!apptRows.length) {
				return { ok: false, status: 404, error: "appointment not found" };
			}

			// lock appointment_consumable rows and corresponding inventory rows for refund
			const [consRows] = await conn.execute(
				`select ac.itemID, ac.qtyUsed, i.itemKey
				 from appointment_consumable ac
				 join inventory i on i.itemID = ac.itemID
				 where ac.appointmentID = ?
				 for update`,
				[appointmentID]
			);

			// refund stock
			for (const row of consRows) {
				await conn.execute(
					"update inventory set quantity = quantity + ? where itemID = ? and isConsumable = 1",
					[Number(row.qtyUsed), Number(row.itemID)]
				);
			}

			// delete children first, then delete the appointment row
			await conn.execute("delete from appointment_consumable where appointmentID = ?", [appointmentID]);
			await conn.execute("delete from appointment_staff where appointmentID = ?", [appointmentID]);
			await conn.execute("delete from appointment_form where appointmentID = ?", [appointmentID]);
			await conn.execute("delete from appointment where appointmentID = ?", [appointmentID]);

			return { ok: true };
		});

		if (!result.ok) {
			res.status(result.status || 500).json({ error: result.error || "failed to cancel appointment" });
			return;
		}

		res.json({ message: "appointment canceled" });
	} catch (err) {
		console.error("cancel appointment error", err);
		res.status(500).json({ error: "failed to cancel appointment" });
	}
});

export default router;