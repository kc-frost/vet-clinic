import { api } from "./client";
import type { Medicine } from "../types/medicine";

export function getMedicines() {
  return api<Medicine[]>("/medicine");
}
