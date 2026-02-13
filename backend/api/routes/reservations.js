import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

const DEBUG_RESERVATIONS = true; // set false after fixing, MODIFIED

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

function dbg(...args) {
  if (DEBUG_RESERVATIONS) console.log("[reservations]", ...args);
}

function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

function toDateOnlyUTC(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function addDaysUTC(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateOnlyUTC(d);
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

function normalizeReasonKey(reasonKey) {
  return String(reasonKey || "").trim().toLowerCase();
}

function normalizeResourceKey(v) {
  let s = String(v || "").trim();

  // split camelCase / PascalCase boundaries
  s = s.replace(/([a-z0-9])([A-Z])/g, "$1_$2");

  // spaces/hyphens -> underscore
  s = s.replace(/[\s-]+/g, "_");

  // remove non-word except underscore
  s = s.replace(/[^\w]/g, "");

  // collapse multiple underscores
  s = s.replace(/_+/g, "_");

  return s.toLowerCase();
}

function ensureReason(reasonKey) {
  const k = normalizeReasonKey(reasonKey);
  return REASON_REQUIREMENTS[k] ? k : null;
}

function slotKey(dateStr, startTime) {
  return `${dateStr}|${startTime}`;
}

async function fetchCapacities(conn) {
  const roomSql = `
    SELECT ${COL.roomType} AS type, COALESCE(SUM(${COL.roomQty}),0) AS qty
    FROM ${TABLES.rooms}
    GROUP BY ${COL.roomType}
  `;

  const eqSql = `
    SELECT e.${COL.eqType} AS type, COALESCE(SUM(i.${COL.invQty}),0) AS qty
    FROM ${TABLES.inventory} i
    JOIN ${TABLES.equipment} e ON e.${COL.eqId} = i.${COL.invEqId}
    GROUP BY e.${COL.eqType}
  `;

  const [roomRows] = await conn.query(roomSql);
  const [eqRows] = await conn.query(eqSql);

  const roomCaps = {};
  const eqCaps = {};

  for (const r of roomRows) {
    const key = normalizeResourceKey(r.type);
    roomCaps[key] = Number(r.qty || 0);
  }

  for (const e of eqRows) {
    const key = normalizeResourceKey(e.type);
    eqCaps[key] = Number(e.qty || 0);
  }

  dbg("raw roomRows:", roomRows);
  dbg("raw eqRows:", eqRows);
  dbg("roomCaps:", roomCaps);
  dbg("eqCaps:", eqCaps);

  return { roomCaps, eqCaps };
}

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
  dbg("fetchAppointmentsInRange", { startDate, endDate, count: rows.length });
  dbg("appts sample:", rows.slice(0, 20));
  return rows;
}

function buildSlotUsage(appts) {
  const usage = {};

  for (const a of appts) {
    let dateStr = "";
    let startTime = "";

    if (a.dateStr && a.startTime) {
      dateStr = String(a.dateStr);
      startTime = String(a.startTime).slice(0, 5);
    } else if (a.startAt) {
      const raw = String(a.startAt);
      if (raw.includes(" ")) {
        const [d, t] = raw.split(" ");
        dateStr = d;
        startTime = t.slice(0, 5);
      } else {
        const dt = new Date(raw);
        if (!Number.isNaN(dt.getTime())) {
          dateStr = toDateOnlyUTC(dt);
          startTime = `${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}`;
        }
      }
    }

    if (!dateStr || !startTime) continue;

    const rk = normalizeReasonKey(a.reasonKey);
    const req = REASON_REQUIREMENTS[rk];
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

      const probeKey = `${startDate}|11:00`;
      dbg("availability reasonKey:", reasonKey);
      dbg("usage[probe 11:00]:", usage[probeKey] || { rooms: {}, equipment: {} });
      dbg("requirements for reason:", reqForReason);

      const available = buildSlots(startDate, endDate).filter((s) => {
        const sk = slotKey(s.date, s.startTime);
        const u = usage[sk] || { rooms: {}, equipment: {} };
        return hasCapacity(reqForReason, u, roomCaps, eqCaps);
      });

      dbg("availability returned slot count:", available.length);

      return res.json({ reasonKey, slots: available });
    } finally {
      conn.release();
    }
  } catch (e) {
    return res.status(500).json({ code: "SERVER_ERROR", message: e.message });
  }
});

router.post("/", async (req, res) => {
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const reasonRaw = req.body.reasonKey ?? req.body.reasonForVisit;
    const reasonKey = ensureReason(reasonRaw);
    const appointmentDate = String(req.body.appointmentDate || "").trim();

    let startTime = String(req.body.startTime || "").trim();
    if (!startTime) {
      const s = String(req.body.appointmentTimeSlot || "").trim();
      if (s.includes("-")) startTime = s.split("-")[0].trim();
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

    dbg("POST payload:", { reasonRaw, reasonKey, appointmentDate, startTime });
    dbg("POST roomCaps/eqCaps:", { roomCaps, eqCaps });
    dbg("POST sameDay count:", sameDay.length);
    dbg("POST usage at slot:", { sk, current });
    dbg("POST reqForReason:", reqForReason);

    const canBook = hasCapacity(reqForReason, current, roomCaps, eqCaps);
    dbg("POST canBook:", canBook);

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
