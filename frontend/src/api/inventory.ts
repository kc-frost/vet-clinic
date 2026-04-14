import type { InventoryCreate, InventoryItem, InventoryPatch } from "../types/inventory";

const BASE_URL = "/api/inventory";

// Returns active inventory by default
// Pass includeInactive when the UI needs removed items too
export async function getInventory(options?: { includeInactive?: boolean }): Promise<InventoryItem[]> {
	const search = options?.includeInactive ? "?includeInactive=1" : "";
	const res = await fetch(`${BASE_URL}${search}`);
	if (!res.ok) throw new Error(`Failed to fetch inventory (${res.status})`);
	const rows = await res.json();
	return rows.map((item: any) => ({
		itemID: Number(item.itemID),
		itemKey: String(item.itemKey || ""),
		displayName: String(item.displayName || ""),
		itemType: item.itemType ?? null,
		isConsumable: Number(item.isConsumable ?? 0) === 1,
		quantity: Number(item.quantity || 0),
		itemDescription: item.itemDescription ?? null,
		isActive: Number(item.isActive ?? 1) === 1,
		deactivatedAt: item.deactivatedAt ?? null,
	}));
}

// Creates a new inventory row
export async function createInventoryItem(payload: InventoryCreate): Promise<void> {
	const res = await fetch(BASE_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});

	if (!res.ok) {
		const txt = await res.text().catch(() => "");
		throw new Error(`Failed to create inventory item (${res.status}) ${txt}`);
	}
}

// Updates the editable fields for one inventory row
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

// Marks one inventory row inactive
export async function deactivateInventoryItem(itemID: number): Promise<void> {
	const res = await fetch(`${BASE_URL}/${itemID}/deactivate`, { method: "PATCH" });

	if (!res.ok) {
		const txt = await res.text().catch(() => "");
		throw new Error(`Failed to deactivate inventory item (${res.status}) ${txt}`);
	}
}

// Brings one removed inventory row back with quantity zero
export async function reactivateInventoryItem(itemID: number): Promise<void> {
	const res = await fetch(`${BASE_URL}/${itemID}/reactivate`, { method: "PATCH" });

	if (!res.ok) {
		const txt = await res.text().catch(() => "");
		throw new Error(`Failed to reactivate inventory item (${res.status}) ${txt}`);
	}
}
