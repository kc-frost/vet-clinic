import express from "express";
import { requireAdmin } from "../lib/authMiddleware.js";
import { cancelAppointment } from "../lib/appointmentCancellationService.js";
import { getUnderReviewAppointmentByID, getUnderReviewAppointments } from "../lib/appointmentIssueService.js";

const router = express.Router();

function toPositiveInt(value) {
	// Keep route IDs strict so bad params do not leak into DB work
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) return null;
	return parsed;
}

router.get("/", requireAdmin, async (_req, res) => {
	try {
		// Load the full under review appointment list for the admin issues page
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
		// Issue page cancel is still a normal admin cancellation
		const appointmentID = toPositiveInt(req.params.appointmentID);
		const adminUserID = Number(req.session?.userID);
		const cancellationReason = String(req.body?.cancellationReason || "").trim();

		if (!appointmentID) {
			return res.status(400).json({ message: "Invalid appointment id" });
		}

		if (!Number.isInteger(adminUserID) || adminUserID < 1) {
			return res.status(401).json({ message: "Missing admin session" });
		}

		if (!cancellationReason) {
			return res.status(400).json({ message: "Cancellation reason is required" });
		}

		const appointment = await getUnderReviewAppointmentByID(appointmentID);
		if (!appointment) {
			return res.status(404).json({ message: "Under-review appointment not found" });
		}

		const result = await cancelAppointment({
			appointmentID,
			canceledByUserID: adminUserID,
			canceledByType: "ADMIN",
			cancellationReason,
		});

		res.json({ message: "Appointment canceled", result });
	} catch (err) {
		const status = Number(err?.status || 500);
		console.error("POST /api/appointment-issues/:appointmentID/cancel error:", err);
		res.status(status).json({ message: err instanceof Error ? err.message : "Failed to cancel under-review appointment" });
	}
});

export default router;
