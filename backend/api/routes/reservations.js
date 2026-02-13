import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

/**
 * =========================================================
 * DB column/table mappings
 * =========================================================
 */
const TABLES = {
  appointment: "appointment",
  rooms: "rooms",
  equipment: "equipment",
  inventory: "inventory",
};

const COL = {
  // appointment
  apptId: "appointmentID",
  apptDateTime: "date",
  apptReason: "reason",
  apptUserEmail: "userEmail",
  apptVetID: "vetID",
  apptPetID: "petID",
  apptEquipmentRequired: "equipmentRequired",

  // rooms
  roomType: "roomType",
  roomQty: "capacity",

  // equipment
  eqId: "equipmentID",
  eqType: "equipmentType",

  // inventory
  invEqId: "equipmentID",
  invQty: "quantity",
};

/**
 * =========================================================
 * reasonKey -> required resources per appointment
 * =========================================================
 */
const REASON_REQUIREMENTS = {
  wellness_exam: {
    rooms: { checkup_room: 1 },
    equipment: {},
  },
  fracture: {
    rooms: { xray_room: 1 },
    equipment: { xray_machine: 1 },
  },
  surgery_consult: {
    rooms: { surgery_room: 1 },
    equipment: { ultrasound: 1 },
  },
  vaccination: {
    rooms: { checkup_room: 1 },
    equipment: {},
  },
};

const SLOT_TEMPLATES = [
  { start: "09:00", end: "10:00" },
  { start: "10:00", end: "11:00" },
  { start: "11:00", end: "12:00" },
  { start: "13:00", end: "14:00" },
  { start: "14:00", end: "15:00" },
  { start: "15:00", end: "16:00" },
];

function normalizeReasonKey(reasonKey) {
  return String(reasonKey || "").trim().toLowerCase();
}

function normalizeResourceKey(v) {
  let s = String(v || "").trim();
  s = s.replace(/([a-z0-9])([A-Z])/g, "$1_$2"); // split camelCase
  s = s.replace(/[\s-]+/g, "_"); // spaces/hyphens -> _
  s = s.replace(/[^\w]/g, ""); // drop weird chars
  s = s.replace(/_+/g, "_"); // collapse __
  return s.toLowerCase();
}

function ensureReason(reasonKey) {
  const k = normalizeReasonKey(reasonKey);
  return REASON_REQUIREMENTS[k] ? k : null;
}

function slotKey(dateStr, startTime) {
  return `${dateStr}|${startTime}`;
}

