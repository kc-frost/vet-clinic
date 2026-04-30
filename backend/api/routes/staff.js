import express from "express";
import { pool } from "../db.js";
import { requireAdmin, requireStaff } from "../lib/authMiddleware.js";

const router = express.Router();

/*
	These are the only valid scheduling role keys staff members
	are allowed to have in the database.
*/
const VALID_ROLE_KEYS = new Set([
	"GP_VET",
	"SURGEON",
	"DENTIST",
	"GROOMER",
	"XRAY_TECH",
	"ULTRASOUND_TECH",
	"SURGEON_ASSISTANT",
]);

function cleanText(value) {
	/*
		Normalize incoming text values by trimming whitespace.
		If the value is not a string, return an empty string.
	*/
	return typeof value === "string" ? value.trim() : "";
}

function uniqueRoleKeys(rawRoleKeys) {
	/*
		The incoming roleKeys array may contain duplicate values,
		lowercase text, extra spaces, or even non-string values.

		So first keep only string values.
		Then trim and uppercase each one.
		Then remove blank values.
		Then remove duplicates.
	*/
	if (!Array.isArray(rawRoleKeys)) return [];

	const normalized = rawRoleKeys
		.filter((value) => typeof value === "string")
		.map((value) => value.trim().toUpperCase())
		.filter((value) => value.length > 0);

	return [...new Set(normalized)];
}

function buildStaffProfileFromRows(rows) {
	/*
		This route query returns one row per roleKey, so one staff
		member can appear multiple times.

		Use the first row for the shared staff/profile fields, then
		collect the distinct role keys into one roleKeys array.
	*/
	const first = rows[0];

	return {
		staffID: first.staffID,
		userID: first.userID,
		staffNumber: first.staffNumber,
		positionTitle: first.positionTitle,
		legalFirstName: first.legalFirstName,
		legalLastName: first.legalLastName,
		email: first.email,
		phone: first.phone,
		roleKeys: [...new Set(rows.map((row) => row.roleKey).filter(Boolean))],
	};
}

router.get("/me", requireStaff, async (req, res) => {
	try {
		/*
			Use the logged-in session userID to find the matching
			staff profile for this authenticated staff member.
		*/
		const userID = Number(req.session.userID);

		const [rows] = await pool.query(
			`SELECT
				s.staffID,
				s.userID,
				s.staffNumber,
				s.positionTitle,
				c.legalFirstName,
				c.legalLastName,
				c.email,
				c.phone,
				sr.roleKey
			 FROM staff s
			 INNER JOIN customer c
				ON c.userID = s.userID
			 LEFT JOIN staff_role sr
				ON sr.staffID = s.staffID
			 WHERE s.userID = ?
			 ORDER BY sr.roleKey`,
			[userID]
		);

		/*
			If the logged-in account is marked as staff but does not
			have a matching staff profile row, return not found.
		*/
		if (rows.length === 0) {
			return res.status(404).json({ message: "No staff profile found for this user" });
		}

		res.json(buildStaffProfileFromRows(rows));
	} catch (err) {
		console.error("GET /api/staff/me error:", err);
		res.status(500).json({ message: "Failed to fetch logged in staff profile" });
	}
});

router.get("/me/appointments", requireStaff, async (req, res) => {
	try {
		/*
			First resolve the logged-in user's linked staffID.
			The appointment_staff table is keyed by staffID, not userID.
		*/
		const userID = Number(req.session.userID);

		const [staffRows] = await pool.query(`SELECT staffID FROM staff WHERE userID = ? LIMIT 1`, [userID]);
		if (staffRows.length === 0) {
			return res.status(404).json({ message: "Staff not found" });
		}

		const staffID = Number(staffRows[0].staffID);

		/*
			Load assigned appointments for the dashboard.

			Keep the last 6 months plus all future appointments.
			The frontend splits them into today's, future, and past buckets.
		*/
		const [rows] = await pool.query(
			`SELECT
				a.appointmentID,
				COALESCE(p.petName, af.petName, 'Unknown Pet') AS petName,
				a.reasonKey AS service,
				DATE_FORMAT(a.date, '%Y-%m-%d') AS appointmentDate,
				TIME_FORMAT(a.date, '%h:%i %p') AS appointmentTime,
				DATE_FORMAT(a.date, '%Y-%m-%d %H:%i:%s') AS appointmentDateTime,
				a.durationMinutes,
				COALESCE(s.isFinalized, 0) AS summaryIsFinalized,
				aps.assignedRoleKey
			 FROM appointment_staff aps
			 INNER JOIN appointment a
				ON a.appointmentID = aps.appointmentID
			 LEFT JOIN pet p
				ON p.petID = a.petID
			 LEFT JOIN appointment_form af
				ON af.appointmentID = a.appointmentID
			 LEFT JOIN appointment_summary s
				ON s.appointmentID = a.appointmentID
			 WHERE aps.staffID = ?
				AND COALESCE(a.isCanceled, 0) = 0
				AND COALESCE(a.underReview, 0) = 0
				AND a.date >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
			 ORDER BY a.date ASC`,
			[staffID]
		);

		res.json(rows);
	} catch (err) {
		console.error("GET /api/staff/me/appointments error:", err);
		res.status(500).json({ message: "Failed to fetch appointments" });
	}
});

