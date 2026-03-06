import express from "express";
import { pool } from "../db.js";
import { requireAuth, requireAdmin } from "../lib/authMiddleware.js";

const router = express.Router();

// GET /api/appointments
// admin only list of all appointments with more display data
router.get("/", requireAdmin, async (req, res) => {
	try {
		const [rows] = await pool.query(`
			SELECT
				a.appointmentID,
				a.userID,
				c.email AS userEmail,
				a.staffID,
				a.roomNumber,
				a.petID,
				a.reasonKey,
				a.date,
				a.durationMinutes,
				DATE_ADD(a.date, INTERVAL a.durationMinutes MINUTE) AS endDateTime,
				COALESCE(
					GROUP_CONCAT(
						CONCAT(COALESCE(i.displayName, i.itemKey), ' (x', ac.qtyUsed, ')')
						ORDER BY COALESCE(i.displayName, i.itemKey)
						SEPARATOR ', '
					),
					''
				) AS equipmentUsed
			FROM appointment a
			LEFT JOIN customer c
				ON c.userID = a.userID
			LEFT JOIN appointment_consumable ac
				ON ac.appointmentID = a.appointmentID
			LEFT JOIN inventory i
				ON i.itemID = ac.itemID
			GROUP BY
				a.appointmentID,
				a.userID,
				c.email,
				a.staffID,
				a.roomNumber,
				a.petID,
				a.reasonKey,
				a.date,
				a.durationMinutes
			ORDER BY a.date ASC
		`);

		res.json(rows);
	} catch (err) {
		console.error("GET /api/appointments error:", err);
		res.status(500).json({ error: "failed to fetch appointments" });
	}
});

// GET /api/appointments/mine
// logged in user route that returns only that user's own appointments
router.get("/mine", requireAuth, async (req, res) => {
	try {
		const userID = Number(req.session.userID);

		const [rows] = await pool.query(
			`
			SELECT
				a.appointmentID,
				a.userID,
				a.staffID,
				a.roomNumber,
				a.petID,
				a.reasonKey,
				a.date,
				a.durationMinutes
			FROM appointment a
			WHERE a.userID = ?
			ORDER BY a.date ASC
			`,
			[userID]
		);

		res.json(rows);
	} catch (err) {
		console.error("GET /api/appointments/mine error:", err);
		res.status(500).json({ error: "failed to fetch user appointments" });
	}
});

// DELETE /api/appointments/:id
// admin only delete and refund any consumables tied to the appointment
router.delete("/:id", requireAdmin, async (req, res) => {
	try {
		const appointmentID = Number(req.params.id);

		if (!Number.isInteger(appointmentID) || appointmentID <= 0) {
			return res.status(400).json({ error: "invalid appointment id" });
		}

		const conn = await pool.getConnection();

		try {
			await conn.beginTransaction();

			// get any consumables that were used by this appointment
			const [consRows] = await conn.execute(
				`
				SELECT itemID, qtyUsed
				FROM appointment_consumable
				WHERE appointmentID = ?
				`,
				[appointmentID]
			);

			// refund consumable stock back into inventory
			for (const row of consRows) {
				await conn.execute(
					`
					UPDATE inventory
					SET quantity = quantity + ?
					WHERE itemID = ?
					`,
					[row.qtyUsed, row.itemID]
				);
			}

			// remove child rows first
			await conn.execute(
				`
				DELETE FROM appointment_consumable
				WHERE appointmentID = ?
				`,
				[appointmentID]
			);

			await conn.execute(
				`
				DELETE FROM appointment_form
				WHERE appointmentID = ?
				`,
				[appointmentID]
			);

			// then remove the appointment row itself
			const [result] = await conn.execute(
				`
				DELETE FROM appointment
				WHERE appointmentID = ?
				`,
				[appointmentID]
			);

			if (result.affectedRows === 0) {
				await conn.rollback();
				return res.status(404).json({ error: "appointment not found" });
			}

			await conn.commit();
			res.status(204).send();
		} catch (err) {
			await conn.rollback();
			throw err;
		} finally {
			conn.release();
		}
	} catch (err) {
		console.error("DELETE /api/appointments/:id error:", err);
		res.status(500).json({ error: "failed to delete appointment" });
	}
});

export default router;