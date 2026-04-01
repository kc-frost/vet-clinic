import express from "express";
import { pool } from "../db.js";
import { requireStaff } from "../lib/authMiddleware.js";

const router = express.Router();

function minutesOverlap(startA, endA, startB, endB) {
	/*
		Check whether two time windows overlap.

		This uses half-open interval logic, so two ranges overlap
		when one starts before the other ends and also ends after
		the other starts.
	*/
	return startA < endB && endA > startB;
}

function timeToMinutes(timeStr) {
	/*
		Convert a time string like HH:MM or HH:MM:SS into total
		minutes since midnight so time comparisons stay numeric.
	*/
	const parts = String(timeStr || "").split(":");
	if (parts.length < 2) return NaN;

	const hours = Number(parts[0]);
	const minutes = Number(parts[1]);

	/*
		Reject invalid time pieces before doing the conversion.
	*/
	if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return NaN;

	return hours * 60 + minutes;
}

function sqlDateToWeekday(dateValue) {
	/*
		Convert a SQL date/datetime value into the weekday format
		used by staff_availability.

		JavaScript uses:
		0 = Sunday through 6 = Saturday

		Our backend uses:
		1 = Monday through 7 = Sunday
	*/
	const dt = dateValue instanceof Date ? dateValue : new Date(String(dateValue).replace(" ", "T"));
	const day = dt.getDay();

	return day === 0 ? 7 : day;
}

router.get("/me/availability", requireStaff, async (req, res) => {
	try {
		/*
			Get the logged-in user's linked staffID first.
			staff_availability is tied to staffID, not directly to userID.
		*/
		const userID = Number(req.session.userID);

		const [staffRows] = await pool.query(
			`SELECT staffID FROM staff WHERE userID = ? LIMIT 1`,
			[userID]
		);

		/*
			If the logged-in staff user has no linked staff row,
			then there is no availability profile to return.
		*/
		if (staffRows.length === 0) {
			return res.status(404).json({ message: "Staff member not found" });
		}

		/*
			Load all saved weekly availability blocks for this staff member.
		*/
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

router.put("/me/availability", requireStaff, async (req, res) => {
	const connection = await pool.getConnection();

	try {
		/*
			Read the logged-in user and the incoming availability array.
		*/
		const userID = Number(req.session.userID);
		const availability = req.body?.availability;

		/*
			The frontend must send availability as an array of day/time blocks.
		*/
		if (!Array.isArray(availability)) {
			return res.status(400).json({ message: "Availability must be an array" });
		}

		/*
			Validate each availability block before doing any database work.

			Each block must include:
			- dayOfWeek
			- startTime
			- endTime

			And the time range must be valid with start before end.
		*/
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

		/*
			Resolve the logged-in user's linked staffID.
		*/
		const [staffRows] = await connection.query(
			`SELECT staffID FROM staff WHERE userID = ? LIMIT 1`,
			[userID]
		);

		if (staffRows.length === 0) {
			return res.status(404).json({ message: "Staff member not found" });
		}

		const staffID = Number(staffRows[0].staffID);

		/*
			Load this staff member's future assigned appointments.

			We do this before replacing availability so we can reject
			any new schedule that would no longer cover appointments
			already assigned to them.
		*/
		const [futureRows] = await connection.query(
			`SELECT a.appointmentID, a.date, a.durationMinutes
			 FROM appointment_staff aps
			 INNER JOIN appointment a
				ON a.appointmentID = aps.appointmentID
			 WHERE aps.staffID = ?
				AND a.date >= NOW()`,
			[staffID]
		);

		/*
			Build a quick lookup map:
			dayOfWeek -> availability block

			This lets us quickly check whether each future appointment
			is still covered by the new proposed weekly availability.
		*/
		const availabilityByDay = new Map();
		for (const item of availability) {
			availabilityByDay.set(item.dayOfWeek, item);
		}

		/*
			Reject the update if any already-assigned future appointment
			would no longer fit inside the new availability window.
		*/
		for (const row of futureRows) {
			const weekday = sqlDateToWeekday(row.date);
			const matchingDay = availabilityByDay.get(weekday);

			/*
				If there is no availability block at all for that weekday,
				then that future appointment would be uncovered.
			*/
			if (!matchingDay) {
				return res.status(409).json({ message: "Availability conflicts with future appointments" });
			}

			/*
				Convert the appointment's actual datetime into a minute range
				for that day, then compare it against the proposed weekly block.
			*/
			const startDt = row.date instanceof Date ? row.date : new Date(String(row.date).replace(" ", "T"));
			const startMinutes = startDt.getHours() * 60 + startDt.getMinutes();
			const endMinutes = startMinutes + Number(row.durationMinutes || 0);

			const availabilityStart = timeToMinutes(matchingDay.startTime);
			const availabilityEnd = timeToMinutes(matchingDay.endTime);

			/*
				The appointment must be fully contained inside the new
				availability window, not just partially overlap it.
			*/
			if (!minutesOverlap(availabilityStart, availabilityEnd, startMinutes, endMinutes) || availabilityStart > startMinutes || availabilityEnd < endMinutes) {
				return res.status(409).json({ message: "Availability conflicts with future appointments" });
			}
		}

		/*
			Start one transaction so the old availability rows are removed
			and the new ones are inserted as a single all-or-nothing update.
		*/
		await connection.beginTransaction();

		/*
			Remove the current saved availability blocks for this staff member
			before inserting the replacement set.
		*/
		await connection.query(`DELETE FROM staff_availability WHERE staffID = ?`, [staffID]);

		/*
			Insert the new weekly availability rows.
		*/
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