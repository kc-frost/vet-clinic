import express from "express";
import crypto from "crypto";
import { pool } from "../db.js";

const router = express.Router();

function validateEmail(email) {
	/*
		Check whether the email follows a basic email format before
		we allow it to be used for registration or login processing.
	*/
	const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

	/*
		If the email does not match the pattern, return a failed
		validation result along with the reason.
	*/
	if (!pattern.test(email)) return { ok: false, message: "Invalid email format" };

	/*
		The email passed validation, so return a successful result.
	*/
	return { ok: true, message: "" };
}

function validatePassword(password) {
	/*
		First make sure the password value is actually a string before
		we run string-specific checks against it.
	*/
	if (typeof password !== "string") return { ok: false, message: "Password must be a string" };

	/*
		Enforce a minimum length so very short passwords are rejected.
	*/
	if (password.length < 8) return { ok: false, message: "Password needs a minimum length of 8 characters" };

	/*
		Require at least one digit so the password is not made up of
		letters alone.
	*/
	if (!/[0-9]/.test(password)) return { ok: false, message: "Password needs at least one number" };

	/*
		Require at least one lowercase letter.
	*/
	if (!/[a-z]/.test(password)) return { ok: false, message: "Password needs at least one lowercase letter" };

	/*
		Require at least one uppercase letter.
	*/
	if (!/[A-Z]/.test(password)) return { ok: false, message: "Password needs at least one uppercase letter" };

	/*
		The password satisfied all validation rules.
	*/
	return { ok: true, message: "" };
}

function md5(text) {
	/*
		Hash the given text using MD5 so the raw password is not stored
		directly in the database.
	*/
	return crypto.createHash("md5").update(text).digest("hex");
}

function normalizeEmail(emailRaw) {
	/*
		Trim surrounding whitespace and lowercase the email so stored
		and compared email values are consistent.
	*/
	return String(emailRaw).trim().toLowerCase();
}

function normalizeAdminCode(adminCodeRaw) {
	/*
		If no admin code was provided at all, normalize that case into
		an empty string so later checks stay simple.
	*/
	if (adminCodeRaw === null || adminCodeRaw === undefined) return "";

	/*
		Otherwise convert the value to a string and trim extra spaces
		around it before comparing it.
	*/
	return String(adminCodeRaw).trim();
}

function shouldGrantAdmin(adminCodeRaw) {
	/*
		Normalize the incoming admin code first so later comparisons
		are done against a clean value.
	*/
	const code = normalizeAdminCode(adminCodeRaw);

	/*
		Do not grant admin if no code was provided.
	*/
	if (!code) return false;

	/*
		Reject codes that do not match the expected length.
	*/
	if (code.length !== 10) return false;

	/*
		Read the real admin code from environment variables so the
		secret is not hardcoded directly in application logic.
	*/
	const secret = process.env.ADMIN_CODE ? String(process.env.ADMIN_CODE).trim() : "";

	/*
		If there is no configured secret on the server, then admin
		access cannot be granted from this path.
	*/
	if (!secret) return false;

	/*
		Only grant admin when the provided code exactly matches
		the configured secret code.
	*/
	return code === secret;
}

function attachSessionIfPresent(req, user) {
	/*
		If the request or session object is missing, there is nowhere
		to store login state, so stop safely.
	*/
	if (!req || !req.session) return;

	/*
		Store the authenticated user's key identity fields in the
		session so later requests can recognize who is logged in.
	*/
	req.session.userID = user.userID;
	req.session.email = user.email;
	req.session.userType = user.userType;
}

function buildAuthUser(row) {
	/*
		Normalize the user type coming from the database so role checks
		remain consistent throughout the application.
	*/
	const userType = String(row.userType || "CUSTOMER").trim().toUpperCase();

	/*
		Build the user object shape returned to the frontend after
		login, registration, or session lookup.
	*/
	return {
		userID: Number(row.userID),
		email: String(row.email),
		userType,
		isAdmin: userType === "ADMIN",
		isStaff: userType === "STAFF",
	};
}

