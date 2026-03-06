import type { Room, RoomCreate } from "../types/rooms";

const BASE_URL = "/api/rooms";

// GET /api/rooms
// returns room rows as Room[]
export async function getRooms(): Promise<Room[]> {
	const res = await fetch(BASE_URL);
	if (!res.ok) throw new Error(`Failed to fetch rooms (${res.status})`);
	return res.json();
}

// POST /api/rooms
// creates a new room row using the provided payload
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