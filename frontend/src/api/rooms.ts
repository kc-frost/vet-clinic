import { api } from "./client";
import type { Room } from "../types/rooms";

export function getRooms() {
  return api<Room[]>("/rooms");
}

export function createRoom(data: Omit<Room, "roomID">) {
  return api<Room>("/rooms", { method: "POST", body: data });
}

export function deleteRoom(roomID: number) {
  return api<void>(`/rooms/${roomID}`, { method: "DELETE" });
}

export function updateRoom(roomID: number, patch: Partial<Room>) {
  return api<Room>(`/rooms/${roomID}`, { method: "PATCH", body: patch });
}
