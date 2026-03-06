import express from "express";
import { pool } from "../db.js";

const router = express.Router();

// allowed values for rooms.roomType
// these match the scheduling logic variable constants and the seeed data
const VALID_ROOM_TYPES = new Set(["EXAM", "IMAGING", "SURGERY", "GROOMING"]);

// GET /api/rooms
// returns all rooms from the rooms table
// response rows include: roomNumber, roomType, capacity
router.get("/", async (req, res) => {
	try {
		// pool.query returns [rows, fields]
		// ordering by roomNumber keeps the admin table consistent
		const [rows] = await pool.query(
			`SELECT roomNumber, roomType, capacity
			 FROM rooms
			 ORDER BY roomNumber ASC`
		);

		res.json(rows);
	} catch (err) {
		console.error("GET /api/rooms error:", err);
		res.status(500).send("Server error fetching rooms.");
	}
});

// POST /api/rooms
// creates a new room row
// expected body fields:
//  roomNumber: integer >= 1 (primary key, not auto increment)
//  roomType: one of EXAM, IMAGING, SURGERY, GROOMING
//  capacity: integer >= 1
router.post("/", async (req, res) => {
	try {
		const { roomNumber, roomType, capacity } = req.body ?? {};

		// normalize/convert incoming values
		const rn = Number(roomNumber);
		const cap = Number(capacity);
		const rt = typeof roomType === "string" ? roomType.trim() : "";

		// input validation so the db insert does not get bad values
		if (!Number.isInteger(rn) || rn < 1) return res.status(400).send("roomNumber must be an integer >= 1.");
		if (!VALID_ROOM_TYPES.has(rt)) return res.status(400).send("roomType must be EXAM, IMAGING, SURGERY, or GROOMING.");
		if (!Number.isInteger(cap) || cap < 1) return res.status(400).send("capacity must be an integer >= 1.");

		// roomNumber is the primary key, so duplicates should be rejected
		const [existing] = await pool.query(`SELECT roomNumber FROM rooms WHERE roomNumber = ? LIMIT 1`, [rn]);
		if (existing.length > 0) return res.status(409).send("roomNumber already exists.");

		// insert the new room
		await pool.query(`INSERT INTO rooms (roomNumber, roomType, capacity) VALUES (?, ?, ?)`, [rn, rt, cap]);

		res.status(201).send("Created.");
	} catch (err) {
		console.error("POST /api/rooms error:", err);
		res.status(500).send("Server error creating room.");
	}
});

// DELETE /api/rooms/:roomNumber
// delete is intentionally disabled for this sprint so existing appointments never get broken
// 405 means:
//  the server understood the request
//  but this method is not allowed on this route right now
router.delete("/:roomNumber", (req, res) => {
	res.status(405).send("Delete is disabled for this sprint.");
});

export default router;