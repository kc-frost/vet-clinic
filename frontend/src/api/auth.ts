import { api } from "./client";

export type LoginRequest = {
	email: string;
	password: string;
};

export type RegisterRequest = {
	email: string;
	password: string;
};

export type AuthResponse = {
	ok?: boolean;
	message?: string;
	//Add later if backend returns in future user/token/etc.
};

export function login(data: LoginRequest) {
	return api<AuthResponse>("/auth/login", {
		method: "POST",
		body: data,
	});
}

export function register(data: RegisterRequest) {
	return api<AuthResponse>("/auth/register", {
		method: "POST",
		body: data,
	});
}

export function logout() {
	return api<void>("/auth/logout", {
		method: "POST",
	});
}