router.get("/me/notifications", requireStaff, async (req, res) => {
	try {
		/*
			Load unread in-app notifications for the logged-in staff user.
			These are notification rows tied directly to the session userID.
		*/
		const userID = Number(req.session.userID);

		const [rows] = await pool.query(
			`SELECT
				notificationID,
				type,
				title,
				message,
				channel,
				isRead,
				createdAt
			 FROM notification
			 WHERE userID = ?
				AND channel = 'IN_APP'
				AND isRead = 0
			 ORDER BY createdAt DESC`,
			[userID]
		);

		res.json(rows);
	} catch (err) {
		console.error("GET /api/staff/me/notifications error:", err);
		res.status(500).json({ message: "Failed to fetch notifications" });
	}
});

router.patch("/me/notifications/:notificationID/read", requireStaff, async (req, res) => {
	try {
		/*
			Mark one notification as read, but only if that notification
			belongs to the logged-in user and is an in-app notification.
		*/
		const userID = Number(req.session.userID);
		const notificationID = Number(req.params.notificationID);

		if (!Number.isInteger(notificationID) || notificationID < 1) {
			return res.status(400).json({ message: "Invalid notification id" });
		}

		await pool.query(
			`UPDATE notification
			 SET isRead = 1
			 WHERE notificationID = ?
				AND userID = ?
				AND channel = 'IN_APP'`,
			[notificationID, userID]
		);

		res.json({ ok: true, message: "Notification marked as read" });
	} catch (err) {
		console.error("PATCH /api/staff/me/notifications/:notificationID/read error:", err);
		res.status(500).json({ message: "Failed to mark notification as read" });
	}
});

/*
	GET /api/staff

	Return the full staff list using the current schema.

	The data comes from:
	- staff for employee-specific fields
	- customer for account/profile/contact info
	- staff_role for one or more role keys per staff member
*/
router.get("/", requireAdmin, async (req, res) => {
	try {
		const includeInactive = String(req.query.includeInactive || "").trim() === "1";
		const whereClause = includeInactive ? "" : "WHERE COALESCE(s.isActive, 1) = 1 AND COALESCE(c.isDeactivated, 0) = 0";
		const [rows] = await pool.query(
			`SELECT
				s.staffID,
				s.userID,
				s.staffNumber,
				s.positionTitle,
				COALESCE(s.isActive, 1) AS isActive,
				c.legalFirstName,
				c.legalLastName,
				c.email,
				c.phone,
				c.addressLine1,
				c.city,
				c.state,
				c.zipCode,
				c.userType,
				COALESCE(c.isDeactivated, 0) AS isDeactivated,
				sr.roleKey
			 FROM staff s
			 INNER JOIN customer c
				on c.userID = s.userID
			 LEFT JOIN staff_role sr
				on sr.staffID = s.staffID
			 ${whereClause}
			 ORDER BY COALESCE(c.legalLastName, ''), COALESCE(c.legalFirstName, ''), s.staffID, sr.roleKey`
		);

		/*
			Because the join returns one row per roleKey, collapse those
			rows back into one object per staffID with a roleKeys array.
		*/
		const byStaffID = new Map();

		for (const row of rows) {
			if (!byStaffID.has(row.staffID)) {
				byStaffID.set(row.staffID, {
					staffID: row.staffID,
					userID: row.userID,
					staffNumber: row.staffNumber,
					positionTitle: row.positionTitle,
					legalFirstName: row.legalFirstName,
					legalLastName: row.legalLastName,
					email: row.email,
					phone: row.phone,
					addressLine1: row.addressLine1,
					city: row.city,
					state: row.state,
					zipCode: row.zipCode,
					userType: row.userType,
					isActive: Number(row.isActive) === 1,
					isDeactivated: Number(row.isDeactivated) === 1,
					roleKeys: [],
				});
			}

			if (row.roleKey) byStaffID.get(row.staffID).roleKeys.push(row.roleKey);
		}

		res.json([...byStaffID.values()]);
	} catch (err) {
		console.error("GET /api/staff error:", err);
		res.status(500).send("Server error fetching staff list.");
	}
});

