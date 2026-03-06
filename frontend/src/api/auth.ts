import { api } from "./client";

// shape returned by /api/auth/me (and also embedded in login/register responses)
export type AuthUser = {
	userID: number;
	email: string;
	isAdmin: boolean;
};

// POST /api/auth/login response shape
// message is a short status string like "logged in"
// user contains the session user fields the frontend cares about
export type LoginResponse = {
	message: string;
	user: AuthUser;
};

// POST /api/auth/register response shape
// message is a short status string like "registered"
// user contains the new user fields and is also used to seed the session
export type RegisterResponse = {
	message: string;
	user: AuthUser;
};

// POST /api/auth/register
// sends credentials to the backend and expects a RegisterResponse back
// adminCode is optional and is only used if the backend has ADMIN_CODE configured
export async function register(email: string, password: string, adminCode?: string) {
	return api<RegisterResponse>("/auth/register", {
		method: "POST",
		body: { email, password, adminCode },
	});
}

// POST /api/auth/login
// sends credentials to the backend and expects a LoginResponse back
// backend will attach session cookies if express-session is enabled
export async function login(email: string, password: string) {
	return api<LoginResponse>("/auth/login", {
		method: "POST",
		body: { email, password },
	});
}

// POST /api/auth/logout
// backend destroys/ rids of the session so /api/auth/me returns 401 afterward
export async function logout() {
	return api<{ message: string }>("/auth/logout", { method: "POST" });
}

// GET /api/auth/me
// used on page load to detect if the browser currently has a valid session
// if the user is not logged in, the backend returns 401 and api() should throw
export async function getCurrentUser() {
	return api<AuthUser>("/auth/me", {
		method: "GET",
	});
}