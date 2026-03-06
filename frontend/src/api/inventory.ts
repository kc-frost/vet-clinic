import type { InventoryCreate, InventoryItem, InventoryPatch } from "../types/inventory";

// backend base path for inventory endpoints
const BASE_URL = "/api/inventory";

// GET /api/inventory
// returns inventory rows as InventoryItem[]
export async function getInventory(): Promise<InventoryItem[]> {
	const res = await fetch(BASE_URL);
	if (!res.ok) throw new Error(`Failed to fetch inventory (${res.status})`);
	return res.json();
}

// POST /api/inventory
// creates a new inventory row using the provided payload
export async function createInventoryItem(payload: InventoryCreate): Promise<void> {
	const res = await fetch(BASE_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});

	// try to include backend text in the error so it is easier to debug why it failed IF it fails
	if (!res.ok) {
		const txt = await res.text().catch(() => "");
		throw new Error(`Failed to create inventory item (${res.status}) ${txt}`);
	}
}

// PATCH /api/inventory/:itemID
// updates fields for an existing inventory row (partial update)
export async function updateInventoryItem(itemID: number, patch: InventoryPatch): Promise<void> {
	const res = await fetch(`${BASE_URL}/${itemID}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(patch),
	});

	if (!res.ok) {
		const txt = await res.text().catch(() => "");
		throw new Error(`Failed to update inventory item (${res.status}) ${txt}`);
	}
}