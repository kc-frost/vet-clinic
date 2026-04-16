import { api } from "./client";
import type {
	AvailabilityResponse,
	CreateReservationPayload,
	CreateReservationResponse,
	PetProfile,
	ReasonKey,
	UserProfile,
} from "../types/reservation";

// GET /api/reservations/availability
// builds a query string and returns available time slots for a given reasonKey
export async function getAvailability(params: {
	reasonKey: ReasonKey;
	userID: number;
	petID?: number | null;
	ignoreAppointmentID?: number | null;
	startDate?: string;
	days?: number;
}) {
	const q = new URLSearchParams();
	q.set("reasonKey", params.reasonKey);
	q.set("userID", String(params.userID));
	if (params.petID) q.set("petID", String(params.petID));
	if (params.ignoreAppointmentID) q.set("ignoreAppointmentID", String(params.ignoreAppointmentID));
	if (params.startDate) q.set("startDate", params.startDate);
	if (params.days) q.set("days", String(params.days));

	return api<AvailabilityResponse>(`/reservations/availability?${q.toString()}`, {
		method: "GET",
	});
}

// POST /api/reservations
// creates an appointment booking using the reservation payload
export async function createReservation(payload: CreateReservationPayload) {
	return api<CreateReservationResponse>("/reservations", {
		method: "POST",
		body: payload,
	});
}

// GET /api/reservations/profile?userID=
// returns customer profile fields used to autofill the reservation sections
export async function getReservationProfile(userID: number) {
	const q = new URLSearchParams();
	q.set("userID", String(userID));

	return api<UserProfile>(`/reservations/profile?${q.toString()}`, {
		method: "GET",
	});
}

// GET /api/reservations/pets?userID=
// returns the user's saved pets for the reservation section dropdown
export async function getPetsForUser(userID: number) {
	const q = new URLSearchParams();
	q.set("userID", String(userID));

	const resp = await api<{ userID: number; pets: PetProfile[] }>(`/reservations/pets?${q.toString()}`, {
		method: "GET",
	});

	return resp.pets;
}

// PATCH /api/reservations/pets/:petID?userID=
// updates one pet profile from the user profile page
export async function updatePetProfile(userID: number, petID: number, payload: Partial<PetProfile>) {
	const q = new URLSearchParams();
	q.set("userID", String(userID));

	return api<PetProfile>(`/reservations/pets/${petID}?${q.toString()}`, {
		method: "PATCH",
		body: payload,
	});
}