import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

/**
 * Frontend reason keys (contract source of truth)
 */
const REASON_KEYS = new Set([
  "wellness_exam",
  "vaccination",
  "sick_visit",
  "injury_general",
  "fracture",
  "wound_care",
  "skin_ear_issue",
  "gi_issue",
  "medication_refill",
  "follow_up",
  "other",
]);

/**
 * We generate a simple, stable set of bookable slots per day.
 * SlotId format must match frontend expectation:
 * slot_YYYY-MM-DD_HHMM_HHMM_roomX
 */
const SLOT_TEMPLATES = [
  { startHHMM: "0900", endHHMM: "1000", room: "roomA" },
  { startHHMM: "1000", endHHMM: "1100", room: "roomA" },
  { startHHMM: "1100", endHHMM: "1200", room: "roomA" },
  { startHHMM: "1300", endHHMM: "1400", room: "roomB" },
  { startHHMM: "1400", endHHMM: "1500", room: "roomB" },
  { startHHMM: "1500", endHHMM: "1600", room: "roomB" },
];

function isYYYYMMDD(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function localMidnight(dateStrYYYYMMDD) {
  const [y, m, d] = dateStrYYYYMMDD.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function todayLocalMidnight() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

function hhmmToColon(hhmm) {
  return `${hhmm.slice(0, 2)}:${hhmm.slice(2)}`;
}

function toDisplayLabel(startHHMM, endHHMM) {
  return `${hhmmToColon(startHHMM)} - ${hhmmToColon(endHHMM)}`;
}

function slotIdFor(dateYYYYMMDD, startHHMM, endHHMM, room) {
  return `slot_${dateYYYYMMDD}_${startHHMM}_${endHHMM}_${room}`;
}

function generateSlotsForDate(dateYYYYMMDD) {
  return SLOT_TEMPLATES.map((t) => ({
    slotId: slotIdFor(dateYYYYMMDD, t.startHHMM, t.endHHMM, t.room),
    date: dateYYYYMMDD,
    startTime: hhmmToColon(t.startHHMM),
    endTime: hhmmToColon(t.endHHMM),
    displayLabel: toDisplayLabel(t.startHHMM, t.endHHMM),
  }));
}

function dateRangeInclusive(startYYYYMMDD, endYYYYMMDD) {
  const start = localMidnight(startYYYYMMDD);
  const end = localMidnight(endYYYYMMDD);
  const out = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${dd}`);
  }
  return out;
}

/**
 * Parse: slot_YYYY-MM-DD_HHMM_HHMM_roomX  -> { date, startHHMM, endHHMM, room }
 */
function parseSlotId(slotId) {
  if (typeof slotId !== "string") return null;
  const parts = slotId.split("_");
  if (parts.length < 5) return null;
  if (parts[0] !== "slot") return null;

  const date = parts[1];
  const startHHMM = parts[2];
  const endHHMM = parts[3];
  const room = parts.slice(4).join("_"); // in case room name has underscores

  if (!isYYYYMMDD(date)) return null;
  if (!/^\d{4}$/.test(startHHMM) || !/^\d{4}$/.test(endHHMM)) return null;

  return { date, startHHMM, endHHMM, room };
}

/**
 * Convert slot -> DATETIME string "YYYY-MM-DD HH:MM:00"
 * We'll store the appointment start time in appointment.date (DATETIME).
 */
function slotToDatetimeString(slotId) {
  const parsed = parseSlotId(slotId);
  if (!parsed) return null;
  const hh = parsed.startHHMM.slice(0, 2);
  const mm = parsed.startHHMM.slice(2);
  return `${parsed.date} ${hh}:${mm}:00`;
}

/**
 * GET /api/appointments/availability
 * Query: reasonKey, startDate, endDate
 * Response: { reasonKey, slots: [...] }
 */
router.get("/availability", async (req, res) => {
  try {
    const { reasonKey, startDate, endDate } = req.query;

    if (!REASON_KEYS.has(reasonKey)) {
      return res.status(400).json({
        message: "Invalid reasonKey",
        code: "INVALID_REASON_KEY",
      });
    }
    if (!isYYYYMMDD(startDate) || !isYYYYMMDD(endDate)) {
      return res.status(400).json({
        message: "startDate and endDate must be YYYY-MM-DD",
        code: "INVALID_DATE_FORMAT",
      });
    }

    const start = localMidnight(startDate);
    const end = localMidnight(endDate);
    if (start > end) {
      return res.status(400).json({
        message: "startDate must be <= endDate",
        code: "INVALID_DATE_RANGE",
      });
    }

    // Pull existing appointment start times in that date window
    // Your DB stores a single datetime column named `date`.
    const [rows] = await pool.query(
      `
      SELECT date
      FROM appointment
      WHERE date >= ? AND date < DATE_ADD(?, INTERVAL 1 DAY)
      `,
      [`${startDate} 00:00:00`, `${endDate} 00:00:00`]
    );

    // Convert existing appointment DATETIMEs into slotIds so we can filter.
    // We only mark conflicts for times that match our slot templates.
    const bookedSlotIds = new Set();
    for (const r of rows) {
      const dt = new Date(r.date);
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, "0");
      const d = String(dt.getDate()).padStart(2, "0");
      const hh = String(dt.getHours()).padStart(2, "0");
      const mm = String(dt.getMinutes()).padStart(2, "0");
      const dateStr = `${y}-${m}-${d}`;
      const hhmm = `${hh}${mm}`;

      // If booked time matches one of our templates, consider that slot booked.
      for (const t of SLOT_TEMPLATES) {
        if (t.startHHMM === hhmm) {
          bookedSlotIds.add(slotIdFor(dateStr, t.startHHMM, t.endHHMM, t.room));
        }
      }
    }

    const days = dateRangeInclusive(startDate, endDate);
    const allSlots = days.flatMap((day) => generateSlotsForDate(day));
    const availableSlots = allSlots.filter((s) => !bookedSlotIds.has(s.slotId));

    return res.status(200).json({
      reasonKey,
      slots: availableSlots,
    });
  } catch (e) {
    return res.status(500).json({ message: e.message, code: "SERVER_ERROR" });
  }
});

/**
 * POST /api/appointments
 * Contract payload is large, but your DB stores a smaller subset:
 * - userEmail (from email)
 * - reason (from reasonForVisit or reasonDetails)
 * - date (DATETIME derived from appointmentTimeSlot)
 * - vetID, petID, equipmentRequired (optional if you don’t have them yet)
 */
router.post("/", async (req, res) => {
  try {
    const body = req.body || {};

    // Minimal required for your DB + frontend flow
    const missing = [];
    if (!body.email) missing.push("email");
    if (!body.reasonForVisit) missing.push("reasonForVisit");
    if (!body.appointmentDate) missing.push("appointmentDate");
    if (!body.appointmentTimeSlot) missing.push("appointmentTimeSlot");

    if (missing.length) {
      return res.status(400).json({
        message: `Missing required fields: ${missing.join(", ")}`,
        code: "MISSING_DATA",
        details: { missing },
      });
    }

    if (!REASON_KEYS.has(body.reasonForVisit)) {
      return res.status(400).json({
        message: "Invalid reasonForVisit",
        code: "INVALID_REASON_KEY",
      });
    }

    if (!isYYYYMMDD(body.appointmentDate)) {
      return res.status(400).json({
        message: "appointmentDate must be YYYY-MM-DD",
        code: "INVALID_DATE_FORMAT",
      });
    }

    // Must not be in the past (date-level check)
    if (localMidnight(body.appointmentDate) < todayLocalMidnight()) {
      return res.status(400).json({
        message: "Appointment date cannot be in the past",
        code: "PAST_DATE",
      });
    }

    // Slot must match the chosen date and our templates
    const parsed = parseSlotId(body.appointmentTimeSlot);
    if (!parsed || parsed.date !== body.appointmentDate) {
      return res.status(400).json({
        message: "appointmentTimeSlot is invalid for the selected date",
        code: "INVALID_SLOT",
      });
    }

    const validSlotIds = new Set(
      generateSlotsForDate(body.appointmentDate).map((s) => s.slotId)
    );
    if (!validSlotIds.has(body.appointmentTimeSlot)) {
      return res.status(400).json({
        message: "appointmentTimeSlot is not a valid bookable slot",
        code: "INVALID_SLOT",
      });
    }

    // Convert slot to DATETIME for storage in `appointment.date`
    const apptDatetime = slotToDatetimeString(body.appointmentTimeSlot);
    if (!apptDatetime) {
      return res.status(400).json({
        message: "Could not parse appointmentTimeSlot",
        code: "INVALID_SLOT",
      });
    }

    // Conflict: same exact datetime already booked
    const [conflictRows] = await pool.query(
      `SELECT 1 FROM appointment WHERE date = ? LIMIT 1`,
      [apptDatetime]
    );

    if (conflictRows.length > 0) {
      return res.status(409).json({
        message:
          "Selected time slot is no longer available. Please choose another slot.",
        code: "CONFLICT",
      });
    }

    // Build DB insert
    // Your table requires: userEmail, reason, date
    // vetID/petID/equipmentRequired may be optional depending on schema constraints.
    const userEmail = body.email;
    const reason = body.reasonDetails
      ? `${body.reasonForVisit}: ${body.reasonDetails}`
      : body.reasonForVisit;

    // Optional mapping (only include if provided, otherwise insert NULL)
    const vetID = body.vetID ?? null;
    const petID = body.petID ?? null;
    const equipmentRequired = body.equipmentRequired ?? null;

    const [result] = await pool.execute(
      `
      INSERT INTO appointment (userEmail, vetID, petID, reason, date, equipmentRequired)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [userEmail, vetID, petID, reason, apptDatetime, equipmentRequired]
    );

    return res.status(201).json({
      message: "Appointment created successfully",
      reservationId: `apt_${result.insertId}`,
    });
  } catch (e) {
    return res.status(500).json({ message: e.message, code: "SERVER_ERROR" });
  }
});

/**
 * GET /api/appointments
 * For Part 5: current + future only, sorted by appointment start time.
 * Your rubric wants: ID, Item Reserved, User Email, Start Date, End Date, delete.
 * Your schema currently only has `date` (start) and no end time or item name.
 * This endpoint returns what exists now; the frontend "View All" page can adapt.
 */
router.get("/", async (req, res) => {
  try {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const todayStr = `${yyyy}-${mm}-${dd} 00:00:00`;

    const [rows] = await pool.query(
      `
      SELECT appointmentID, userEmail, vetID, petID, reason, date, equipmentRequired
      FROM appointment
      WHERE date >= ?
      ORDER BY date ASC
      `,
      [todayStr]
    );

    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ message: e.message, code: "SERVER_ERROR" });
  }
});

/**
 * DELETE /api/appointments/:id
 */
router.delete("/:id", async (req, res) => {
  try {
    const [result] = await pool.execute(
      `DELETE FROM appointment WHERE appointmentID = ?`,
      [req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Not found", code: "NOT_FOUND" });
    }
    return res.status(204).send();
  } catch (e) {
    return res.status(500).json({ message: e.message, code: "SERVER_ERROR" });
  }
});

export default router;

