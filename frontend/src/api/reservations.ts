import { api } from "./client";
import type { AvailabilityQuery, AvailabilityResponse, ReasonKey } from "../types/reservation";

export type CreateReservationPayload = {
	reasonKey: ReasonKey;
	appointmentDate: string; // YYYY-MM-DD
	startTime: string;       // HH:mm
	userEmail?: string | null;
	vetID?: number | null;
	petID?: number | null;
};

export async function getAvailabilityByReason(
	query: AvailabilityQuery
): Promise<AvailabilityResponse> {
	const params = new URLSearchParams({
		reasonKey: query.reasonKey,
		startDate: query.startDate,
		endDate: query.endDate,
	});

	return api<AvailabilityResponse>(`/reservations/availability?${params.toString()}`);
}

export async function createReservation(
	payload: CreateReservationPayload
): Promise<{ message: string; reservationId?: string | number }> {
	return api<{ message: string; reservationId?: string | number }>("/reservations", {
		method: "POST",
		body: payload,
	});
}
