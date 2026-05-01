import express from "express";
import { pool } from "../db.js";
import { requireAuth } from "../lib/authMiddleware.js";

const router = express.Router();

function getSessionUserID(req) {
	const userID = Number(req.session?.userID);
	if (!Number.isInteger(userID) || userID <= 0) return null;
	return userID;
}

router.post("/:appointmentID", requireAuth, async (req, res) => {
	try {
		const userID = getSessionUserID(req);
		const appointmentID = Number(req.params.appointmentID);
		const rating = Number(req.body.rating);
		const reviewText = String(req.body.reviewText || "").trim();

		if (!userID) return res.status(401).json({ message: "not authenticated" });
		if (!Number.isInteger(appointmentID) || appointmentID <= 0) {
			return res.status(400).json({ message: "invalid appointment id" });
		}
		if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
			return res.status(400).json({ message: "rating must be a whole number from 1 to 5" });
		}
		if (reviewText.length > 500) {
			return res.status(400).json({ message: "review text must be 500 characters or fewer" });
		}

		const [appointmentRows] = await pool.execute(
			`
			SELECT
				appointmentID,
				userID,
				isCanceled,
				DATE_ADD(date, INTERVAL durationMinutes MINUTE) <= NOW() AS isCompleted
			FROM appointment
			WHERE appointmentID = ?
			LIMIT 1
			`,
			[appointmentID]
		);

		if (!appointmentRows.length) {
			return res.status(404).json({ message: "appointment not found" });
		}

		const appointment = appointmentRows[0];

		if (Number(appointment.userID) !== userID) {
			return res.status(403).json({ message: "you can only review your own appointment" });
		}

		if (Number(appointment.isCanceled) === 1) {
			return res.status(400).json({ message: "canceled appointments cannot be reviewed" });
		}

		if (Number(appointment.isCompleted) !== 1) {
			return res.status(400).json({ message: "appointment is not fully completed yet" });
		}

		const [existingRows] = await pool.execute(
			`
			SELECT reviewID
			FROM appointment_review
			WHERE appointmentID = ?
			LIMIT 1
			`,
			[appointmentID]
		);

		if (existingRows.length) {
			return res.status(409).json({ message: "appointment already has a review" });
		}

		await pool.execute(
			`
			INSERT INTO appointment_review (
				appointmentID,
				userID,
				rating,
				reviewText
			)
			VALUES (?, ?, ?, ?)
			`,
			[appointmentID, userID, rating, reviewText || null]
		);

		res.status(201).json({ message: "review saved", appointmentID, rating, reviewText });
	} catch (err) {
		if (err?.code === "ER_DUP_ENTRY") {
			return res.status(409).json({ message: "appointment already has a review" });
		}

		console.error("POST /api/reviews/:appointmentID error:", err);
		res.status(500).json({ message: "failed to save review" });
	}
});

export default router;