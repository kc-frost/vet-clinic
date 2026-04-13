import { api } from "./client";
import type { Appointment } from "../types/appointment";

export function getAppointments(options?: { includeCanceled?: boolean }) {
	// Only add the query param when canceled appointments should be included too
	const includeCanceled = options?.includeCanceled ? "?includeCanceled=1" : "";
	return api<Appointment[]>(`/appointments${includeCanceled}`);
}

export function getMyAppointments() {
	// Load only the appointments for the currently logged-in user
	return api<Appointment[]>("/appointments/mine");
}

export function cancelAppointmentAsAdmin(appointmentID: number, payload: { cancellationReason: string }) {
	// Admin-side cancel path that sends the required cancellation reason to the backend
	return api<{ message: string; result: { appointmentID: number } }>(`/appointments/${appointmentID}/cancel`, {
		method: "POST",
		body: payload,
	});
}

export function cancelMyAppointment(appointmentID: number) {
	// Customer-side cancel path for the logged-in user's own appointment
	return api<{ message: string }>(`/appointments/mine/${appointmentID}`, {
		method: "DELETE",
	});
}

export function rescheduleMyAppointment(appointmentID: number, payload: { appointmentDate: string; startTime: string }) {
	// Send the new date and start time for this user's appointment
	// The backend responds with the rebuilt appointment assignment details after rescheduling
	return api<{
		ok: boolean;
		appointmentId: number;
		reasonKey: string;
		date: string;
		durationMinutes: number;
		assignedStaff: { staffID: number; assignedRoleKey: string }[];
		roomNumber: number;
		petID: number | null;
		message: string;
	}>(`/appointments/mine/${appointmentID}/reschedule`, {
		method: "POST",
		body: payload,
	});
}