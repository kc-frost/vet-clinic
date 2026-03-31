import express from "express";
import { pool } from "../db.js";
import { requireAuth } from "../lib/authMiddleware.js";

const router = express.Router();

function getRequestUserId(req) {
	const raw = req.session?.user?.userID ?? req.session?.userID ?? null;
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? n : null;
}

router.get("/", requireAuth, async (req, res) => {
	try {
		const userID = getRequestUserId(req);
		if (!userID) {
			return res.status(401).json({ error: "unauthorized" });
		}

		const [rows] = await pool.execute(
			`SELECT
				notificationID,
				userID,
				appointmentID,
				type,
				title,
				message,
				channel,
				isRead,
				createdAt
			 FROM notification
			 WHERE userID = ?
				AND channel = 'IN_APP'
			 ORDER BY createdAt DESC`,
			[userID]
		);

		res.json(rows);
	} catch (err) {
		console.error("GET /api/notifications error:", err);
		res.status(500).json({ error: "failed to fetch notifications" });
	}
});

router.patch("/:notificationID/read", requireAuth, async (req, res) => {
	try {
		const userID = getRequestUserId(req);
		const notificationID = Number(req.params.notificationID);

		if (!userID) {
			return res.status(401).json({ error: "unauthorized" });
		}

		if (!Number.isInteger(notificationID) || notificationID < 1) {
			return res.status(400).json({ error: "invalid notification id" });
		}

		await pool.execute(
			`UPDATE notification
			 SET isRead = 1
			 WHERE notificationID = ?
				AND userID = ?
				AND channel = 'IN_APP'`,
			[notificationID, userID]
		);

		res.json({ ok: true });
	} catch (err) {
		console.error("PATCH /api/notifications/:notificationID/read error:", err);
		res.status(500).json({ error: "failed to mark notification read" });
	}
});

export default router;
