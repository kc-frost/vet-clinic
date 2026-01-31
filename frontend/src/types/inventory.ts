export type InventoryType = "medicine" | "equipment";

export interface InventoryItem {
  itemID: number;
  inventoryType: InventoryType;

  displayName: string;
  quantity: number;

  itemDescription: string | null;

  // always a boolean in the app; backend should force false for medicine
  inUse: boolean;

  // FK fields (one is null depending on type)
  ndc: number | null;
  equipmentID: number | null;
}

// what the frontend sends on create
export interface InventoryCreate {
  inventoryType: InventoryType;

  // frontend can send it, but backend should recompute/override
  displayName?: string;

  quantity: number;
  itemDescription: string | null;

  // frontend sends it for both; backend forces false for medicine
  inUse: boolean;

  // always include these keys (null when not used)
  ndc: number | null;
  equipmentID: number | null;
}

// patch should only allow what UI actually edits
export type InventoryPatch = Partial<Pick<InventoryItem, "quantity" | "inUse" | "itemDescription">>;
