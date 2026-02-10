import { api } from "./client";
import type { Room, RoomCreate } from "../types/rooms";

export function getRooms() {
  return api<Room[]>("/rooms");
}

export function createRoom(data: RoomCreate) {
  return api<Room>("/rooms", { method: "POST", body: data });
}

export function deleteRoom(roomNumber: number) {
  return api<void>(`/rooms/${roomNumber}`, { method: "DELETE" });
}
