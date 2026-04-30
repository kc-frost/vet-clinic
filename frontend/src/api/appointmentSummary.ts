import { api } from "./client";
import type {
	AppointmentSummaryDraftPayload,
	FollowUpPrefillResponse,
	StaffAppointmentSummaryResponse,
} from "../types/appointmentSummary";

export async function getStaffAppointmentSummary(appointmentID: number): Promise<StaffAppointmentSummaryResponse> {
	return api<StaffAppointmentSummaryResponse>(`/appointment-summaries/staff/${appointmentID}`, {
		method: "GET",
	});
}

export async function saveStaffAppointmentSummary(appointmentID: number, payload: AppointmentSummaryDraftPayload): Promise<StaffAppointmentSummaryResponse> {
	return api<StaffAppointmentSummaryResponse>(`/appointment-summaries/staff/${appointmentID}`, {
		method: "PUT",
		body: payload,
	});
}

export async function finalizeStaffAppointmentSummary(appointmentID: number): Promise<StaffAppointmentSummaryResponse> {
	return api<StaffAppointmentSummaryResponse>(`/appointment-summaries/staff/${appointmentID}/finalize`, {
		method: "POST",
	});
}

export async function getFollowUpPrefill(appointmentID: number): Promise<FollowUpPrefillResponse> {
	return api<FollowUpPrefillResponse>(`/appointment-summaries/staff/${appointmentID}/follow-up-prefill`, {
		method: "GET",
	});
}