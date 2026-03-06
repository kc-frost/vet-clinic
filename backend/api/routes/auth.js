import express from "express";
import crypto from "crypto";
import { pool } from "../db.js";

const router = express.Router();

// email validation used during register
// required shape:
// - must contain exactly one "@"
// - must have at least one character before "@"
// - must have at least one character between "@" and "."
// - must have at least one character after "."
// this also rejects spaces anywhere in the email
function validateEmail(email) {
	const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	if (!pattern.test(email)) return { ok: false, message: "Invalid email format" };
	return { ok: true, message: "" };
}

// password validation used during register
// requirements:
//  must be a string
//  length >= 8
//  contains at least one digit 0-9
//  contains at least one lowercase a-z
//  contains at least one uppercase A-Z
function validatePassword(password) {
	if (typeof password !== "string") return { ok: false, message: "Password must be a string" };
	if (password.length < 8) return { ok: false, message: "Password needs a minimum length of 8 characters" };
	if (!/[0-9]/.test(password)) return { ok: false, message: "Password needs at least one number" };
	if (!/[a-z]/.test(password)) return { ok: false, message: "Password needs at least one lowercase letter" };
	if (!/[A-Z]/.test(password)) return { ok: false, message: "Password needs at least one uppercase letter" };
	return { ok: true, message: "" };
}

// md5 hash used for storing/checking password values
// returns a hex string
function md5(text) {
	return crypto.createHash("md5").update(text).digest("hex");
}

// normalize emails so registration + login are consistent
// this makes email matching case-insensitive and ignores leading/trailing whitespace
function normalizeEmail(emailRaw) {
	return String(emailRaw).trim().toLowerCase();
}

// adminCode is optional, so null/undefined becomes empty string
function normalizeAdminCode(adminCodeRaw) {
	if (adminCodeRaw === null || adminCodeRaw === undefined) return "";
	return String(adminCodeRaw).trim();
}

// returns true only if the provided adminCode matches the server secret
// requirements for adminCode to be accepted:
//  after trim, length must be exactly 10 characters
//  ADMIN_CODE must exist in environment variables in backend
//  provided code must equal ADMIN_CODE exactly
function shouldGrantAdmin(adminCodeRaw) {
	const code = normalizeAdminCode(adminCodeRaw);
	if (!code) return false;
	if (code.length !== 10) return false;

	const secret = process.env.ADMIN_CODE ? String(process.env.ADMIN_CODE).trim() : "";
	if (!secret) return false;

	return code === secret;
}

// sessions are only set if express-session is enabled on the server
// these fields are what GET /api/auth/me reads later
function attachSessionIfPresent(req, user) {
	if (!req || !req.session) return;
	req.session.userID = user.userID;
	req.session.email = user.email;
	req.session.isAdmin = user.isAdmin;
}

// POST /api/auth/register
// expected body:
//  email: string
//  password: string
//  adminCode: optional string
router.post("/register", async (req, res) => {
	try {
		let { email, password, adminCode } = req.body ?? {};

		// reject missing required fields early
		if (!email || !password) {
			return res.status(400).json({ message: "email and password are required" });
		}

		// normalize input before validation + storage
		email = normalizeEmail(email);
		password = String(password);

		const e = validateEmail(email);
		if (!e.ok) return res.status(400).json({ message: e.message });

		const p = validatePassword(password);
		if (!p.ok) return res.status(400).json({ message: p.message });

		// check for duplicate email before insert
		const [existing] = await pool.execute(
			"SELECT userID FROM customer WHERE email = ? LIMIT 1",
			[email]
		);

		if (existing.length > 0) {
			return res.status(409).json({ message: "Email already exists" });
		}

		// admin is granted only if adminCode matches the env secret
		const isAdmin = shouldGrantAdmin(adminCode);

		// store hashed password in db
		const enc = md5(password);

		// insert user row
		const [result] = await pool.execute(
			"INSERT INTO customer (email, password, isAdmin) VALUES (?, ?, ?)",
			[email, enc, isAdmin ? 1 : 0]
		);

		// build the response user object
		const user = {
			userID: Number(result.insertId),
			email,
			isAdmin: Boolean(isAdmin),
		};

		// if sessions are enabled, this keeps the browser logged in after register
		attachSessionIfPresent(req, user);

		return res.status(201).json({
			message: "registered",
			user,
		});
	} catch (err) {
		console.error("register error:", err);
		return res.status(500).json({ message: "Server error" });
	}
});

// POST /api/auth/login
// expected body:
//  email: string
//  password: string
router.post("/login", async (req, res) => {
	try {
		let { email, password } = req.body ?? {};

		if (!email || !password) {
			return res.status(400).json({ message: "email and password are required" });
		}

		email = normalizeEmail(email);
		password = String(password);

		// hash incoming password so it can be compared to the stored hash
		const enc = md5(password);

		const [rows] = await pool.execute(
			"SELECT userID, email, isAdmin FROM customer WHERE email = ? AND password = ? LIMIT 1",
			[email, enc]
		);

		if (rows.length === 0) {
			return res.status(401).json({ message: "Invalid email or password" });
		}

		const user = {
			userID: Number(rows[0].userID),
			email: String(rows[0].email),
			isAdmin: Boolean(rows[0].isAdmin),
		};

		attachSessionIfPresent(req, user);

		return res.status(200).json({
			message: "logged in",
			user,
		});
	} catch (err) {
		console.error("login error:", err);
		return res.status(500).json({ message: "Server error" });
	}
});

// GET /api/auth/me
// returns the current logged-in session user
// if there is no session user, return 401 so the frontend knows it is logged out
router.get("/me", (req, res) => {
	const userID = req?.session?.userID;
	const email = req?.session?.email;
	const isAdmin = req?.session?.isAdmin;

	if (!userID || !email) {
		return res.status(401).json({ message: "not authenticated" });
	}

	return res.json({
		userID: Number(userID),
		email: String(email),
		isAdmin: Boolean(isAdmin),
	});
});

// POST /api/auth/logout
// destroys the session so /api/auth/me will return 401 afterward
router.post("/logout", (req, res) => {
	if (!req.session) {
		return res.json({ message: "logged out" });
	}

	req.session.destroy((err) => {
		if (err) {
			console.error("logout error:", err);
			return res.status(500).json({ message: "failed to logout" });
		}
		return res.json({ message: "logged out" });
	});
});

export default router;