router.post("/register", async (req, res) => {
	try {
		/*
			Read the registration fields from the request body.
			adminCode is optional, but email and password are required.
		*/
		let { email, password, adminCode } = req.body ?? {};

		/*
			Reject the request immediately if email or password
			was not provided.
		*/
		if (!email || !password) {
			return res.status(400).json({ message: "email and password are required" });
		}

		/*
			Normalize the email and force password into string form
			before validation and storage steps.
		*/
		email = normalizeEmail(email);
		password = String(password);

		/*
			Validate the email format and return the specific reason
			if it fails.
		*/
		const e = validateEmail(email);
		if (!e.ok) return res.status(400).json({ message: e.message });

		/*
			Validate password strength and return the specific reason
			if it fails.
		*/
		const p = validatePassword(password);
		if (!p.ok) return res.status(400).json({ message: p.message });

		/*
			Check whether another account already uses this email.
			If so, do not allow a duplicate account to be created.
		*/
		const [existing] = await pool.execute(
			"SELECT userID, isDeactivated FROM customer WHERE email = ? LIMIT 1",
			[email]
		);

		if (existing.length > 0) {
			if (Number(existing[0].isDeactivated) === 1) {
				return res.status(409).json({ message: "Cannot register with the email of a deactivated account" });
			}

			return res.status(409).json({ message: "Email already exists" });
		}

		/*
			Decide whether this new account should become ADMIN or stay
			as a normal CUSTOMER based on the provided admin code.
		*/
		const userType = shouldGrantAdmin(adminCode) ? "ADMIN" : "CUSTOMER";

		/*
			Hash the password before inserting it into the database.
		*/
		const enc = md5(password);

		/*
			Create the new customer record in the database.
		*/
		const [result] = await pool.execute(
			"INSERT INTO customer (email, password, userType) VALUES (?, ?, ?)",
			[email, enc, userType]
		);

		/*
			Build the authentication payload for the newly created user.
		*/
		const user = buildAuthUser({
			userID: result.insertId,
			email,
			userType,
		});

		/*
			If sessions are available, immediately log the new user in
			by attaching their identity data to the session.
		*/
		attachSessionIfPresent(req, user);

		/*
			Return a success response along with the authenticated
			user object the frontend can store/use.
		*/
		return res.status(201).json({
			message: "registered",
			user,
		});
	} catch (err) {
		console.error("register error:", err);
		return res.status(500).json({ message: "Server error" });
	}
});

router.post("/login", async (req, res) => {
	try {
		/*
			Read the login credentials from the request body.
		*/
		let { email, password } = req.body ?? {};

		/*
			Reject the request if either required login field is missing.
		*/
		if (!email || !password) {
			return res.status(400).json({ message: "email and password are required" });
		}

		/*
			Normalize the email, convert password to string form,
			and hash it before comparing against the database value.
		*/
		email = normalizeEmail(email);
		password = String(password);
		const enc = md5(password);

		/*
			Look for exactly one matching user whose email and hashed
			password match the provided credentials.
		*/
		const [rows] = await pool.execute(
			"SELECT userID, email, userType, isDeactivated FROM customer WHERE email = ? AND password = ? LIMIT 1",
			[email, enc]
		);

		/*
			If no row matched, then the login credentials are invalid.
		*/
		if (rows.length === 0) {
			return res.status(401).json({ message: "Invalid email or password" });
		}

		if (Number(rows[0].isDeactivated) === 1) {
			return res.status(403).json({ message: "Cannot sign in to this account because it has been deactivated" });
		}

		/*
			Build the authenticated user object from the database row.
		*/
		const user = buildAuthUser(rows[0]);

		/*
			Store this user's identity in the session so future requests
			can treat them as logged in.
		*/
		attachSessionIfPresent(req, user);

		/*
			Return the successful login response and authenticated user.
		*/
		return res.status(200).json({
			message: "logged in",
			user,
		});
	} catch (err) {
		console.error("login error:", err);
		return res.status(500).json({ message: "Server error" });
	}
});

router.get("/me", async (req, res) => {
	/*
		Read the current session identity fields. These are what tell us
		who is currently logged in for this request.
	*/
	const userID = req?.session?.userID;
	const email = req?.session?.email;
	const userType = String(req?.session?.userType || "").trim().toUpperCase();

	/*
		If any required session identity field is missing, then treat
		the request as unauthenticated.
	*/
	if (!userID || !email || !userType) {
		return res.status(401).json({ message: "not authenticated" });
	}

	const safeUserID = Number(userID);
	if (!Number.isInteger(safeUserID) || safeUserID < 1) {
		return res.status(401).json({ message: "not authenticated" });
	}

	try {
		const [rows] = await pool.execute(
			"SELECT isDeactivated FROM customer WHERE userID = ? LIMIT 1",
			[safeUserID]
		);

		if (!rows.length || Number(rows[0].isDeactivated) === 1) {
			if (req.session) {
				req.session.destroy(() => {});
			}
			return res.status(401).json({ message: "not authenticated" });	
		}

		return res.json({
			userID: Number(userID),
			email: String(email),
			userType,
			isAdmin: userType === "ADMIN",
			isStaff: userType === "STAFF",
		});
	} catch (err) {
		console.error("me error:", err);
		return res.status(500).json({ message: "Server error" });
	}
});

router.post("/logout", (req, res) => {
	/*
		If there is no session object at all, there is nothing to destroy,
		so we can still safely report the user as logged out.
	*/
	if (!req.session) {
		return res.json({ message: "logged out" });
	}

	/*
		Destroy the session so the server no longer recognizes this user
		as authenticated on later requests.
	*/
	req.session.destroy((err) => {
		if (err) {
			console.error("logout error:", err);
			return res.status(500).json({ message: "failed to logout" });
		}

		/*
			The session was destroyed successfully, so confirm logout.
		*/
		return res.json({ message: "logged out" });
	});
});

export default router;