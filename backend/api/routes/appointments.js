import express from "express";
import { pool } from "../db.js";
import { requireAuth, requireAdmin } from "../lib/authMiddleware.js";

const router = express.Router();

// clinic hours expressed in minutes so time math stays consistent
const OPEN_MINUTES = 9 * 60;
const CLOSE_MINUTES = 17 * 60;
const SLOT_STEP_MINUTES = 15;

// scheduling rules copied here so user owned reschedule can create a new appointment
const REASON_RULES = {
	WELLNESS_EXAM: {
		reasonKey: "WELLNESS_EXAM",
		durationMinutes: 45,
		staffRole: "VET",
		roomType: "EXAM",
		nonConsumables: [],
		consumables: [{ itemKey: "EXAM_SUPPLY_KIT", qty: 1 }],
	},
	VACCINATION: {
		reasonKey: "VACCINATION",
		durationMinutes: 15,
		staffRole: "VET",
		roomType: "EXAM",
		nonConsumables: [],
		consumables: [{ itemKey: "VACCINE_DOSE", qty: 1 }],
	},
	DENTAL_CLEANING: {
		reasonKey: "DENTAL_CLEANING",
		durationMinutes: 75,
		staffRole: "VET",
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
		staffRole: "VET",
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
		staffRole: "PET_GROOMER",
		roomType: "GROOMING",
		nonConsumables: [],
		consumables: [{ itemKey: "SHAMPOO_DOSE", qty: 1 }],
	},
	EMERGENCY_TRAUMA: {
		reasonKey: "EMERGENCY_TRAUMA",
		durationMinutes: 120,
		staffRole: "VET",
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
		staffRole: "VET",
		roomType: "IMAGING",
		nonConsumables: ["ULTRASOUND_MACHINE"],
		consumables: [],
	},
};

function getRule(reasonKeyRaw) {
	const key = String(reasonKeyRaw || "").trim().toUpperCase();
	return REASON_RULES[key] || null;
}

function pad2(n) {
	return String(n).padStart(2, "0");
}

function isValidDateOnly(dateStr) {
	return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

function isValidTimeOnly(timeStr) {
	return /^\d{2}:\d{2}$/.test(timeStr);
}

function timeStrToMinutes(timeStr) {
	const [hStr, mStr] = String(timeStr || "").split(":");
	const h = Number(hStr);
	const m = Number(mStr);
	if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
	return h * 60 + m;
}

function minutesToTimeStr(totalMinutes) {
	const h = Math.floor(totalMinutes / 60);
	const m = totalMinutes % 60;
	return `${pad2(h)}:${pad2(m)}`;
}

function formatSqlDateTime(dateStr, timeStr) {
	return `${dateStr} ${timeStr}:00`;
}

function isStartAligned(minutes) {
	return minutes % SLOT_STEP_MINUTES === 0;
}

function sqlDateTimeToDate(value) {
	if (value instanceof Date) return value;

	const str = String(value || "");
	if (!str) return new Date(NaN);

	if (/^\d{4}-\d{2}-\d{2} /.test(str)) {
		return new Date(str.replace(" ", "T"));
	}

	return new Date(str);
}

function getDateOnly(sqlDateTime) {
	const dt = sqlDateTimeToDate(sqlDateTime);
	if (!Number.isNaN(dt.getTime())) {
		return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
	}

	return String(sqlDateTime || "").split(" ")[0] || "";
}

function buildItemKeyToRowMap(rows) {
	const map = new Map();
	for (const row of rows) {
		map.set(row.itemKey, row);
	}
	return map;
}

function bucketCountFromDuration(durationMinutes) {
	return Math.ceil(durationMinutes / SLOT_STEP_MINUTES);
}

function getRequestUserId(req) {
	const sessionUser = req.session?.user || null;
	const raw = sessionUser?.userID ?? req.session?.userID ?? null;
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) return null;
	return n;
}

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

