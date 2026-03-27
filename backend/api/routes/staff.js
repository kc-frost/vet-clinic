import express from "express";
import { pool } from "../db.js";
import { requireAdmin } from "../lib/authMiddleware.js";

const router = express.Router();

/*
	These are the valid scheduling role keys a staff member can have.
	These are what later reservation logic will check against.
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
		The incoming role array can be messy.
		It might have duplicates, spaces, lowercase text, or non strings.

		So first clean every value,
		then turn them all into uppercase,
		then remove duplicates,
		then return the final clean array.
	*/
	if (!Array.isArray(rawRoleKeys)) return [];

	const normalized = rawRoleKeys
		.filter((value) => typeof value === "string")
		.map((value) => value.trim().toUpperCase())
		.filter((value) => value.length > 0);

	return [...new Set(normalized)];
}

/*
	GET /api/staff

	Returns the full staff list using the new schema shape.

	The data is built from:
	- staff for employee-specific data
	- customer for profile/contact info
	- staff_role for one or more role keys
*/
router.get("/", requireAdmin, async (req, res) => {
	try {
		const [rows] = await pool.query(
			`
			SELECT
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
			ORDER BY
				COALESCE(c.legalLastName, ''),
				COALESCE(c.legalFirstName, ''),
				s.staffID,
				sr.roleKey
			`
		);

		/*
			The LEFT JOIN gives one row per role.
			So if one staff member has 3 roles, that same staff shows up 3 times.

			This loop fixes that by grouping rows by staffID
			and pushing each roleKey into roleKeys[] for that one staff object.

			So the final response becomes one object per staff member.
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
					roleKeys: [],
				});
			}

			if (row.roleKey) {
				byStaffID.get(row.staffID).roleKeys.push(row.roleKey);
			}
		}

		res.json([...byStaffID.values()]);
	} catch (err) {
		console.error("GET /api/staff error:", err);
		res.status(500).send("Server error fetching staff.");
	}
});

/*
	POST /api/staff

	Creates a staff profile linked to an already existing customer account.

	Expected body:
	{
		userID: number,
		staffNumber: string,
		positionTitle: string,
		roleKeys: string[]
	}

	logic flow:
	 validate body
	 make sure target user exists
	 block admin accounts
	 make sure user is not already linked
	 insert into staff
	 insert role rows into staff_role
	 update customer.userType to STAFF

	This uses a transaction since all of this is really one operation.
	If something fails halfway, rollback keeps it from ending in a half-done state.
*/
router.post("/", requireAdmin, async (req, res) => {
	let conn;

	try {
		const {
			userID,
			staffNumber,
			positionTitle,
			roleKeys: rawRoleKeys,
		} = req.body ?? {};

		const parsedUserID = Number(userID);
		const cleanStaffNumber = cleanText(staffNumber);
		const cleanPositionTitle = cleanText(positionTitle);
		const roleKeys = uniqueRoleKeys(rawRoleKeys);

		if (!Number.isInteger(parsedUserID) || parsedUserID < 1) {
			return res.status(400).send("userID must be a positive integer.");
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

		const invalidRole = roleKeys.find((roleKey) => !VALID_ROLE_KEYS.has(roleKey));
		if (invalidRole) {
			return res.status(400).send(`Invalid roleKey: ${invalidRole}`);
		}

		conn = await pool.getConnection();
		await conn.beginTransaction();

		/*
			Check that the target user exists first.

			Admin is blocked here.
			Staff profiles should only be linked to normal user accounts, not admin accounts.

			FOR UPDATE is used so this row is locked while this transaction is running.
			That helps avoid weird race condition cases if two requests try to do this at once.
		*/
		const [userRows] = await conn.query(
			`
			SELECT userID, userType
			FROM customer
			WHERE userID = ?
			FOR UPDATE
			`,
			[parsedUserID]
		);

		if (userRows.length === 0) {
			await conn.rollback();
			return res.status(404).send("Target user does not exist.");
		}

		const targetUser = userRows[0];
		if (targetUser.userType === "ADMIN") {
			await conn.rollback();
			return res.status(400).send("Admin accounts cannot be linked as staff.");
		}

		/*
			Check if this user was already linked to a staff profile.

            userID in staff table is unique. We do the check here to produce a better duplicate
            key error message rather than just using SQL's dupe key error msg
		*/
		const [existingStaffRows] = await conn.query(
			`
			SELECT staffID
			FROM staff
			WHERE userID = ?
			FOR UPDATE
			`,
			[parsedUserID]
		);

		if (existingStaffRows.length > 0) {
			await conn.rollback();
			return res.status(400).send("This user is already linked to a staff profile.");
		}

		/*
			Insert the main staff row first.
			We need the new staffID from this insert so the role rows can point to the 
            right staff member.
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
			Insert one row per role key.
			This allows one staff member to have multiple roles. Each role is its own row in staff_role.
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

		
        //Once the staff row and role rows are done, update the linked customer account to STAFF.
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
			staffID: newStaffID,
			message: "Created.",
		});
	} catch (err) {
		if (conn) {
			try {
				await conn.rollback();
			} catch (rollbackErr) {
				console.error("POST /api/staff rollback error:", rollbackErr);
			}
		}

		/*
			Catch duplicate key cases separately so the error is cleaner.
			Can happen if staffNumber already exists, userID was already linked, some other unique 
            field hits a duplicate
		*/
		if (err?.code === "ER_DUP_ENTRY") {
			console.error("POST /api/staff duplicate entry:", err);
			return res.status(409).send("Staff profile could not be created because a unique value already exists.");
		}

		console.error("POST /api/staff error:", err);
		res.status(500).send("Server error creating staff.");
	}
});

/*
	DELETE /api/staff/:id

	Disabled for now.
	Deleting staff right now could mess with old or future appointments.
*/
router.delete("/:id", requireAdmin, (req, res) => {
	res.status(405).send("Delete is disabled.");
});

/*
	GET /api/staff/users

	Returns existing user accounts the admin can look through
	before linking one to a staff profile.

	This helps the admin side know which userID to use, whether that user is already linked, and some 
    info about that account
*/
router.get("/users", requireAdmin, async (req, res) => {
	try {
		const [rows] = await pool.query(
			`
			SELECT
				c.userID,
				c.username,
				c.email,
				c.legalFirstName,
				c.legalLastName,
				c.userType,
				c.createdAt,

				s.staffID AS linkedStaffID,

				COUNT(a.appointmentID) AS totalReservations,
				COALESCE(SUM(CASE WHEN a.date < NOW() THEN 1 ELSE 0 END), 0) AS pastReservations,
				COALESCE(SUM(CASE WHEN a.date >= NOW() THEN 1 ELSE 0 END), 0) AS upcomingReservations
			FROM customer c
			LEFT JOIN staff s
				ON s.userID = c.userID
			LEFT JOIN appointment a
				ON a.userID = c.userID
			WHERE c.userType <> 'ADMIN'
			GROUP BY
				c.userID,
				c.username,
				c.email,
				c.legalFirstName,
				c.legalLastName,
				c.userType,
				c.createdAt,
				s.staffID
			ORDER BY c.userID ASC
			`
		);

		/*
			Shapes the SQL rows into the response object the frontend expects.

			alreadyLinkedToStaff is derived from linkedStaffID.
			The reservation counts come back from SQL and are turned into numbers here.
		*/
		const shaped = rows.map((row) => ({
			userID: row.userID,
			username: row.username,
			email: row.email,
			legalFirstName: row.legalFirstName,
			legalLastName: row.legalLastName,
			userType: row.userType,
			createdAt: row.createdAt,
			linkedStaffID: row.linkedStaffID,
			alreadyLinkedToStaff: row.linkedStaffID !== null,
			totalReservations: Number(row.totalReservations ?? 0),
			pastReservations: Number(row.pastReservations ?? 0),
			upcomingReservations: Number(row.upcomingReservations ?? 0),
		}));

		res.json(shaped);
	} catch (err) {
		console.error("GET /api/staff/users error:", err);
		res.status(500).json({ error: "failed to load users" });
	}
});

export default router;