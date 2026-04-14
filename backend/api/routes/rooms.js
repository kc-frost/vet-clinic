import express from "express";
import { pool } from "../db.js";
import { requireAdmin } from "../lib/authMiddleware.js";
import { notifyUsersAboutUnderReviewAppointments, processInactiveRoom } from "../lib/appointmentIssueService.js";

const router = express.Router();
const VALID_ROOM_TYPES = new Set(["EXAM", "IMAGING", "SURGERY", "GROOMING"]);

// GET /api/rooms
// returns active rooms by default and can include inactive ones when asked
router.get("/", requireAdmin, async (req, res) => {
	try {
		// Default to active rooms only unless the caller explicitly asks for inactive ones too
		const includeInactive = String(req.query.includeInactive || "").trim() === "1";
		const whereClause = includeInactive ? "" : "WHERE COALESCE(isActive, 1) = 1";

		const [rows] = await pool.query(
			`SELECT roomNumber, roomType, capacity, COALESCE(isActive, 1) AS isActive, deactivatedAt
			 FROM rooms
			 ${whereClause}
			 ORDER BY roomNumber ASC`
		);

		res.json(rows);
	} catch (err) {
		console.error("GET /api/rooms error:", err);
		res.status(500).send("Server error fetching rooms.");
	}
});

// POST /api/rooms
router.post("/", requireAdmin, async (req, res) => {
	try {
		const { roomNumber, roomType, capacity } = req.body ?? {};
		const rn = Number(roomNumber);
		const cap = Number(capacity);
		const rt = typeof roomType === "string" ? roomType.trim() : "";

		// Validate the admin input before trying to insert anything
		if (!Number.isInteger(rn) || rn < 1) return res.status(400).send("roomNumber must be an integer >= 1.");
		if (!VALID_ROOM_TYPES.has(rt)) return res.status(400).send("roomType must be EXAM, IMAGING, SURGERY, or GROOMING.");
		if (!Number.isInteger(cap) || cap < 1) return res.status(400).send("capacity must be an integer >= 1.");

		// roomNumber is the primary key so stop early if it already exists
		const [existing] = await pool.query(`SELECT roomNumber FROM rooms WHERE roomNumber = ? LIMIT 1`, [rn]);
		if (existing.length > 0) return res.status(409).send("roomNumber already exists.");

		await pool.query(`INSERT INTO rooms (roomNumber, roomType, capacity) VALUES (?, ?, ?)`, [rn, rt, cap]);
		res.status(201).send("Created.");
	} catch (err) {
		console.error("POST /api/rooms error:", err);
		res.status(500).send("Server error creating room.");
	}
});

// PATCH /api/rooms/:roomNumber/deactivate
// marks the room inactive and tries same time room replacement where possible
router.patch("/:roomNumber/deactivate", requireAdmin, async (req, res) => {
	const roomNumber = Number(req.params.roomNumber);
	if (!Number.isInteger(roomNumber) || roomNumber < 1) return res.status(400).send("Invalid roomNumber.");

	const conn = await pool.getConnection();

	try {
		// The room deactivation and any appointment updates should succeed or fail together
		await conn.beginTransaction();

		const [roomRows] = await conn.query(
			`SELECT roomNumber, roomType, COALESCE(isActive, 1) AS isActive
			 FROM rooms
			 WHERE roomNumber = ?
			 LIMIT 1`,
			[roomNumber]
		);

		if (!roomRows.length) {
			await conn.rollback();
			return res.status(404).send("Room not found.");
		}

		const room = roomRows[0];

		// Stop if the room is already inactive
		if (Number(room.isActive) === 0) {
			await conn.rollback();
			return res.status(409).send("Room is already inactive.");
		}

		// Mark the room inactive first so replacement logic does not treat it as usable
		await conn.query(
			`UPDATE rooms
			 SET isActive = 0,
				 deactivatedAt = NOW()
			 WHERE roomNumber = ?`,
			[roomNumber]
		);

		// Let the issue service try to move affected appointments into another room of the same type
		// Any appointments that cannot be fixed automatically get pushed into review
		const result = await processInactiveRoom(conn, roomNumber);

		await conn.commit();
		await notifyUsersAboutUnderReviewAppointments(result.underReviewAppointmentIDs);

		res.json({
			message: "Room deactivated.",
			roomNumber: Number(room.roomNumber),
			roomType: String(room.roomType || ""),
			autoResolvedAppointmentIDs: result.autoResolvedAppointmentIDs,
			autoResolvedAppointmentCount: result.autoResolvedAppointmentIDs.length,
			underReviewAppointmentIDs: result.underReviewAppointmentIDs,
			underReviewAppointmentCount: result.underReviewAppointmentIDs.length,
		});
	} catch (err) {
		await conn.rollback();
		console.error("PATCH /api/rooms/:roomNumber/deactivate error:", err);
		res.status(500).send("Server error deactivating room.");
	} finally {
		conn.release();
	}
});

// PATCH /api/rooms/:roomNumber/reactivate
// brings a removed room back into the active list
router.patch("/:roomNumber/reactivate", requireAdmin, async (req, res) => {
	const roomNumber = Number(req.params.roomNumber);
	if (!Number.isInteger(roomNumber) || roomNumber < 1) return res.status(400).send("Invalid roomNumber.");

	try {
		const [rows] = await pool.query(
			`SELECT roomNumber, roomType, capacity, COALESCE(isActive, 1) AS isActive
			 FROM rooms
			 WHERE roomNumber = ?
			 LIMIT 1`,
			[roomNumber]
		);

		if (!rows.length) return res.status(404).send("Room not found.");

		const room = rows[0];
		if (Number(room.isActive) === 1) return res.status(409).send("Room is already active.");

		await pool.query(
			`UPDATE rooms
			 SET isActive = 1,
				 deactivatedAt = NULL
			 WHERE roomNumber = ?`,
			[roomNumber]
		);

		res.json({
			message: "Room reactivated.",
			roomNumber: Number(room.roomNumber),
			roomType: String(room.roomType || ""),
			capacity: Number(room.capacity || 0),
		});
	} catch (err) {
		console.error("PATCH /api/rooms/:roomNumber/reactivate error:", err);
		res.status(500).send("Server error reactivating room.");
	}
});

router.delete("/:roomNumber", requireAdmin, (req, res) => {
	res.status(405).send("Delete is disabled for this sprint.");
});

export default router;