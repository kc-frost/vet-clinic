import express from "express";
import { pool } from "../db.js";
import { requireAuth } from "../lib/authMiddleware.js";

const router = express.Router();

function minutesOverlap(startA, endA, startB, endB) {
	return startA < endB && endA > startB;
}

function timeToMinutes(timeStr) {
	const parts = String(timeStr || "").split(":");
	if (parts.length < 2) return NaN;

	const hours = Number(parts[0]);
	const minutes = Number(parts[1]);
	if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return NaN;

	return hours * 60 + minutes;
}

function sqlDateToWeekday(dateValue) {
	const dt = dateValue instanceof Date ? dateValue : new Date(String(dateValue).replace(" ", "T"));
	const day = dt.getDay();
	return day === 0 ? 7 : day;
}

router.get("/me/availability", requireAuth, async (req, res) => {
	try {
		const userID = Number(req.session.userID);

		const [staffRows] = await pool.query(
			`SELECT staffID FROM staff WHERE userID = ? LIMIT 1`,
			[userID]
		);

		if (staffRows.length === 0) {
			return res.status(404).json({ message: "Staff member not found" });
		}

		const [availabilityRows] = await pool.query(
			`SELECT availabilityID, dayOfWeek, startTime, endTime
			 FROM staff_availability
			 WHERE staffID = ?
			 ORDER BY dayOfWeek`,
			[staffRows[0].staffID]
		);

		res.json(availabilityRows);
	} catch (error) {
		console.error("GET /api/staff/me/availability error:", error);
		res.status(500).json({ message: "Failed to load availability" });
	}
});

router.put("/me/availability", requireAuth, async (req, res) => {
	const connection = await pool.getConnection();

	try {
		const userID = Number(req.session.userID);
		const availability = req.body?.availability;

		if (!Array.isArray(availability)) {
			return res.status(400).json({ message: "Availability must be an array" });
		}

		for (const item of availability) {
			if (typeof item.dayOfWeek !== "number" || typeof item.startTime !== "string" || typeof item.endTime !== "string") {
				return res.status(400).json({ message: "Invalid availability format" });
			}

			if (item.dayOfWeek < 1 || item.dayOfWeek > 7) {
				return res.status(400).json({ message: "dayOfWeek must be 1 through 7" });
			}

			const startMinutes = timeToMinutes(item.startTime);
			const endMinutes = timeToMinutes(item.endTime);
			if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || startMinutes >= endMinutes) {
				return res.status(400).json({ message: `Invalid time range for day ${item.dayOfWeek}` });
			}
		}

		const [staffRows] = await connection.query(
			`SELECT staffID FROM staff WHERE userID = ? LIMIT 1`,
			[userID]
		);

		if (staffRows.length === 0) {
			return res.status(404).json({ message: "Staff member not found" });
		}

		const staffID = Number(staffRows[0].staffID);

		const [futureRows] = await connection.query(
			`SELECT a.appointmentID, a.date, a.durationMinutes
			 FROM appointment_staff aps
			 INNER JOIN appointment a
				ON a.appointmentID = aps.appointmentID
			 WHERE aps.staffID = ?
				AND a.date >= NOW()`,
			[staffID]
		);

		const availabilityByDay = new Map();
		for (const item of availability) {
			availabilityByDay.set(item.dayOfWeek, item);
		}

		for (const row of futureRows) {
			const weekday = sqlDateToWeekday(row.date);
			const matchingDay = availabilityByDay.get(weekday);
			if (!matchingDay) {
				return res.status(400).json({ message: "New availability would conflict with an assigned future appointment" });
			}

			const startDt = row.date instanceof Date ? row.date : new Date(String(row.date).replace(" ", "T"));
			const startMinutes = startDt.getHours() * 60 + startDt.getMinutes();
			const endMinutes = startMinutes + Number(row.durationMinutes || 0);
			const availabilityStart = timeToMinutes(matchingDay.startTime);
			const availabilityEnd = timeToMinutes(matchingDay.endTime);

			if (!minutesOverlap(availabilityStart, availabilityEnd, startMinutes, endMinutes) || availabilityStart > startMinutes || availabilityEnd < endMinutes) {
				return res.status(400).json({ message: "New availability would conflict with an assigned future appointment" });
			}
		}

		await connection.beginTransaction();

		await connection.query(`DELETE FROM staff_availability WHERE staffID = ?`, [staffID]);

		for (const item of availability) {
			await connection.query(
				`INSERT INTO staff_availability (staffID, dayOfWeek, startTime, endTime)
				 VALUES (?, ?, ?, ?)`,
				[staffID, item.dayOfWeek, item.startTime, item.endTime]
			);
		}

		await connection.commit();
		res.json({ message: "Availability saved successfully" });
	} catch (error) {
		await connection.rollback();
		console.error("PUT /api/staff/me/availability error:", error);
		res.status(500).json({ message: "Failed to save availability" });
	} finally {
		connection.release();
	}
});

export default router;
