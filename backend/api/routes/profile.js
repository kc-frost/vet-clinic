import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { pool } from "../db.js";
import { requireAuth } from "../lib/authMiddleware.js";

const router = express.Router();

/*
	Build the absolute folder path where uploaded profile pictures
	will be stored on the backend.
*/
const PROFILE_PICTURE_DIR = path.resolve(process.cwd(), "uploads", "profile-pictures");

/*
	Limit profile picture uploads to 2 MB so users cannot upload
	overly large image files.
*/
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

/*
	Only allow common web image formats that the frontend and backend
	expect to handle for profile pictures.
*/
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/*
	Create the uploads folder ahead of time if it does not already
	exist so file writes later do not fail.
*/
if (!fs.existsSync(PROFILE_PICTURE_DIR)) {
	fs.mkdirSync(PROFILE_PICTURE_DIR, { recursive: true });
}

/*
	Read the userID only from the logged-in session.
	This route should trust the authenticated session, not user input.
*/
function getUserIdFromSession(req) {
	const raw = req?.session?.userID;

	/*
		Reject missing or empty session values before trying to convert
		them into a number.
	*/
	if (raw === null || raw === undefined || raw === "") return null;

	/*
		Convert the session value into a number so we can verify it is a
		valid positive integer user ID.
	*/
	const n = Number(raw);

	/*
		Reject anything that is not a valid positive whole-number user ID.
	*/
	if (!Number.isInteger(n) || n <= 0) return null;

	return n;
}

function normalizeString(value) {
	/*
		Convert nullish database values into empty strings so the frontend
		gets a consistent string shape for profile fields.
	*/
	return value === null || value === undefined ? "" : String(value);
}

function mapProfileRow(row) {
	/*
		Shape one raw database row into the exact profile object format
		that the frontend expects.
	*/
	return {
		userID: Number(row.userID),
		email: normalizeString(row.email),
		userBio: normalizeString(row.userBio),
		legalFirstName: normalizeString(row.legalFirstName),
		legalLastName: normalizeString(row.legalLastName),
		phone: normalizeString(row.phone),
		addressLine1: normalizeString(row.addressLine1),
		city: normalizeString(row.city),
		state: normalizeString(row.state),
		zipCode: normalizeString(row.zipCode),
		profileImagePath: normalizeString(row.profileImagePath),
		userType: normalizeString(row.userType),
	};
}

async function selectProfileRow(userID) {
	/*
		Fetch the current profile data for one user directly from the
		customer table using the authenticated user's userID.
	*/
	const [rows] = await pool.execute(
		`select
			userID,
			email,
			userBio,
			legalFirstName,
			legalLastName,
			phone,
			addressLine1,
			city,
			state,
			zipCode,
			profileImagePath,
			userType
		from customer
		where userID = ?`,
		[userID]
	);

	return rows;
}

function extensionFromMime(mimeType) {
	/*
		Map each allowed MIME type to the file extension we want to use
		when saving the uploaded image on disk.
	*/
	if (mimeType === "image/jpeg") return ".jpg";
	if (mimeType === "image/png") return ".png";
	if (mimeType === "image/webp") return ".webp";

	/*
		Return an empty string for anything unsupported so the caller
		can reject that upload.
	*/
	return "";
}

/*
	Configure multer to keep uploaded image data in memory first,
	enforce the size limit, and reject disallowed image types.
*/
const upload = multer({
	storage: multer.memoryStorage(),
	limits: {
		fileSize: MAX_FILE_SIZE_BYTES,
	},
	fileFilter: (_req, file, cb) => {
		/*
			Stop the upload immediately if the file is not one of the
			allowed image MIME types.
		*/
		if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
			cb(new Error("Only JPG, PNG, and WEBP images are allowed"));
			return;
		}

		/*
			Accept the file when its MIME type is allowed.
		*/
		cb(null, true);
	},
});

router.get("/", requireAuth, async (req, res) => {
	try {
		/*
			Use the authenticated session to determine which user's profile
			should be returned.
		*/
		const userID = getUserIdFromSession(req);

		/*
			If the session does not contain a valid user ID, treat the
			request as unauthenticated.
		*/
		if (!userID) {
			res.status(401).json({ error: "not authenticated" });
			return;
		}

		/*
			Load the current user's profile row from the database.
		*/
		const rows = await selectProfileRow(userID);

		/*
			If no matching user exists, return a not-found response.
		*/
		if (!rows.length) {
			res.status(404).json({ error: "user not found" });
			return;
		}

		/*
			Return the normalized profile object to the frontend.
		*/
		res.json(mapProfileRow(rows[0]));
	} catch (err) {
		console.error("profile get error", err);
		res.status(500).json({ error: "failed to fetch profile" });
	}
});

