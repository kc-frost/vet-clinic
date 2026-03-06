import { api } from "./client";

export type UserSummary = {
  userID: number;
  email: string;
  days_registered: number;
  total_reservations: number;
  past_reservations: number;
  upcoming_reservations: number;
};

export async function getAllUsers() {
  return api<UserSummary[]>("/staff/users", {
    method: "GET",
  });
}