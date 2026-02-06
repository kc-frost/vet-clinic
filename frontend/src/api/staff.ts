import { api } from "./client";
import type { Staff } from "../types/staff";

export function getStaff() {
  return api<Staff[]>("/staff");
}

export function createStaff(data: Omit<Staff, "staffID">) {
  return api<Staff>("/staff", { method: "POST", body: data });
}

export function deleteStaff(staffID: number) {
  return api<void>(`/staff/${staffID}`, { method: "DELETE" });
}