function addDaysUTC(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateRange(startDate, endDate) {
  const out = [];
  let cur = startDate;
  while (cur <= endDate) {
    out.push(cur);
    cur = addDaysUTC(cur, 1);
  }
  return out;
}

function combineDateAndTimeSQL(dateStr, hhmm) {
  return `${dateStr} ${hhmm}:00`;
}

function buildSlots(startDate, endDate) {
  const days = dateRange(startDate, endDate);
  const out = [];
  for (const d of days) {
    for (const t of SLOT_TEMPLATES) {
      out.push({
        slotId: `slot_${d}_${t.start.replace(":", "")}_${t.end.replace(":", "")}`,
        date: d,
        startTime: t.start,
        endTime: t.end,
        displayLabel: `${t.start} - ${t.end}`,
      });
    }
  }
  return out;
}

async function fetchCapacities(conn) {
  const roomSql = `
    SELECT ${COL.roomType} AS type, COALESCE(SUM(${COL.roomQty}), 0) AS qty
    FROM ${TABLES.rooms}
    GROUP BY ${COL.roomType}
  `;

  const eqSql = `
    SELECT e.${COL.eqType} AS type, COALESCE(SUM(i.${COL.invQty}), 0) AS qty
    FROM ${TABLES.inventory} i
    JOIN ${TABLES.equipment} e ON e.${COL.eqId} = i.${COL.invEqId}
    GROUP BY e.${COL.eqType}
  `;

  const [roomRows] = await conn.query(roomSql);
  const [eqRows] = await conn.query(eqSql);

  const roomCaps = {};
  const eqCaps = {};

  for (const r of roomRows) {
    roomCaps[normalizeResourceKey(r.type)] = Number(r.qty || 0);
  }
  for (const e of eqRows) {
    eqCaps[normalizeResourceKey(e.type)] = Number(e.qty || 0);
  }

  return { roomCaps, eqCaps };
}

/**
 * Returns rows shape:
 * { id, dateStr: YYYY-MM-DD, startTime: HH:MM, reasonKey }
 */
async function fetchAppointmentsInRange(conn, startDate, endDate) {
  const startTs = `${startDate} 00:00:00`;
  const endTs = `${endDate} 23:59:59`;

  const sql = `
    SELECT
      ${COL.apptId} AS id,
      DATE_FORMAT(${COL.apptDateTime}, '%Y-%m-%d') AS dateStr,
      DATE_FORMAT(${COL.apptDateTime}, '%H:%i') AS startTime,
      ${COL.apptReason} AS reasonKey
    FROM ${TABLES.appointment}
    WHERE ${COL.apptDateTime} BETWEEN ? AND ?
  `;

  const [rows] = await conn.query(sql, [startTs, endTs]);
  return rows;
}

/**
 * Expects rows with at least:
 * - dateStr: YYYY-MM-DD
 * - startTime: HH:MM
 * - reasonKey
 */
function buildSlotUsage(rows) {
  const usage = {};

  for (const r of rows) {
    const dateStr = String(r.dateStr || "").trim();
    const startTime = String(r.startTime || "").slice(0, 5).trim();
    const reasonKey = normalizeReasonKey(r.reasonKey);

    if (!dateStr || !startTime) continue;

    const req = REASON_REQUIREMENTS[reasonKey];
    if (!req) continue;

    const sk = slotKey(dateStr, startTime);
    if (!usage[sk]) usage[sk] = { rooms: {}, equipment: {} };

    for (const [rtype, units] of Object.entries(req.rooms)) {
      const rr = normalizeResourceKey(rtype);
      usage[sk].rooms[rr] = (usage[sk].rooms[rr] || 0) + Number(units);
    }

    for (const [etype, units] of Object.entries(req.equipment)) {
      const ee = normalizeResourceKey(etype);
      usage[sk].equipment[ee] = (usage[sk].equipment[ee] || 0) + Number(units);
    }
  }

  return usage;
}

function hasCapacity(requirements, currentUsage, roomCaps, eqCaps) {
  for (const [rtype, needed] of Object.entries(requirements.rooms)) {
    const rr = normalizeResourceKey(rtype);
    const cap = Number(roomCaps[rr] || 0);
    const used = Number(currentUsage.rooms?.[rr] || 0);
    if (used + Number(needed) > cap) return false;
  }

  for (const [etype, needed] of Object.entries(requirements.equipment)) {
    const ee = normalizeResourceKey(etype);
    const cap = Number(eqCaps[ee] || 0);
    const used = Number(currentUsage.equipment?.[ee] || 0);
    if (used + Number(needed) > cap) return false;
  }

  return true;
}

/**
 * GET /api/reservations/availability
 * query: reasonKey, startDate, endDate
 */
router.get("/availability", async (req, res) => {
  try {
    const reasonKey = ensureReason(req.query.reasonKey);
    const startDate = String(req.query.startDate || "").trim();
    const endDate = String(req.query.endDate || "").trim();

    if (!reasonKey) {
      return res.status(400).json({ code: "BAD_REASON", message: "Invalid reasonKey" });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({
        code: "BAD_DATE_RANGE",
        message: "startDate and endDate are required (YYYY-MM-DD)",
      });
    }

    const conn = await pool.getConnection();
    try {
      const { roomCaps, eqCaps } = await fetchCapacities(conn);
      const appts = await fetchAppointmentsInRange(conn, startDate, endDate);
      const usage = buildSlotUsage(appts);
      const reqForReason = REASON_REQUIREMENTS[reasonKey];

      console.log("[availability] reason=", reasonKey);
      console.log("[availability] range=", startDate, "to", endDate);
      console.log("[availability] roomCaps=", roomCaps);
      console.log("[availability] eqCaps=", eqCaps);
      console.log("[availability] appts_count=", appts.length);
      console.log(
        "[availability] sample_appts=",
        appts.slice(0, 5).map((a) => ({
          id: a.id,
          dateStr: a.dateStr,
          startTime: a.startTime,
          reasonKey: a.reasonKey,
        }))
      );

      const available = buildSlots(startDate, endDate).filter((s) => {
        const sk = slotKey(s.date, s.startTime);
        const current = usage[sk] || { rooms: {}, equipment: {} };
        const ok = hasCapacity(reqForReason, current, roomCaps, eqCaps);

        // Log target slot aggressively for debugging
        if (s.date === "2026-02-15" && s.startTime === "11:00") {
          console.log("[availability][target-slot]", {
            slot: sk,
            current,
            required: reqForReason,
            ok,
          });
        }

        return ok;
      });

      return res.json({ reasonKey, slots: available });
    } finally {
      conn.release();
    }
  } catch (e) {
    return res.status(500).json({ code: "SERVER_ERROR", message: e.message });
  }
});

/**
 * POST /api/reservations
 * body supports:
 * - reasonKey OR reasonForVisit
 * - appointmentDate (YYYY-MM-DD)
 * - startTime (HH:MM) OR appointmentTimeSlot ("HH:MM - HH:MM")
 * - userEmail, vetID, petID
 */
router.post("/", async (req, res) => {
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const reasonRaw = req.body.reasonKey ?? req.body.reasonForVisit;
    const reasonKey = ensureReason(reasonRaw);
    const appointmentDate = String(req.body.appointmentDate || "").trim();

    let startTime = String(req.body.startTime || "").trim();
    if (!startTime) {
      const rawSlot = String(req.body.appointmentTimeSlot || "").trim();
      if (rawSlot.includes("-")) startTime = rawSlot.split("-")[0].trim();
    }

    if (!reasonKey) {
      await conn.rollback();
      return res.status(400).json({ code: "BAD_REASON", message: "Invalid reason key" });
    }

    if (!appointmentDate || !startTime) {
      await conn.rollback();
      return res.status(400).json({
        code: "BAD_INPUT",
        message: "appointmentDate and startTime (or appointmentTimeSlot) are required",
      });
    }

    const validStart = SLOT_TEMPLATES.some((t) => t.start === startTime);
    if (!validStart) {
      await conn.rollback();
      return res.status(400).json({ code: "BAD_SLOT", message: "Invalid slot start time" });
    }

    const { roomCaps, eqCaps } = await fetchCapacities(conn);

    // lock that day for race-safe capacity check
    const [sameDay] = await conn.query(
      `
      SELECT
        ${COL.apptId} AS id,
        DATE_FORMAT(${COL.apptDateTime}, '%Y-%m-%d') AS dateStr,
        DATE_FORMAT(${COL.apptDateTime}, '%H:%i') AS startTime,
        ${COL.apptReason} AS reasonKey
      FROM ${TABLES.appointment}
      WHERE DATE(${COL.apptDateTime}) = ?
      FOR UPDATE
      `,
      [appointmentDate]
    );

    const usage = buildSlotUsage(sameDay);
    const sk = slotKey(appointmentDate, startTime);
    const current = usage[sk] || { rooms: {}, equipment: {} };
    const reqForReason = REASON_REQUIREMENTS[reasonKey];
    const canBook = hasCapacity(reqForReason, current, roomCaps, eqCaps);

    console.log("[create] payload=", {
      reasonKey,
      appointmentDate,
      startTime,
      userEmail: req.body.userEmail ?? null,
    });
    console.log("[create] roomCaps=", roomCaps);
    console.log("[create] eqCaps=", eqCaps);
    console.log("[create] sameDay_count=", sameDay.length);
    console.log("[create] slotKey=", sk);
    console.log("[create] currentUsage=", current);
    console.log("[create] required=", reqForReason);
    console.log("[create] canBook=", canBook);

    if (!canBook) {
      await conn.rollback();
      return res.status(409).json({
        code: "NO_CAPACITY",
        message: "Selected slot is no longer available for this reason",
      });
    }

    const appointmentDateTime = combineDateAndTimeSQL(appointmentDate, startTime);
    const equipmentRequiredSummary = Object.keys(reqForReason.equipment).join(",");

    const insertSql = `
      INSERT INTO ${TABLES.appointment}
      (${COL.apptUserEmail}, ${COL.apptVetID}, ${COL.apptPetID}, ${COL.apptReason}, ${COL.apptDateTime}, ${COL.apptEquipmentRequired})
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    const [result] = await conn.query(insertSql, [
      req.body.userEmail ?? null,
      req.body.vetID ?? null,
      req.body.petID ?? null,
      reasonKey,
      appointmentDateTime,
      equipmentRequiredSummary,
    ]);

    await conn.commit();

    return res.status(201).json({
      message: "Reservation created",
      reservationId: result.insertId,
    });
  } catch (e) {
    await conn.rollback();
    return res.status(500).json({ code: "SERVER_ERROR", message: e.message });
  } finally {
    conn.release();
  }
});

export default router;
