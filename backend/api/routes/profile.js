import express from "express";
import { pool } from "../db.js";

const router = express.Router();

// this helper pulls userID from the session if it exists
// if sessions are not wired yet, it falls back to ?userID=# in the query string
// returns a positive number or null if missing/invalid
function getUserIdFromSessionOrQuery(req) {
  const fromSession = req?.session?.userID;
  if (fromSession) return Number(fromSession);

  const fromQuery = req?.query?.userID;
  if (fromQuery === null || fromQuery === undefined || fromQuery === "") return null;

  const n = Number(fromQuery);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

// GET /api/profile?userID=#
// returns basic profile info for the user profile page
// reads from customer table: userID, email, userBio
router.get("/", async (req, res) => {
  try {
    const userID = getUserIdFromSessionOrQuery(req);
    if (!userID) {
      res.status(400).json({ error: "missing userID" });
      return;
    }

    // parameterized query so userID is safely injected into the sql statement
    const [rows] = await pool.execute(
      "select userID, email, userBio from customer where userID = ?",
      [userID]
    );

    if (!rows.length) {
      res.status(404).json({ error: "user not found" });
      return;
    }

    // normalize types so frontend always gets clean strings/numbers
    const r = rows[0];
    res.json({
      userID: Number(r.userID),
      email: String(r.email || ""),
      userBio: String(r.userBio || ""),
    });
  } catch (err) {
    console.error("profile get error", err);
    res.status(500).json({ error: "failed to fetch profile" });
  }
});

// PUT /api/profile?userID=#   body: { userBio }
// updates customer.userBio for the given user, then returns the updated profile row
router.put("/", async (req, res) => {
  try {
    const userID = getUserIdFromSessionOrQuery(req);
    if (!userID) {
      res.status(400).json({ error: "missing userID" });
      return;
    }

    // accept any value and normalize it into a string
    // null/undefined becomes empty string so the column is never set to null accidentally
    const userBioRaw = req?.body?.userBio;
    const userBio = userBioRaw === null || userBioRaw === undefined ? "" : String(userBioRaw);

    await pool.execute(
      "update customer set userBio = ? where userID = ?",
      [userBio, userID]
    );

    // reselect and return what is currently stored so frontend stays in sync
    const [rows] = await pool.execute(
      "select userID, email, userBio from customer where userID = ?",
      [userID]
    );

    if (!rows.length) {
      res.status(404).json({ error: "user not found" });
      return;
    }

    const r = rows[0];
    res.json({
      userID: Number(r.userID),
      email: String(r.email || ""),
      userBio: String(r.userBio || ""),
    });
  } catch (err) {
    console.error("profile put error", err);
    res.status(500).json({ error: "failed to update profile" });
  }
});

export default router;