import { api } from "./client";
import type { UnderReviewAppointment } from "../types/appointmentIssue";

export function getUnderReviewAppointments() {
	// Load the full admin issue queue
	return api<UnderReviewAppointment[]>("/appointment-issues");
}

export function getUnderReviewAppointment(appointmentID: number) {
	// Load one under-review appointment for any follow up action panel
	return api<UnderReviewAppointment>(`/appointment-issues/${appointmentID}`);
}

export function cancelUnderReviewAppointment(appointmentID: number, payload: { cancellationReason: string }) {
	// Issue page cancel still uses normal admin cancellation metadata
	return api<{ message: string; result: { appointmentID: number } }>(`/appointment-issues/${appointmentID}/cancel`, {
		method: "POST",
		body: payload,
	});
}
