import { api } from "./client";
import type {
	AvailabilityQuery,
	AvailabilityResponse,
	ReservationFormData,
} from "../types/reservation";

type CreateReservationPayload = Omit<ReservationFormData, "consentToFormInfo">;

/**
 * Fetch availability filtered by reason and date range.
 */
export async function getAvailabilityByReason(
	query: AvailabilityQuery
): Promise<AvailabilityResponse> {
	const params = new URLSearchParams({
		reasonKey: query.reasonKey,
		startDate: query.startDate,
		endDate: query.endDate,
	});

	return api<AvailabilityResponse>(
		`/reservations/availability?${params.toString()}`
	);
}

/**
 * Submit final reservation payload.
 */
export async function createReservation(
	payload: CreateReservationPayload
): Promise<{ message: string; reservationId?: string }> {
	return api<{ message: string; reservationId?: string }>("/reservations", {
		method: "POST",
		body: payload,
	});
}
