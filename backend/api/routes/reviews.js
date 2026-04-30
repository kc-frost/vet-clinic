import express from "express";
import { pool } from "../db.js";
import { requireAuth } from "../lib/authMiddleware.js";

const router = express.Router();

function getRequestUserId(req) {
	const raw = req.session?.user?.userID ?? req.session?.userID ?? null;
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) return null;
	return n;
}

router.post("/:appointmentID", requireAuth, async (req, res) => {
	try {
		const userID = getRequestUserId(req);
		const appointmentID = Number(req.params.appointmentID);
		const rating = Number(req.body.rating);
		const reviewText = String(req.body.reviewText || "").trim();

		if (!userID) return res.status(401).json({ error: "not authenticated" });
		if (!Number.isInteger(appointmentID) || appointmentID <= 0) {
			return res.status(400).json({ error: "invalid appointment id" });
		}
		if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
			return res.status(400).json({ error: "rating must be a whole number from 1 to 5" });
		}
		if (reviewText.length > 500) {
			return res.status(400).json({ error: "review text must be 500 characters or fewer" });
		}

		const [apptRows] = await pool.execute(
			`
			SELECT
				appointmentID,
				userID,
				isCanceled,
				date,
				durationMinutes,
				DATE_ADD(date, INTERVAL durationMinutes MINUTE) AS endDateTime
			FROM appointment
			WHERE appointmentID = ?
			LIMIT 1
			`,
			[appointmentID]
		);

		if (!apptRows.length) {
			return res.status(404).json({ error: "appointment not found" });
		}

		const appt = apptRows[0];

		if (Number(appt.userID) !== userID) {
			return res.status(403).json({ error: "you can only review your own appointment" });
		}

		if (Number(appt.isCanceled) === 1) {
			return res.status(400).json({ error: "canceled appointments cannot be reviewed" });
		}

		const [completionRows] = await pool.execute(
			`
			SELECT
				DATE_ADD(date, INTERVAL durationMinutes MINUTE) <= NOW() AS isCompleted
			FROM appointment
			WHERE appointmentID = ?
			`,
			[appointmentID]
		);

		if (Number(completionRows[0]?.isCompleted) !== 1) {
			return res.status(400).json({ error: "appointment is not fully completed yet" });
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
			return res.status(409).json({ error: "appointment already has a review" });
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

		res.status(201).json({
			message: "review saved",
			appointmentID,
			rating,
			reviewText,
		});
	} catch (err) {
		console.error("POST /api/reviews/:appointmentID error:", err);
		res.status(500).json({ error: "failed to save review" });
	}
});

export default router;