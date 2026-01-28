import { api } from "./client";
import type { Resource } from "../types/resources";

export function getResources() {
  return api<Resource[]>("/resources");
}

export function createResource(data: Omit<Resource, "resourceID">) {
  return api<Resource>("/resources", { method: "POST", body: data });
}

export function deleteResource(resourceID: number) {
  return api<void>(`/resources/${resourceID}`, { method: "DELETE" });
}

export function updateResource(resourceID: number, patch: Partial<Resource>) {
  return api<Resource>(`/resources/${resourceID}`, { method: "PATCH", body: patch });
}
