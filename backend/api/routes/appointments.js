import express from "express";
import { pool } from "../db.js";
import { requireAdmin } from "../lib/authMiddleware.js";

const router = express.Router();

// GET /api/appointments
// admin-only list of appointments with richer display data
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
						CONCAT(i.itemName, ' (x', ac.qtyUsed, ')')
						ORDER BY i.itemName
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

// DELETE /api/appointments/:id
// admin-only delete
router.delete("/:id", requireAdmin, async (req, res) => {
	try {
		const appointmentID = Number(req.params.id);

		if (!Number.isInteger(appointmentID) || appointmentID <= 0) {
			return res.status(400).json({ error: "invalid appointment id" });
		}

		const conn = await pool.getConnection();
		try {
			await conn.beginTransaction();

			const [consRows] = await conn.execute(
				`SELECT itemID, qtyUsed
				 FROM appointment_consumable
				 WHERE appointmentID = ?`,
				[appointmentID]
			);

			for (const row of consRows) {
				await conn.execute(
					`UPDATE inventory
					 SET quantity = quantity + ?
					 WHERE itemID = ?`,
					[row.qtyUsed, row.itemID]
				);
			}

			await conn.execute(
				`DELETE FROM appointment_consumable
				 WHERE appointmentID = ?`,
				[appointmentID]
			);

			await conn.execute(
				`DELETE FROM appointment_form
				 WHERE appointmentID = ?`,
				[appointmentID]
			);

			const [result] = await conn.execute(
				`DELETE FROM appointment
				 WHERE appointmentID = ?`,
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