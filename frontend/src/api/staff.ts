import { api } from "./client";
import type { Staff, StaffCreate, StaffUserCandidate } from "../types/staff";

/*
	Gets the full staff list.

	The backend already joins and shapes the data,
	so by the time it gets here each item already has:
	- staff info
	- linked customer/general user info
	- roleKeys
*/
export async function getStaff(): Promise<Staff[]> {
	return api<Staff[]>("/staff");
}

/*
	Creates a new staff profile by linking an existing user account.

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

/*
	Gets the user accounts admin can look through before linking one
	to a staff profile.

	This helps the UI know:
	- which userID to use
	- whether that account is already linked
	- some quick account info for display
*/
export async function getStaffUsers(): Promise<StaffUserCandidate[]> {
	return api<StaffUserCandidate[]>("/staff/users");
}