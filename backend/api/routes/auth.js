import express from "express";
import crypto from "crypto";
import { pool } from "../db.js";

const router = express.Router();

function validateEmail(email) {
  const pattern = /^[a-zA-Z0-9]+@[a-zA-Z0-9]+\.[a-zA-Z0-9]+$/;
  if (!pattern.test(email)) return { ok: false, message: "Invalid email format" };
  return { ok: true, message: "" };
}

function validatePassword(password) {
  if (typeof password !== "string") return { ok: false, message: "Password must be a string" };
  if (password.length < 8) return { ok: false, message: "Password needs a minimum length of 8 characters" };
  if (!/[0-9]/.test(password)) return { ok: false, message: "Password needs at least one number" };
  if (!/[a-z]/.test(password)) return { ok: false, message: "Password needs at least one lowercase letter" };
  if (!/[A-Z]/.test(password)) return { ok: false, message: "Password needs at least one uppercase letter" };
  return { ok: true, message: "" };
}

function md5(text) {
  return crypto.createHash("md5").update(text).digest("hex");
}

// POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    let { email, password } = req.body ?? {};

    if (!email || !password) {
      return res.status(400).json({ message: "email and password are required" });
    }

    email = String(email).trim().toLowerCase();
    password = String(password);

    const e = validateEmail(email);
    if (!e.ok) return res.status(400).json({ message: e.message });

    const p = validatePassword(password);
    if (!p.ok) return res.status(400).json({ message: p.message });

    const [existing] = await pool.execute(
      "SELECT userID FROM customer WHERE email = ? LIMIT 1",
      [email]
    );

    if (existing.length > 0) {
      return res.status(409).json({ message: "Email already exists" });
    }

    const enc = md5(password);

    const [result] = await pool.execute(
      "INSERT INTO customer (email, password) VALUES (?, ?)",
      [email, enc]
    );

    return res.status(201).json({ ok: true, userID: result.insertId });
  } catch (err) {
    console.error("register error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    let { email, password } = req.body ?? {};

    if (!email || !password) {
      return res.status(400).json({ message: "email and password are required" });
    }

    email = String(email).trim().toLowerCase();
    password = String(password);

    const enc = md5(password);

    const [rows] = await pool.execute(
      "SELECT userID FROM customer WHERE email = ? AND password = ? LIMIT 1",
      [email, enc]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    return res.status(200).json({ ok: true, userID: rows[0].userID });
  } catch (err) {
    console.error("login error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

export default router;

