import { api } from "./client";

/*
	This is the authenticated user shape returned by the backend.

	It includes the core identity fields plus convenient booleans
	the frontend can use for role-based rendering checks.
*/
export type AuthUser = {
	userID: number;
	email: string;
	userType: "CUSTOMER" | "STAFF" | "ADMIN" | string;
	isAdmin: boolean;
	isStaff: boolean;
};

/*
	Response shape returned by the login route.
	The backend sends a status message plus the authenticated user.
*/
export type LoginResponse = {
	message: string;
	user: AuthUser;
};

/*
	Response shape returned by the register route.
	The backend sends a status message plus the newly authenticated user.
*/
export type RegisterResponse = {
	message: string;
	user: AuthUser;
};

export async function register(email: string, password: string, adminCode?: string) {
	/*
		Send the registration request to the backend.

		adminCode is optional because most users register as normal
		customer accounts, while only special cases should become admin.
	*/
	return api<RegisterResponse>("/auth/register", {
		method: "POST",
		body: { email, password, adminCode },
	});
}

export async function login(email: string, password: string) {
	/*
		Send login credentials to the backend and return the
		authenticated user payload on success.
	*/
	return api<LoginResponse>("/auth/login", {
		method: "POST",
		body: { email, password },
	});
}

export async function logout() {
	/*
		Tell the backend to destroy the current session so this user
		is no longer considered logged in on later requests.
	*/
	return api<{ message: string }>("/auth/logout", { method: "POST" });
}

export async function getCurrentUser() {
	/*
		Ask the backend who is currently logged in based on the
		existing session cookie.
	*/
	return api<AuthUser>("/auth/me", {
		method: "GET",
	});
}