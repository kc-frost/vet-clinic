import { api } from "./client";
import type { InventoryItem, InventoryCreate, InventoryPatch } from "../types/inventory";

export function getInventory() {
  return api<InventoryItem[]>("/inventory");
}

export function createInventoryItem(data: InventoryCreate) {
  return api<InventoryItem>("/inventory", { method: "POST", body: data });
}

export function deleteInventoryItem(itemID: number) {
  return api<void>(`/inventory/${itemID}`, { method: "DELETE" });
}

export function updateInventoryItem(itemID: number, patch: InventoryPatch) {
  return api<InventoryItem>(`/inventory/${itemID}`, { method: "PATCH", body: patch });
}
