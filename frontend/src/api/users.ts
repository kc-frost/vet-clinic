import { api } from "./client";

type UsersRouteRow = {
	userID: number;
	username: string | null;
	email: string;
	legalFirstName: string | null;
	legalLastName: string | null;
	userType: "CUSTOMER" | "STAFF" | "ADMIN";
	createdAt: string;
	linkedStaffID: number | null;
	alreadyLinkedToStaff: number | boolean;
	totalReservations: number;
	pastReservations: number;
	upcomingReservations: number;
};

export type UserSummary = {
	userID: number;
	username: string | null;
	email: string;
	legalFirstName: string | null;
	legalLastName: string | null;
	userType: "CUSTOMER" | "STAFF" | "ADMIN";
	days_registered: number;
	total_reservations: number;
	past_reservations: number;
	upcoming_reservations: number;
	linkedStaffID: number | null;
	alreadyLinkedToStaff: boolean;
};

function daysSince(createdAt: string) {
	const createdMs = new Date(String(createdAt || "").replace(" ", "T")).getTime();
	if (!Number.isFinite(createdMs)) return 0;

	const diffMs = Date.now() - createdMs;
	if (diffMs <= 0) return 0;
	return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export async function getAllUsers() {
	// Use the dedicated admin users route so this page is not piggybacking on staff routes
	const rows = await api<UsersRouteRow[]>("/users", { method: "GET" });

	return rows.map((row) => ({
		userID: Number(row.userID),
		username: row.username ? String(row.username) : null,
		email: String(row.email || ""),
		legalFirstName: row.legalFirstName ? String(row.legalFirstName) : null,
		legalLastName: row.legalLastName ? String(row.legalLastName) : null,
		userType: row.userType,
		days_registered: daysSince(row.createdAt),
		total_reservations: Number(row.totalReservations || 0),
		past_reservations: Number(row.pastReservations || 0),
		upcoming_reservations: Number(row.upcomingReservations || 0),
		linkedStaffID: row.linkedStaffID === null || row.linkedStaffID === undefined ? null : Number(row.linkedStaffID),
		alreadyLinkedToStaff: Boolean(row.alreadyLinkedToStaff),
	}));
}

export function deactivateUser(userID: number) {
	// Deactivation is the backend meaning even if the UI says remove or delete
	return api<{ message: string; result: unknown }>(`/users/${userID}/deactivate`, {
		method: "PATCH",
	});
}
