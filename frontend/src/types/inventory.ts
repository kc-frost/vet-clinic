// Inventory model aligned with backend/sql/VeterinaryDB.sql
// - Supports both consumables (stock-based) and non-consumables (capacity-based)

export interface InventoryItem {
	itemID: number;
	itemKey: string; // unique identifier used by backend scheduling rules
	displayName: string;
	itemType: string | null; // optional display grouping (e.g. CONSUMABLE / EQUIPMENT / MEDICINE)
	isConsumable: boolean;
	quantity: number; // stock count (consumable) OR capacity count (non-consumable)
	itemDescription: string | null;
	isActive?: boolean;
	deactivatedAt?: string | null;
}

export interface InventoryCreate {
	itemKey: string;
	displayName: string;
	// required by frontend UX even if DB allows NULL
	itemType: string;
	isConsumable: boolean;
	quantity: number;
	// required by frontend UX even if DB allows NULL
	itemDescription: string;
}

// patch should only allow what UI actually edits
export type InventoryPatch = Partial<Pick<InventoryItem, "quantity">>;
