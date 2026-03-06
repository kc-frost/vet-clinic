import { api } from "./client";
import type { Appointment } from "../types/appointment";

// gets the admin list of all appointments
// this is for the staff appointments page
export function getAppointments() {
  return api<Appointment[]>("/appointments");
}

// gets only the logged in user's appointments
// this is for the user profile page
export function getMyAppointments() {
  return api<Appointment[]>("/appointments/mine");
}

// deletes one appointment by id
// backend only allows admins to do this
export function deleteAppointment(appointmentID: number) {
  return api<void>(`/appointments/${appointmentID}`, { method: "DELETE" });
}