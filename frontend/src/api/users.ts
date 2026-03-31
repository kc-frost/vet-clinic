import { api } from "./client";

type StaffUsersRouteRow = {
	userID: number;
	email: string;
	createdAt: string;
	totalReservations: number;
	pastReservations: number;
	upcomingReservations: number;
};

export type UserSummary = {
	userID: number;
	email: string;
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
	const rows = await api<StaffUsersRouteRow[]>("/staff/users", {
		method: "GET",
	});

	return rows.map((row) => ({
		userID: Number(row.userID),
		email: String(row.email || ""),
		days_registered: daysSince(row.createdAt),
		total_reservations: Number(row.totalReservations || 0),
		past_reservations: Number(row.pastReservations || 0),
		upcoming_reservations: Number(row.upcomingReservations || 0),
	}));
}
