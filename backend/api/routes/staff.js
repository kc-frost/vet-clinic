import express from "express";
import { pool } from "../db.js";
import { requireAdmin } from "../lib/authMiddleware.js";

const router = express.Router();

// allowed values for staff.role
// role is what the reservation scheduler uses when it searches for available staff
const VALID_ROLES = new Set(["VET", "PET_GROOMER"]);

// GET /api/staff
// returns all staff rows from the staff table
// response rows include: staffID, name, StaffNumber, email, position, role
router.get("/", requireAdmin, async (req, res) => {
	try {
		// ordering by name keeps the admin table predictable for humans
		const [rows] = await pool.query(
			`SELECT staffID, name, StaffNumber, email, position, role
			 FROM staff
			 ORDER BY name ASC`
		);

		res.json(rows);
	} catch (err) {
		console.error("GET /api/staff error:", err);
		res.status(500).send("Server error fetching staff.");
	}
});

// POST /api/staff
// creates a new staff row
// expected body fields:
//  name: required string
//  position: required string (display/job title like "Veterinarian")
//  role: required string, must be VET or PET_GROOMER
//  StaffNumber: optional (can be null)
//  email: optional (can be null)
router.post("/", requireAdmin, async (req, res) => {
	try {
		const { name, StaffNumber = null, email = null, position, role } = req.body ?? {};

		// normalize incoming values
		const n = typeof name === "string" ? name.trim() : "";
		const pos = typeof position === "string" ? position.trim() : "";
		const r = typeof role === "string" ? role.trim() : "";

		// basic validation for required fields
		if (!n) return res.status(400).send("name is required.");
		if (!pos) return res.status(400).send("position is required.");
		if (!VALID_ROLES.has(r)) return res.status(400).send("role must be VET or PET_GROOMER.");

		// insert staff row
		// staffID is auto_increment so it is assigned by mysql
		await pool.query(
			`INSERT INTO staff (name, StaffNumber, email, position, role)
			 VALUES (?, ?, ?, ?, ?)`,
			[n, StaffNumber, email, pos, r]
		);

		res.status(201).send("Created.");
	} catch (err) {
		console.error("POST /api/staff error:", err);
		res.status(500).send("Server error creating staff.");
	}
});

// DELETE /api/staff/:id
// delete is intentionally disabled for this sprint so existing appointments never get broken
// 405 means:
//  the server understood the request
//  but this method is not allowed on this route right now
router.delete("/:id", requireAdmin, (req, res) => {
	res.status(405).send("Delete is disabled for this sprint.");
});

router.get("/users", requireAdmin, async (req, res) => {
	try {
	  const [rows] = await pool.query(`
		SELECT 
		  u.userID,
		  u.email,
		  DATEDIFF(NOW(), u.created_at) AS days_registered,
  
		  COUNT(r.reservationID) AS total_reservations,
  
		  SUM(CASE WHEN r.start_time < NOW() THEN 1 ELSE 0 END) AS past_reservations,
  
		  SUM(CASE WHEN r.start_time >= NOW() THEN 1 ELSE 0 END) AS upcoming_reservations
  
		FROM users u
		LEFT JOIN reservations r
		  ON u.userID = r.userID
  
		GROUP BY u.userID, u.email, u.created_at
		ORDER BY u.userID;
	  `)
  
	  res.json(rows)
  
	} catch (err) {
	  console.error(err)
	  res.status(500).json({ error: "Failed to fetch users" })
	}
  })

export default router;