router.put("/", requireAuth, async (req, res) => {
	try {
		/*
			Use the authenticated session user only.
			The client should not choose which profile gets updated.
		*/
		const userID = getUserIdFromSession(req);

		if (!userID) {
			res.status(401).json({ error: "not authenticated" });
			return;
		}

		/*
			Read the request body, defaulting to an empty object if none
			was provided.
		*/
		const body = req.body || {};

		/*
			These are the only profile fields this route is allowed to edit.
			Everything else is intentionally ignored.
		*/
		const allowedFields = [
			"userBio",
			"legalFirstName",
			"legalLastName",
			"phone",
			"addressLine1",
			"city",
			"state",
			"zipCode",
		];

		/*
			Build the dynamic SET clause and parameter list only from
			fields that were actually supplied by the client.
		*/
		const setParts = [];
		const params = [];

		for (const field of allowedFields) {
			/*
				Only update a field if it exists on the incoming body.
				This allows partial profile updates.
			*/
			if (Object.prototype.hasOwnProperty.call(body, field)) {
				setParts.push(`${field} = ?`);

				/*
					Normalize nullish incoming values into empty strings so
					the database stores a consistent text value.
				*/
				params.push(body[field] === null || body[field] === undefined ? "" : String(body[field]));
			}
		}

		/*
			Reject the request if it did not include any editable profile fields.
		*/
		if (!setParts.length) {
			res.status(400).json({ error: "no editable fields supplied" });
			return;
		}

		/*
			The WHERE clause uses the authenticated session userID.
		*/
		params.push(userID);

		/*
			Update only the supplied editable fields for the logged-in user.
		*/
		await pool.execute(
			`update customer
			 set ${setParts.join(", ")}
			 where userID = ?`,
			params
		);

		/*
			Re-read the updated profile so the response reflects the exact
			current database state after the update.
		*/
		const rows = await selectProfileRow(userID);

		if (!rows.length) {
			res.status(404).json({ error: "user not found" });
			return;
		}

		res.json(mapProfileRow(rows[0]));
	} catch (err) {
		console.error("profile put error", err);
		res.status(500).json({ error: "failed to update profile" });
	}
});

router.post("/photo", requireAuth, upload.single("profileImage"), async (req, res) => {
	try {
		/*
			Use the logged-in session to decide whose profile picture
			is being changed.
		*/
		const userID = getUserIdFromSession(req);

		if (!userID) {
			res.status(401).json({ error: "not authenticated" });
			return;
		}

		/*
			The request must actually include an uploaded profile image file.
		*/
		if (!req.file) {
			res.status(400).json({ error: "profile image is required" });
			return;
		}

		/*
			Convert the uploaded file MIME type into the file extension
			we will save on disk.
		*/
		const fileExt = extensionFromMime(req.file.mimetype);

		/*
			Reject the upload if its MIME type does not map to one of our
			supported image extensions.
		*/
		if (!fileExt) {
			res.status(400).json({ error: "unsupported image type" });
			return;
		}

		/*
			Keep only one current profile picture per user by deleting any
			older JPG, PNG, or WEBP version saved for that same user.
		*/
		const baseName = `user-${userID}`;
		const allPossiblePaths = [".jpg", ".png", ".webp"].map((ext) => path.join(PROFILE_PICTURE_DIR, `${baseName}${ext}`));

		for (const absPath of allPossiblePaths) {
			if (fs.existsSync(absPath)) {
				fs.unlinkSync(absPath);
			}
		}

		/*
			Build the final saved filename, its absolute disk path, and the
			public-style path we will store in the database.
		*/
		const fileName = `${baseName}${fileExt}`;
		const absFilePath = path.join(PROFILE_PICTURE_DIR, fileName);
		const dbPath = `/uploads/profile-pictures/${fileName}`;

		/*
			Write the uploaded image buffer to disk now that the final path
			has been decided.
		*/
		fs.writeFileSync(absFilePath, req.file.buffer);

		/*
			Store the saved image path on the user's customer row so the
			frontend can later display that profile picture.
		*/
		await pool.execute(
			`update customer
			 set profileImagePath = ?
			 where userID = ?`,
			[dbPath, userID]
		);

		/*
			Fetch the latest profile row so the response includes the new
			profileImagePath and current profile data.
		*/
		const rows = await selectProfileRow(userID);

		if (!rows.length) {
			res.status(404).json({ error: "user not found" });
			return;
		}

		res.json({
			ok: true,
			message: "profile picture updated",
			profile: mapProfileRow(rows[0]),
		});
	} catch (err) {
		console.error("profile photo upload error", err);

		/*
			If multer rejected the upload because it was too large,
			return a specific size-related error.
		*/
		if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
			res.status(400).json({ error: "image must be 2MB or smaller" });
			return;
		}

		/*
			If the error already has a usable message, return that as a
			client-facing validation error.
		*/
		if (err instanceof Error && err.message) {
			res.status(400).json({ error: err.message });
			return;
		}

		res.status(500).json({ error: "failed to upload profile picture" });
	}
});

export default router;