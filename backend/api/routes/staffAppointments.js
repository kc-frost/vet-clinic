import express from "express";
import { pool } from "../db.js";
import { requireStaff } from "../lib/authMiddleware.js";
import { cancelAppointment } from "../lib/appointmentCancellationService.js";

const router = express.Router();

router.post("/me/appointments/:id/cancel", requireStaff, async (req, res) => {
  try {
    const appointmentID = Number(req.params.id);
    const canceledByUserID = Number(req.session.userID);
    const cancellationReason = String(req.body?.cancellationReason || "").trim();

    if (!Number.isInteger(appointmentID) || appointmentID <= 0) {
      return res.status(400).json({ error: "invalid appointment id" });
    }

    if (!cancellationReason) {
      return res.status(400).json({ error: "cancellationReason is required" });
    }

    const [staffRows] = await pool.query(
      `SELECT staffID
       FROM staff
       WHERE userID = ?
       LIMIT 1`,
      [canceledByUserID]
    );

    if (!staffRows.length) {
      return res.status(404).json({ error: "staff profile not found" });
    }

    const staffID = Number(staffRows[0].staffID);

    const [assignmentRows] = await pool.query(
      `SELECT a.appointmentID
       FROM appointment_staff aps
       INNER JOIN appointment a
         ON a.appointmentID = aps.appointmentID
       WHERE aps.appointmentID = ?
         AND aps.staffID = ?
       LIMIT 1`,
      [appointmentID, staffID]
    );

    if (!assignmentRows.length) {
      return res.status(403).json({ error: "you can only cancel your own assigned appointments" });
    }

    const result = await cancelAppointment({
      appointmentID,
      canceledByUserID,
      canceledByType: "STAFF",
      cancellationReason,
    });

    res.json({ message: "appointment canceled", result });
  } catch (err) {
    const status = Number(err?.status || 500);
    res.status(status).json({
      error: err instanceof Error ? err.message : "failed to cancel appointment",
    });
  }
});

export default router;