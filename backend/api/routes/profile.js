import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { pool } from "../db.js";

const router = express.Router();

const PROFILE_PICTURE_DIR = path.resolve(process.cwd(), "uploads", "profile-pictures");
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

if (!fs.existsSync(PROFILE_PICTURE_DIR)) {
	fs.mkdirSync(PROFILE_PICTURE_DIR, { recursive: true });
}

// this pulls userID from session first
// query fallback is for local testing if needed
function getUserIdFromSessionOrQuery(req) {
	const fromSession = req?.session?.user?.userID ?? req?.session?.userID;
	if (fromSession) {
		const n = Number(fromSession);
		if (Number.isInteger(n) && n > 0) return n;
	}

	const fromQuery = req?.query?.userID;
	if (fromQuery === null || fromQuery === undefined || fromQuery === "") return null;

	const n = Number(fromQuery);
	if (!Number.isInteger(n) || n <= 0) return null;
	return n;
}

function normalizeString(value) {
	return value === null || value === undefined ? "" : String(value);
}

function mapProfileRow(row) {
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
	if (mimeType === "image/jpeg") return ".jpg";
	if (mimeType === "image/png") return ".png";
	if (mimeType === "image/webp") return ".webp";
	return "";
}

const upload = multer({
	storage: multer.memoryStorage(),
	limits: {
		fileSize: MAX_FILE_SIZE_BYTES,
	},
	fileFilter: (_req, file, cb) => {
		if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
			cb(new Error("Only JPG, PNG, and WEBP images are allowed"));
			return;
		}
		cb(null, true);
	},
});

// GET /api/profile
// returns the current user's profile data
router.get("/", async (req, res) => {
	try {
		const userID = getUserIdFromSessionOrQuery(req);
		if (!userID) {
			res.status(400).json({ error: "missing userID" });
			return;
		}

		const rows = await selectProfileRow(userID);
		if (!rows.length) {
			res.status(404).json({ error: "user not found" });
			return;
		}

		res.json(mapProfileRow(rows[0]));
	} catch (err) {
		console.error("profile get error", err);
		res.status(500).json({ error: "failed to fetch profile" });
	}
});

// PUT /api/profile
// updates editable profile fields
router.put("/", async (req, res) => {
	try {
		const userID = getUserIdFromSessionOrQuery(req);
		if (!userID) {
			res.status(400).json({ error: "missing userID" });
			return;
		}

		const body = req.body || {};

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

		const setParts = [];
		const params = [];

		for (const field of allowedFields) {
			if (Object.prototype.hasOwnProperty.call(body, field)) {
				setParts.push(`${field} = ?`);
				params.push(body[field] === null || body[field] === undefined ? "" : String(body[field]));
			}
		}

		if (!setParts.length) {
			res.status(400).json({ error: "no editable fields supplied" });
			return;
		}

		params.push(userID);

		await pool.execute(
			`update customer
			 set ${setParts.join(", ")}
			 where userID = ?`,
			params
		);

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

// POST /api/profile/photo
// saves one profile picture for the current user
router.post("/photo", upload.single("profileImage"), async (req, res) => {
	try {
		const userID = getUserIdFromSessionOrQuery(req);
		if (!userID) {
			res.status(400).json({ error: "missing userID" });
			return;
		}

		if (!req.file) {
			res.status(400).json({ error: "profile image is required" });
			return;
		}

		const fileExt = extensionFromMime(req.file.mimetype);
		if (!fileExt) {
			res.status(400).json({ error: "unsupported image type" });
			return;
		}

		// this keeps one current image per user
		// old image files with other allowed extensions get removed first
		const baseName = `user-${userID}`;
		const allPossiblePaths = [".jpg", ".png", ".webp"].map((ext) => path.join(PROFILE_PICTURE_DIR, `${baseName}${ext}`));

		for (const absPath of allPossiblePaths) {
			if (fs.existsSync(absPath)) {
				fs.unlinkSync(absPath);
			}
		}

		const fileName = `${baseName}${fileExt}`;
		const absFilePath = path.join(PROFILE_PICTURE_DIR, fileName);
		const dbPath = `/uploads/profile-pictures/${fileName}`;

		fs.writeFileSync(absFilePath, req.file.buffer);

		await pool.execute(
			`update customer
			 set profileImagePath = ?
			 where userID = ?`,
			[dbPath, userID]
		);

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

		if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
			res.status(400).json({ error: "image must be 2MB or smaller" });
			return;
		}

		if (err instanceof Error && err.message) {
			res.status(400).json({ error: err.message });
			return;
		}

		res.status(500).json({ error: "failed to upload profile picture" });
	}
});

export default router;