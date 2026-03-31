import express from "express";
import { pool } from "../db.js";
import { requireAdmin, requireAuth } from "../lib/authMiddleware.js";

const router = express.Router();

/*
	These are the valid scheduling role keys a staff member can have
	These are what later reservation logic will check against
*/
const VALID_ROLE_KEYS = new Set([
	"GENERAL",
	"SURGEON",
	"DENTIST",
	"GROOMER",
	"XRAY_TECH",
	"ULTRASOUND_TECH",
	"SURGEON_ASSISTANT",
	"TECHNICIAN",
]);

function cleanText(value) {
	return typeof value === "string" ? value.trim() : "";
}

function uniqueRoleKeys(rawRoleKeys) {
	/*
		The incoming role array can be messy
		It might have duplicates spaces lowercase text or non strings

		So first clean every value
		Then turn them all into uppercase
		Then remove duplicates
		Then return the final clean array
	*/
	if (!Array.isArray(rawRoleKeys)) return [];

	const normalized = rawRoleKeys
		.filter((value) => typeof value === "string")
		.map((value) => value.trim().toUpperCase())
		.filter((value) => value.length > 0);

	return [...new Set(normalized)];
}

function buildStaffProfileFromRows(rows) {
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

router.get("/me", requireAuth, async (req, res) => {
	try {
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

		if (rows.length === 0) {
			return res.status(404).json({ message: "No staff profile found for this user" });
		}

		res.json(buildStaffProfileFromRows(rows));
	} catch (err) {
		console.error("GET /api/staff/me error:", err);
		res.status(500).json({ message: "Failed to fetch logged in staff profile" });
	}
});

router.get("/me/appointments", requireAuth, async (req, res) => {
	try {
		const userID = Number(req.session.userID);

		const [staffRows] = await pool.query(`SELECT staffID FROM staff WHERE userID = ? LIMIT 1`, [userID]);
		if (staffRows.length === 0) {
			return res.status(404).json({ message: "Staff not found" });
		}

		const staffID = Number(staffRows[0].staffID);

		const [rows] = await pool.query(
			`SELECT
				a.appointmentID,
				COALESCE(p.petName, af.petName, 'Unknown Pet') AS petName,
				a.reasonKey AS service,
				DATE_FORMAT(a.date, '%Y-%m-%d') AS appointmentDate,
				TIME_FORMAT(a.date, '%h:%i %p') AS appointmentTime,
				DATE_FORMAT(a.date, '%Y-%m-%d %H:%i:%s') AS appointmentDateTime,
				aps.assignedRoleKey
			 FROM appointment_staff aps
			 INNER JOIN appointment a
				ON a.appointmentID = aps.appointmentID
			 LEFT JOIN pet p
				ON p.petID = a.petID
			 LEFT JOIN appointment_form af
				ON af.appointmentID = a.appointmentID
			 WHERE aps.staffID = ?
				AND a.date >= CURDATE()
			 ORDER BY a.date ASC`,
			[staffID]
		);

		res.json(rows);
	} catch (err) {
		console.error("GET /api/staff/me/appointments error:", err);
		res.status(500).json({ message: "Failed to fetch appointments" });
	}
});

router.get("/me/notifications", requireAuth, async (req, res) => {
	try {
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

router.patch("/me/notifications/:notificationID/read", requireAuth, async (req, res) => {
	try {
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

	Returns the full staff list using the new schema shape

	The data is built from:
	- staff for employee-specific data
	- customer for profile/contact info
	- staff_role for one or more role keys
*/
router.get("/", requireAdmin, async (req, res) => {
	try {
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
				c.addressLine1,
				c.city,
				c.state,
				c.zipCode,
				c.userType,
				sr.roleKey
			 FROM staff s
			 INNER JOIN customer c
				ON c.userID = s.userID
			 LEFT JOIN staff_role sr
				ON sr.staffID = s.staffID
			 ORDER BY COALESCE(c.legalLastName, ''), COALESCE(c.legalFirstName, ''), s.staffID, sr.roleKey`
		);

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
					roleKeys: [],
				});
			}

			if (row.roleKey) {
				byStaffID.get(row.staffID).roleKeys.push(row.roleKey);
			}
		}

		const staffList = [...byStaffID.values()];
		res.json(staffList);
	} catch (err) {
		console.error("GET /api/staff error:", err);
		res.status(500).send("Server error fetching staff list.");
	}
});

/*
	POST /api/staff

	Creates one new staff profile by linking an existing customer account

	Expected request body:
	- userID
	- staffNumber
	- positionTitle
	- roleKeys
*/
router.post("/", requireAdmin, async (req, res) => {
	let conn;

	try {
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

		for (const roleKey of roleKeys) {
			if (!VALID_ROLE_KEYS.has(roleKey)) {
				return res.status(400).send(`Invalid roleKey: ${roleKey}`);
			}
		}

		conn = await pool.getConnection();
		await conn.beginTransaction();

		const [userRows] = await conn.query(
			`SELECT userID, userType
			 FROM customer
			 WHERE userID = ?
			 LIMIT 1`,
			[parsedUserID]
		);

		if (userRows.length === 0) {
			await conn.rollback();
			return res.status(404).send("The selected user account does not exist.");
		}

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
			Insert the main staff row first
			This is for getting the new staffID before role rows get inserted
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
			Insert one row per selected roleKey
			This is what makes staff capabilities many-to-many now
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
			Update the linked user account type
			This marks the account as STAFF in the website identity sense
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

	Returns user accounts for the admin linking step

	This helps the frontend show:
	- who exists
	- who is already linked
	- some profile basics for selecting the right account
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
			 LEFT JOIN appointment a
				ON a.userID = c.userID
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