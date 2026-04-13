import { api } from "./client";
import type { UserType } from "../types/staff";

type UserRouteRow = {
	userID: number;
	email: string;
	legalFirstName: string | null;
	legalLastName: string | null;
	userType: UserType;
	createdAt: string;
	totalReservations: number;
	pastReservations: number;
	upcomingReservations: number;
};

export type UserSummary = {
	userID: number;
	email: string;
	legalFirstName: string | null;
	legalLastName: string | null;
	userType: UserType;
	days_registered: number;
	total_reservations: number;
	past_reservations: number;
	upcoming_reservations: number;
};

function daysSince(createdAt: string) {
	const createdMs = new Date(String(createdAt || "").replace(" ", "T")).getTime();
	if (!Number.isFinite(createdMs)) return 0;

	const diffMs = Date.now() - createdMs;
	if (diffMs <= 0) return 0;
	return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export async function getAllUsers() {
	const rows = await api<UserRouteRow[]>("/users", { method: "GET" });

	return rows.map((row) => ({
		userID: Number(row.userID),
		email: String(row.email || ""),
		legalFirstName: row.legalFirstName == null ? null : String(row.legalFirstName),
		legalLastName: row.legalLastName == null ? null : String(row.legalLastName),
		userType: row.userType,
		days_registered: daysSince(row.createdAt),
		total_reservations: Number(row.totalReservations || 0),
		past_reservations: Number(row.pastReservations || 0),
		upcoming_reservations: Number(row.upcomingReservations || 0),
	}));
}

export function deactivateUser(userID: number) {
	// Deactivation is the backend meaning even if the UI says remove or delete
	// Dedicated admin users route so account deactivation stays in one place
	return api<{ message: string; result: unknown }>(`/users/${userID}/deactivate`, {
		method: "PATCH",
	});
}
