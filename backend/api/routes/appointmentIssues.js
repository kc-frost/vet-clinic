import express from "express";
import { requireAdmin } from "../lib/authMiddleware.js";
import { getUnderReviewAppointmentByID, getUnderReviewAppointments } from "../lib/appointmentIssueService.js";
import { cancelAppointment } from "../lib/appointmentCancellationService.js";

const router = express.Router();

router.get("/", requireAdmin, async (_req, res) => {
	try {
		// Load the full under review appointment list for the admin review page
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

router.post("/:appointmentID/cancel", requireAdmin, async (req, res) => {
	try {
	  const appointmentID = Number(req.params.appointmentID);
	  const canceledByUserID = Number(req.session.userID);
	  const cancellationReason = String(req.body?.cancellationReason || "").trim();
  
	  if (!Number.isInteger(appointmentID) || appointmentID <= 0) {
		return res.status(400).json({ message: "Invalid appointment id" });
	  }
  
	  if (!cancellationReason) {
		return res.status(400).json({ message: "Cancellation reason is required" });
	  }
  
	  const result = await cancelAppointment({
		appointmentID,
		canceledByUserID,
		canceledByType: "ADMIN",
		cancellationReason,
	  });
  
	  res.json({
		message: "Appointment canceled",
		result,
	  });
	} catch (err) {
	  const status = Number(err?.status || 500);
	  res.status(status).json({
		message: err instanceof Error ? err.message : "Failed to cancel appointment",
	  });
	}
  });

export default router;