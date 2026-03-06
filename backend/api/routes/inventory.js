import express from "express";
import { pool } from "../db.js";

const router = express.Router();

// GET /api/inventory
router.get("/", async (req, res) => {
	try {
		const [rows] = await pool.query(
			`SELECT itemID, itemType, itemKey, displayName, isConsumable, quantity, itemDescription
			 FROM inventory
			 ORDER BY displayName ASC`
		);
		res.json(rows);
	} catch (err) {
		console.error("GET /api/inventory error:", err);
		res.status(500).send("Server error fetching inventory.");
	}
});

// POST /api/inventory
router.post("/", async (req, res) => {
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
		if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 0)
			return res.status(400).send("quantity must be an integer >= 0.");

		// itemKey must be unique
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
// only quantity (restock/capacity edit) is supported by UI
router.patch("/:itemID", async (req, res) => {
	try {
		const itemID = Number(req.params.itemID);
		if (!Number.isInteger(itemID) || itemID < 1) return res.status(400).send("Invalid itemID.");

		const { quantity } = req.body ?? {};

		if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 0)
			return res.status(400).send("quantity must be an integer >= 0.");

		const [result] = await pool.query(`UPDATE inventory SET quantity = ? WHERE itemID = ?`, [quantity, itemID]);
		if (result.affectedRows === 0) return res.status(404).send("Inventory item not found.");

		res.status(200).send("Updated.");
	} catch (err) {
		console.error("PATCH /api/inventory/:itemID error:", err);
		res.status(500).send("Server error updating inventory item.");
	}
});

// DELETE disabled for this sprint
router.delete("/:itemID", (req, res) => {
	res.status(405).send("Delete is disabled for this sprint.");
});

export default router;