/*
	POST /api/staff

	Create one new staff profile by linking an existing customer account.

	Expected request body:
	- userID
	- staffNumber
	- positionTitle
	- roleKeys
*/
router.post("/", requireAdmin, async (req, res) => {
	let conn;

	try {
		/*
			Clean and normalize the incoming request fields before
			validation and database work.
		*/
		const parsedUserID = Number(req.body?.userID);
		const cleanStaffNumber = cleanText(req.body?.staffNumber);
		const cleanPositionTitle = cleanText(req.body?.positionTitle);
		const roleKeys = uniqueRoleKeys(req.body?.roleKeys);

		if (!Number.isInteger(parsedUserID) || parsedUserID < 1) {
			return res.status(400).send("A valid userID is required.");
		}

		if (!cleanStaffNumber) {
			return res.status(400).send("staffNumber is required.");
		}

		if (!cleanPositionTitle) {
			return res.status(400).send("positionTitle is required.");
		}

		if (roleKeys.length === 0) {
			return res.status(400).send("At least one roleKey is required.");
		}

		/*
			Reject any roleKey that is not one of the allowed values.
		*/
		for (const roleKey of roleKeys) {
			if (!VALID_ROLE_KEYS.has(roleKey)) {
				return res.status(400).send(`Invalid roleKey: ${roleKey}`);
			}
		}

		conn = await pool.getConnection();
		await conn.beginTransaction();

		/*
			Make sure the selected customer account actually exists
			before trying to link it to a staff profile.
		*/
		const [userRows] = await conn.query(
			`SELECT userID, userType, COALESCE(isDeactivated, 0) AS isDeactivated
			 FROM customer
			 WHERE userID = ?
			 LIMIT 1`,
			[parsedUserID]
		);

		if (userRows.length === 0) {
			await conn.rollback();
			return res.status(404).send("The selected user account does not exist.");
		}

		if (Number(userRows[0].isDeactivated) === 1) {
			await conn.rollback();
			return res.status(409).send("Cannot link a deactivated user account to staff.");
		}

		/*
			Do not allow one customer account to be linked to more than
			one staff profile row.
		*/
		const [existingStaffRows] = await conn.query(
			`SELECT staffID
			 FROM staff
			 WHERE userID = ?
			 LIMIT 1`,
			[parsedUserID]
		);

		if (existingStaffRows.length > 0) {
			await conn.rollback();
			return res.status(409).send("This user account is already linked to a staff profile.");
		}

		/*
			staffNumber must also be unique across staff records.
		*/
		const [numberRows] = await conn.query(
			`SELECT staffID
			 FROM staff
			 WHERE staffNumber = ?
			 LIMIT 1`,
			[cleanStaffNumber]
		);

		if (numberRows.length > 0) {
			await conn.rollback();
			return res.status(409).send("That staffNumber is already in use.");
		}

		/*
			Insert the main staff row first.

			We need the new staffID generated by this insert before
			we can insert the related staff_role rows.
		*/
		const [staffInsert] = await conn.query(
			`
			INSERT INTO staff (userID, staffNumber, positionTitle)
			VALUES (?, ?, ?)
			`,
			[parsedUserID, cleanStaffNumber, cleanPositionTitle]
		);

		const newStaffID = staffInsert.insertId;

		/*
			Insert one row per selected roleKey.

			This is what makes the staff-to-role relationship
			many-to-many in the new schema.
		*/
		for (const roleKey of roleKeys) {
			await conn.query(
				`
				INSERT INTO staff_role (staffID, roleKey)
				VALUES (?, ?)
				`,
				[newStaffID, roleKey]
			);
		}

		/*
			Update the linked customer account so its website identity
			is now marked as STAFF.
		*/
		await conn.query(
			`
			UPDATE customer
			SET userType = 'STAFF'
			WHERE userID = ?
			`,
			[parsedUserID]
		);

		await conn.commit();

		res.status(201).json({
			message: "Staff profile created successfully.",
			staffID: newStaffID,
		});
	} catch (err) {
		if (conn) await conn.rollback();
		console.error("POST /api/staff error:", err);
		res.status(500).send("Server error creating staff profile.");
	} finally {
		if (conn) conn.release();
	}
});

/*
	GET /api/staff/users

	Return customer accounts that the admin can choose from during
	the staff-linking flow.

	This helps the frontend show:
	- which users exist
	- which ones are already linked to staff
	- basic profile/account info for choosing the right person
*/
router.get("/users", requireAdmin, async (req, res) => {
	try {
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
				SUM(CASE WHEN a.date >= NOW() THEN 1 ELSE 0 END) AS upcomingReservations
			 FROM customer c
			 LEFT JOIN staff s
				ON s.userID = c.userID
				AND COALESCE(s.isActive, 1) = 1
			 LEFT JOIN appointment a
				ON a.userID = c.userID
			 WHERE COALESCE(c.isDeactivated, 0) = 0
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
		console.error("GET /api/staff/users error:", err);
		res.status(500).send("Server error fetching user accounts.");
	}
});

export default router;