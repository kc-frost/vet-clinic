// inventory.js
// Express router responsible for handling inventory related
// API endpoints for the veterinary clinic system.

import express from "express";
import { pool } from "../db.js";
import { requireAdmin } from "../lib/authMiddleware.js";
import { processInactiveInventoryItem, processNonConsumableQuantityChange } from "../lib/appointmentIssueService.js";

const router = express.Router();

// GET /api/inventory
// Returns the inventory list.
// This route is restricted to administrators only.
router.get("/", requireAdmin, async (req, res) => {
	try {
		const includeInactive = String(req.query.includeInactive || "").trim() === "1";
		const whereClause = includeInactive ? "" : "WHERE COALESCE(isActive, 1) = 1";
		const [rows] = await pool.query(
			`SELECT itemID, itemType, itemKey, displayName, isConsumable, quantity, itemDescription, COALESCE(isActive, 1) AS isActive, deactivatedAt
			 FROM inventory
			 ${whereClause}
			 ORDER BY displayName ASC`
		);

		res.json(rows);
	} catch (err) {
		console.error("GET /api/inventory error:", err);
		res.status(500).send("Server error fetching inventory.");
	}
});

// POST /api/inventory
router.post("/", requireAdmin, async (req, res) => {
	try {
		const {
			itemKey,
			displayName,
			itemType = null,
			isConsumable,
			quantity,
			itemDescription = null,
		} = req.body ?? {};

		const key = typeof itemKey === "string" ? itemKey.trim().toUpperCase() : "";
		const name = typeof displayName === "string" ? displayName.trim() : "";
		const type = typeof itemType === "string" ? itemType.trim() : itemType;
		const desc = typeof itemDescription === "string" ? itemDescription.trim() : itemDescription;

		if (!key) return res.status(400).send("itemKey is required.");
		if (!name) return res.status(400).send("displayName is required.");
		if (typeof isConsumable !== "boolean") return res.status(400).send("isConsumable must be boolean.");
		if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 0) return res.status(400).send("quantity must be an integer >= 0.");

		const [existing] = await pool.query(`SELECT itemID FROM inventory WHERE itemKey = ? LIMIT 1`, [key]);
		if (existing.length > 0) return res.status(409).send("itemKey already exists.");

		await pool.query(
			`INSERT INTO inventory (itemType, itemKey, displayName, isConsumable, quantity, itemDescription)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			[type, key, name, isConsumable ? 1 : 0, quantity, desc]
		);

		res.status(201).send("Created.");
	} catch (err) {
		console.error("POST /api/inventory error:", err);
		res.status(500).send("Server error creating inventory item.");
	}
});

// PATCH /api/inventory/:itemID
// only quantity is supported here
router.patch("/:itemID", requireAdmin, async (req, res) => {
	const itemID = Number(req.params.itemID);
	if (!Number.isInteger(itemID) || itemID < 1) return res.status(400).send("Invalid itemID.");

	const { quantity } = req.body ?? {};
	if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 0) return res.status(400).send("quantity must be an integer >= 0.");

	const conn = await pool.getConnection();

	try {
		await conn.beginTransaction();

		// Load the current item first so quantity changes can react differently for consumables and non consumables
		const [rows] = await conn.query(
			`SELECT itemID, itemKey, displayName, isConsumable, quantity, COALESCE(isActive, 1) AS isActive
			 FROM inventory
			 WHERE itemID = ?
			 LIMIT 1`,
			[itemID]
		);

		if (!rows.length) {
			await conn.rollback();
			return res.status(404).send("Inventory item not found.");
		}

		const item = rows[0];
		const previousQuantity = Number(item.quantity || 0);

		await conn.query(`UPDATE inventory SET quantity = ? WHERE itemID = ?`, [quantity, itemID]);

		let result = { keptAppointmentIDs: [], underReviewAppointmentIDs: [] };

		// Non consumables are capacity based, so lowering quantity can invalidate future overlapping appointments
		if (Number(item.isConsumable) === 0 && Number(item.isActive) === 1 && quantity < previousQuantity) {
			result = await processNonConsumableQuantityChange(conn, itemID, quantity);
		}

		await conn.commit();
		res.json({
			message: "Updated.",
			itemID: Number(item.itemID),
			itemKey: String(item.itemKey || ""),
			displayName: String(item.displayName || ""),
			quantity,
			keptAppointmentIDs: result.keptAppointmentIDs,
			keptAppointmentCount: result.keptAppointmentIDs.length,
			underReviewAppointmentIDs: result.underReviewAppointmentIDs,
			underReviewAppointmentCount: result.underReviewAppointmentIDs.length,
		});
	} catch (err) {
		await conn.rollback();
		console.error("PATCH /api/inventory/:itemID error:", err);
		res.status(500).send("Server error updating inventory item.");
	} finally {
		conn.release();
	}
});

// PATCH /api/inventory/:itemID/deactivate
// soft deletes the item for future operational use
router.patch("/:itemID/deactivate", requireAdmin, async (req, res) => {
	const itemID = Number(req.params.itemID);
	if (!Number.isInteger(itemID) || itemID < 1) return res.status(400).send("Invalid itemID.");

	const conn = await pool.getConnection();

	try {
		await conn.beginTransaction();

		const [rows] = await conn.query(
			`SELECT itemID, itemKey, displayName, isConsumable, COALESCE(isActive, 1) AS isActive
			 FROM inventory
			 WHERE itemID = ?
			 LIMIT 1`,
			[itemID]
		);

		if (!rows.length) {
			await conn.rollback();
			return res.status(404).send("Inventory item not found.");
		}

		const item = rows[0];
		if (Number(item.isActive) === 0) {
			await conn.rollback();
			return res.status(409).send("Inventory item is already inactive.");
		}

		await conn.query(
			`UPDATE inventory
			 SET isActive = 0,
				 quantity = 0,
				 deactivatedAt = NOW()
			 WHERE itemID = ?`,
			[itemID]
		);

		let result = { keptAppointmentIDs: [], underReviewAppointmentIDs: [] };
		if (Number(item.isConsumable) === 0) result = await processInactiveInventoryItem(conn, itemID);

		await conn.commit();
		res.json({
			message: "Inventory item deactivated.",
			itemID: Number(item.itemID),
			itemKey: String(item.itemKey || ""),
			displayName: String(item.displayName || ""),
			isConsumable: Number(item.isConsumable) === 1,
			quantity: 0,
			keptAppointmentIDs: result.keptAppointmentIDs,
			keptAppointmentCount: result.keptAppointmentIDs.length,
			underReviewAppointmentIDs: result.underReviewAppointmentIDs,
			underReviewAppointmentCount: result.underReviewAppointmentIDs.length,
		});
	} catch (err) {
		await conn.rollback();
		console.error("PATCH /api/inventory/:itemID/deactivate error:", err);
		res.status(500).send("Server error deactivating inventory item.");
	} finally {
		conn.release();
	}
});

// PATCH /api/inventory/:itemID/reactivate
// bring the item back into the active list with zero quantity
router.patch("/:itemID/reactivate", requireAdmin, async (req, res) => {
	const itemID = Number(req.params.itemID);
	if (!Number.isInteger(itemID) || itemID < 1) return res.status(400).send("Invalid itemID.");

	try {
		const [rows] = await pool.query(
			`SELECT itemID, itemKey, displayName, isConsumable, COALESCE(isActive, 1) AS isActive
			 FROM inventory
			 WHERE itemID = ?
			 LIMIT 1`,
			[itemID]
		);

		if (!rows.length) return res.status(404).send("Inventory item not found.");

		const item = rows[0];
		if (Number(item.isActive) === 1) return res.status(409).send("Inventory item is already active.");

		await pool.query(
			`UPDATE inventory
			 SET isActive = 1,
				 quantity = 0,
				 deactivatedAt = NULL
			 WHERE itemID = ?`,
			[itemID]
		);

		res.json({
			message: "Inventory item reactivated.",
			itemID: Number(item.itemID),
			itemKey: String(item.itemKey || ""),
			displayName: String(item.displayName || ""),
			isConsumable: Number(item.isConsumable) === 1,
			quantity: 0,
		});
	} catch (err) {
		console.error("PATCH /api/inventory/:itemID/reactivate error:", err);
		res.status(500).send("Server error reactivating inventory item.");
	}
});

router.delete("/:itemID", requireAdmin, (req, res) => {
	res.status(405).send("Delete is disabled for this sprint.");
});

export default router;
