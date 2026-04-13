import type { Room, RoomCreate } from "../types/rooms";

const BASE_URL = "/api/rooms";

// Returns active rooms by default
// Pass includeInactive when the UI needs removed rooms too
export async function getRooms(options?: { includeInactive?: boolean }): Promise<Room[]> {
	const search = options?.includeInactive ? "?includeInactive=1" : "";
	const res = await fetch(`${BASE_URL}${search}`);
	if (!res.ok) throw new Error(`Failed to fetch rooms (${res.status})`);
	return res.json();
}

// Creates one new room row
export async function createRoom(payload: RoomCreate): Promise<void> {
	const res = await fetch(BASE_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});

	if (!res.ok) {
		const txt = await res.text().catch(() => "");
		throw new Error(`Failed to create room (${res.status}) ${txt}`);
	}
}

// Marks one room inactive
export async function deactivateRoom(roomNumber: number): Promise<void> {
	const res = await fetch(`${BASE_URL}/${roomNumber}/deactivate`, { method: "PATCH" });

	if (!res.ok) {
		const txt = await res.text().catch(() => "");
		throw new Error(`Failed to deactivate room (${res.status}) ${txt}`);
	}
}

// Brings one removed room back into the active list
export async function reactivateRoom(roomNumber: number): Promise<void> {
	const res = await fetch(`${BASE_URL}/${roomNumber}/reactivate`, { method: "PATCH" });

	if (!res.ok) {
		const txt = await res.text().catch(() => "");
		throw new Error(`Failed to reactivate room (${res.status}) ${txt}`);
	}
}