async function selectAvailableStaff(conn, role, startSql, endSql) {
	const [rows] = await conn.execute(
		`select s.staffID
		 from staff s
		 where s.role = ?
		 and not exists (
			select 1 from appointment a
			where a.staffID = s.staffID
			and a.date < ?
			and date_add(a.date, interval a.durationMinutes minute) > ?
		 )
		 order by s.staffID asc
		 limit 1
		 for update`,
		[role, endSql, startSql]
	);

	if (!rows.length) return null;
	return Number(rows[0].staffID);
}

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

			if (used >= capacity) {
				return { ok: false, error: `no capacity for ${equipKey} in that time window` };
			}
		}
	}

	return { ok: true, error: "" };
}

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

async function insertAppointmentFormFromSnapshot(conn, appointmentID, form) {
	// writes a cloned snapshot from the original appointment_form row
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

async function deleteAppointmentInsideTransaction(conn, appointmentID) {
	// refunds consumables and removes the appointment plus child rows
	const [consRows] = await conn.execute(
		`select ac.itemID, ac.qtyUsed
		 from appointment_consumable ac
		 where ac.appointmentID = ?
		 for update`,
		[appointmentID]
	);

	for (const row of consRows) {
		await conn.execute(
			"update inventory set quantity = quantity + ? where itemID = ? and isConsumable = 1",
			[Number(row.qtyUsed), Number(row.itemID)]
		);
	}

	await conn.execute("delete from appointment_consumable where appointmentID = ?", [appointmentID]);
	await conn.execute("delete from appointment_form where appointmentID = ?", [appointmentID]);
	await conn.execute("delete from appointment where appointmentID = ?", [appointmentID]);
}

async function createRescheduledAppointmentInsideTransaction(conn, oldApptRow, oldFormRow, newDate, newStartTime) {
	const rule = getRule(oldApptRow.reasonKey);
	if (!rule) {
		return { ok: false, status: 400, error: "invalid appointment reason for reschedule" };
	}

	if (!isValidDateOnly(newDate) || !isValidTimeOnly(newStartTime)) {
		return { ok: false, status: 400, error: "invalid appointmentDate or startTime" };
	}

	const startMinutes = timeStrToMinutes(newStartTime);
	if (!Number.isFinite(startMinutes) || !isStartAligned(startMinutes)) {
		return { ok: false, status: 400, error: "startTime must be on a 15 minute boundary" };
	}

	const endMinutes = startMinutes + rule.durationMinutes;
	if (startMinutes < OPEN_MINUTES || endMinutes > CLOSE_MINUTES) {
		return { ok: false, status: 400, error: "appointment time outside clinic hours" };
	}

	const startSql = formatSqlDateTime(newDate, newStartTime);
	const endTime = minutesToTimeStr(endMinutes);
	const endSql = formatSqlDateTime(newDate, endTime);

	const userID = Number(oldApptRow.userID);
	const petID = oldApptRow.petID === null ? null : Number(oldApptRow.petID);

	// user overlap still needs checking in case they have another appointment besides the one being replaced
	const [userOverlapRows] = await conn.execute(
		`select appointmentID
		 from appointment
		 where userID = ?
		 and date < ?
		 and date_add(date, interval durationMinutes minute) > ?
		 for update`,
		[userID, endSql, startSql]
	);

	if (userOverlapRows.length) {
		return { ok: false, status: 409, error: "you already have an overlapping appointment" };
	}

	const staffID = await selectAvailableStaff(conn, rule.staffRole, startSql, endSql);
	if (!staffID) {
		return { ok: false, status: 409, error: "no staff available for that time" };
	}

	const roomNumber = await selectAvailableRoom(conn, rule.roomType, startSql, endSql);
	if (!roomNumber) {
		return { ok: false, status: 409, error: "no room available for that time" };
	}

	const equipCheck = await checkNonConsumableCapacityForInterval(conn, rule, startSql, endSql);
	if (!equipCheck.ok) {
		return { ok: false, status: 409, error: equipCheck.error };
	}

	const consumableReserve = await reserveConsumables(conn, rule);
	if (!consumableReserve.ok) {
		return { ok: false, status: 409, error: consumableReserve.error };
	}

	const [apptInsert] = await conn.execute(
		`insert into appointment (
			userID,
			petID,
			staffID,
			roomNumber,
			reasonKey,
			date,
			durationMinutes
		) values (?,?,?,?,?,?,?)`,
		[userID, petID, staffID, roomNumber, rule.reasonKey, startSql, rule.durationMinutes]
	);

	const newAppointmentID = Number(apptInsert.insertId);

	await insertAppointmentFormFromSnapshot(conn, newAppointmentID, oldFormRow);

	for (const r of consumableReserve.reserved || []) {
		await conn.execute(
			"insert into appointment_consumable (appointmentID, itemID, qtyUsed) values (?,?,?)",
			[newAppointmentID, r.itemID, r.qtyUsed]
		);
	}

	return {
		ok: true,
		appointmentID: newAppointmentID,
		reasonKey: rule.reasonKey,
		date: newDate,
		durationMinutes: rule.durationMinutes,
		staffID,
		roomNumber,
		petID,
	};
}

// GET /api/appointments
// admin only list of all appointments with more data to display
router.get("/", requireAdmin, async (req, res) => {
	try {
		const [rows] = await pool.query(`
			SELECT
				a.appointmentID,
				a.userID,
				c.email AS userEmail,
				a.staffID,
				s.name AS staffName,
				a.roomNumber,
				r.roomType,
				a.petID,
				a.reasonKey,
				a.date,
				a.durationMinutes,
				DATE_ADD(a.date, INTERVAL a.durationMinutes MINUTE) AS endDateTime,
				COALESCE(
					GROUP_CONCAT(
						CONCAT(COALESCE(i.displayName, i.itemKey), ' (x', ac.qtyUsed, ')')
						ORDER BY COALESCE(i.displayName, i.itemKey)
						SEPARATOR ', '
					),
					''
				) AS equipmentUsed
			FROM appointment a
			LEFT JOIN customer c
				ON c.userID = a.userID
			LEFT JOIN staff s
				ON s.staffID = a.staffID
			LEFT JOIN rooms r
				ON r.roomNumber = a.roomNumber
			LEFT JOIN appointment_consumable ac
				ON ac.appointmentID = a.appointmentID
			LEFT JOIN inventory i
				ON i.itemID = ac.itemID
			GROUP BY
				a.appointmentID,
				a.userID,
				c.email,
				a.staffID,
				s.name,
				a.roomNumber,
				r.roomType,
				a.petID,
				a.reasonKey,
				a.date,
				a.durationMinutes
			ORDER BY a.date ASC
		`);

		res.json(rows);
	} catch (err) {
		console.error("GET /api/appointments error:", err);
		res.status(500).json({ error: "failed to fetch appointments" });
	}
});

// GET /api/appointments/mine
// logged in user route that returns only that user's own appointments
router.get("/mine", requireAuth, async (req, res) => {
	try {
		const userID = getRequestUserId(req);

		const [rows] = await pool.query(
			`
			SELECT
				a.appointmentID,
				a.userID,
				a.staffID,
				a.roomNumber,
				a.petID,
				a.reasonKey,
				a.date,
				a.durationMinutes
			FROM appointment a
			WHERE a.userID = ?
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

// DELETE /api/appointments/mine/:id
// logged in user cancel for one of their own current or future appointments
router.delete("/mine/:id", requireAuth, async (req, res) => {
	try {
		const userID = getRequestUserId(req);
		const appointmentID = Number(req.params.id);

		if (!Number.isInteger(appointmentID) || appointmentID <= 0) {
			return res.status(400).json({ error: "invalid appointment id" });
		}

		const result = await withTransaction(async (conn) => {
			const [rows] = await conn.execute(
				`select appointmentID, userID, date
				 from appointment
				 where appointmentID = ?
				 for update`,
				[appointmentID]
			);

			if (!rows.length) {
				return { ok: false, status: 404, error: "appointment not found" };
			}

			const appt = rows[0];
			if (Number(appt.userID) !== userID) {
				return { ok: false, status: 403, error: "not allowed to cancel this appointment" };
			}

			const startDt = sqlDateTimeToDate(appt.date);
			if (startDt.getTime() < Date.now()) {
				return { ok: false, status: 400, error: "past appointments cannot be canceled" };
			}

			await deleteAppointmentInsideTransaction(conn, appointmentID);
			return { ok: true };
		});

		if (!result.ok) {
			return res.status(result.status || 500).json({ error: result.error || "failed to cancel appointment" });
		}

		res.json({ message: "appointment canceled" });
	} catch (err) {
		console.error("DELETE /api/appointments/mine/:id error:", err);
		res.status(500).json({ error: "failed to cancel appointment" });
	}
});

// POST /api/appointments/mine/:id/reschedule
// logged in user reschedule for one of their own current or future appointments
// this deletes the old appointment and creates a new one inside one transaction
router.post("/mine/:id/reschedule", requireAuth, async (req, res) => {
	try {
		const userID = getRequestUserId(req);
		const oldAppointmentID = Number(req.params.id);
		const appointmentDate = String(req.body?.appointmentDate || "");
		const startTime = String(req.body?.startTime || "");

		if (!Number.isInteger(oldAppointmentID) || oldAppointmentID <= 0) {
			return res.status(400).json({ error: "invalid appointment id" });
		}

		const result = await withTransaction(async (conn) => {
			const [apptRows] = await conn.execute(
				`select *
				 from appointment
				 where appointmentID = ?
				 for update`,
				[oldAppointmentID]
			);

			if (!apptRows.length) {
				return { ok: false, status: 404, error: "appointment not found" };
			}

			const oldAppt = apptRows[0];
			if (Number(oldAppt.userID) !== userID) {
				return { ok: false, status: 403, error: "not allowed to reschedule this appointment" };
			}

			const oldStartDt = sqlDateTimeToDate(oldAppt.date);
			if (oldStartDt.getTime() < Date.now()) {
				return { ok: false, status: 400, error: "past appointments cannot be rescheduled" };
			}

			const [formRows] = await conn.execute(
				`select *
				 from appointment_form
				 where appointmentID = ?
				 for update`,
				[oldAppointmentID]
			);

			if (!formRows.length) {
				return { ok: false, status: 404, error: "appointment snapshot not found" };
			}

			const oldForm = formRows[0];

			// delete old appointment inside the same transaction
			// if the new appointment creation fails, the rollback restores everything
			await deleteAppointmentInsideTransaction(conn, oldAppointmentID);

			const createResult = await createRescheduledAppointmentInsideTransaction(
				conn,
				oldAppt,
				oldForm,
				appointmentDate,
				startTime
			);

			return createResult;
		});

		if (!result.ok) {
			return res.status(result.status || 500).json({ error: result.error || "failed to reschedule appointment" });
		}

		res.json({
			ok: true,
			appointmentId: result.appointmentID,
			reasonKey: result.reasonKey,
			date: result.date,
			durationMinutes: result.durationMinutes,
			staffID: result.staffID,
			roomNumber: result.roomNumber,
			petID: result.petID,
			message: "appointment rescheduled",
		});
	} catch (err) {
		console.error("POST /api/appointments/mine/:id/reschedule error:", err);
		res.status(500).json({ error: "failed to reschedule appointment" });
	}
});

// DELETE /api/appointments/:id
// admin only delete and refund any consumables tied to the appointment
router.delete("/:id", requireAdmin, async (req, res) => {
	try {
		const appointmentID = Number(req.params.id);

		if (!Number.isInteger(appointmentID) || appointmentID <= 0) {
			return res.status(400).json({ error: "invalid appointment id" });
		}

		const result = await withTransaction(async (conn) => {
			const [rows] = await conn.execute(
				`select appointmentID
				 from appointment
				 where appointmentID = ?
				 for update`,
				[appointmentID]
			);

			if (!rows.length) {
				return { ok: false, status: 404, error: "appointment not found" };
			}

			await deleteAppointmentInsideTransaction(conn, appointmentID);
			return { ok: true };
		});

		if (!result.ok) {
			return res.status(result.status || 500).json({ error: result.error || "failed to delete appointment" });
		}

		res.status(204).send();
	} catch (err) {
		console.error("DELETE /api/appointments/:id error:", err);
		res.status(500).json({ error: "failed to delete appointment" });
	}
});

export default router;