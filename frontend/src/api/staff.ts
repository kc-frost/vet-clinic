import { api } from "./client";
import type {
	MyStaffProfile,
	Staff,
	StaffAppointment,
	StaffAvailabilityRow,
	StaffCreate,
	StaffNotification,
	StaffUserCandidate,
} from "../types/staff";

export type { MyStaffProfile, StaffAvailabilityRow, StaffAppointment, StaffNotification } from "../types/staff";

/*
	Gets the full staff list

	The backend already joins and shapes the data
	So by the time it gets here each item already has:
	- staff info
	- linked customer/general user info
	- roleKeys
*/
export async function getStaff(): Promise<Staff[]> {
	return api<Staff[]>("/staff");
}

/*
	Creates a new staff profile by linking an existing user account

	Payload shape:
	- userID
	- staffNumber
	- positionTitle
	- roleKeys
*/
export async function createStaff(payload: StaffCreate): Promise<{ staffID: number; message: string }> {
	return api<{ staffID: number; message: string }>("/staff", {
		method: "POST",
		body: payload,
	});
}

export async function cancelMyStaffAppointment(
	appointmentID: number,
	payload: { cancellationReason: string }
  ): Promise<{ message: string; result: { appointmentID: number } }> {
	return api<{ message: string; result: { appointmentID: number } }>(
	  `/staff/me/appointments/${appointmentID}/cancel`,
	  {
		method: "POST",
		body: payload,
	  }
	);
  }

/*
	Gets the user accounts admin can look through before linking one
	to a staff profile

	This helps the UI know:
	- which userID to use
	- whether that account is already linked
	- some quick account info for display
*/
export async function getStaffUsers(): Promise<StaffUserCandidate[]> {
	return api<StaffUserCandidate[]>("/staff/users");
}

export async function getMyStaffProfile(): Promise<MyStaffProfile> {
	return api<MyStaffProfile>("/staff/me", {
		method: "GET",
	});
}

export async function getMyStaffAvailability(): Promise<StaffAvailabilityRow[]> {
	return api<StaffAvailabilityRow[]>("/staff/me/availability", {
		method: "GET",
	});
}

export async function saveMyStaffAvailability(availability: StaffAvailabilityRow[]): Promise<{ message: string }> {
	return api<{ message: string }>("/staff/me/availability", {
		method: "PUT",
		body: { availability },
	});
}

export async function getMyStaffAppointments(): Promise<StaffAppointment[]> {
	return api<StaffAppointment[]>("/staff/me/appointments", {
		method: "GET",
	});
}

export async function getMyStaffNotifications(): Promise<StaffNotification[]> {
	return api<StaffNotification[]>("/staff/me/notifications", {
		method: "GET",
	});
}

export async function markMyStaffNotificationRead(notificationID: number): Promise<{ ok: true; message: string }> {
	return api<{ ok: true; message: string }>(`/staff/me/notifications/${notificationID}/read`, {
		method: "PATCH",
	});
}