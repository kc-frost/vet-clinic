import type { Staff, StaffCreate } from "../types/staff";

const BASE_URL = "/api/staff";

// GET /api/staff
// returns staff rows as Staff[]
export async function getStaff(): Promise<Staff[]> {
	const res = await fetch(BASE_URL);
	if (!res.ok) throw new Error(`Failed to fetch staff (${res.status})`);
	return res.json();
}

// POST /api/staff
// creates a new staff row using the provided payload
export async function createStaff(payload: StaffCreate): Promise<void> {
	const res = await fetch(BASE_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});

	if (!res.ok) {
		const txt = await res.text().catch(() => "");
		throw new Error(`Failed to create staff (${res.status}) ${txt}`);
	}
}