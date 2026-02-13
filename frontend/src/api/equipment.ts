import { api } from "./client";
import type { Equipment } from "../types/equipment";

export function getEquipment() {
  return api<Equipment[]>("/equipment");
}
