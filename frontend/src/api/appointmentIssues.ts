import { api } from "./client";
import type { UnderReviewAppointment, UnderReviewRescheduleOptionsResponse } from "../types/appointmentIssue";

export function getUnderReviewAppointments() {
	// Load the full admin issue queue
	return api<UnderReviewAppointment[]>("/appointment-issues");
}

export function getUnderReviewAppointment(appointmentID: number) {
	// Load one under-review appointment for any follow up action panel
	return api<UnderReviewAppointment>(`/appointment-issues/${appointmentID}`);
}

export function getUnderReviewRescheduleOptions(appointmentID: number, params?: { startDate?: string; days?: number }) {
	// Load calendar slots for one under-review appointment
	const searchParams = new URLSearchParams();

	if (params?.startDate) searchParams.set("startDate", params.startDate);
	if (params?.days) searchParams.set("days", String(params.days));

	const queryText = searchParams.toString();
	const suffix = queryText ? `?${queryText}` : "";
	return api<UnderReviewRescheduleOptionsResponse>(`/appointment-issues/${appointmentID}/reschedule-options${suffix}`);
}

export function rescheduleUnderReviewAppointment(appointmentID: number, payload: { appointmentDate: string; startTime: string; slotId?: string }) {
	// Patch the same under-review appointment to the chosen slot
	return api<{
		message: string;
		result: { appointmentID: number; startAt: string; endAt: string; roomNumber: number | null };
	}>(`/appointment-issues/${appointmentID}/reschedule`, {
		method: "POST",
		body: payload,
	});
}

export function cancelUnderReviewAppointment(appointmentID: number, payload: { cancellationReason: string }) {
	// Issue page cancel still uses normal admin cancellation metadata
	return api<{ message: string; result: { appointmentID: number } }>(`/appointment-issues/${appointmentID}/cancel`, {
		method: "POST",
		body: payload,
	});
}
