import express from "express";
import { pool } from "../db.js";
import { requireAdmin } from "../lib/authMiddleware.js";
import { deactivateAccount } from "../lib/accountDeactivationService.js";

const router = express.Router();

router.get("/", requireAdmin, async (_req, res) => {
	try {
		// Pull active users for the admin users page along with linked staff info
		// and some basic reservation counts for quick visibility in the UI
		const [rows] = await pool.query(
			`SELECT
				c.userID,
				c.username,
				c.email,
				c.legalFirstName,
				c.legalLastName,
				c.userType,
				c.createdAt,
				s.staffID AS linkedStaffID,
				CASE WHEN s.staffID IS NULL THEN 0 ELSE 1 END AS alreadyLinkedToStaff,
				COUNT(a.appointmentID) AS totalReservations,
				SUM(CASE WHEN a.date < NOW() THEN 1 ELSE 0 END) AS pastReservations,
				SUM(CASE WHEN a.date >= NOW() AND a.isCanceled = 0 THEN 1 ELSE 0 END) AS upcomingReservations
			 FROM customer c
			 LEFT JOIN staff s
				on s.userID = c.userID
			 LEFT JOIN appointment a
				on a.userID = c.userID
			 WHERE c.isDeactivated = 0
			 GROUP BY
				c.userID,
				c.username,
				c.email,
				c.legalFirstName,
				c.legalLastName,
				c.userType,
				c.createdAt,
				s.staffID
			 ORDER BY c.userID ASC`
		);

		res.json(rows);
	} catch (err) {
		console.error("GET /api/users error:", err);
		res.status(500).json({ message: "Failed to fetch users" });
	}
});

router.patch("/:userID/deactivate", requireAdmin, async (req, res) => {
	try {
		// Read the account being targeted from the route param
		// and the acting admin from the current session
		const targetUserID = Number(req.params.userID);
		const actorUserID = Number(req.session.userID);

		// Let the service handle all the deactivation logic so this route stays thin
		// That includes validation, transaction work, cancellations, and any review state updates
		const result = await deactivateAccount({ targetUserID, actorUserID });

		res.json({
			message: "User deactivated",
			result,
		});
	} catch (err) {
		// Use service-level status codes when they exist
		// otherwise fall back to a generic server error
		const status = Number(err?.status || 500);
		const message = err instanceof Error ? err.message : "Failed to deactivate user";

		console.error("PATCH /api/users/:userID/deactivate error:", err);
		res.status(status).json({ message });
	}
});

export default router;