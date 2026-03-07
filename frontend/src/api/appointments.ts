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

// lets a normal logged in user cancel one of their own upcoming appointments
export function cancelMyAppointment(appointmentID: number) {
  return api<{ message: string }>(`/appointments/mine/${appointmentID}`, {
    method: "DELETE",
  });
}

// lets a normal logged in user reschedule one of their own upcoming appointments
// backend handles this as delete old appointment plus create new appointment
export function rescheduleMyAppointment(
  appointmentID: number,
  payload: { appointmentDate: string; startTime: string }
) {
  return api<{
    ok: boolean;
    appointmentId: number;
    reasonKey: string;
    date: string;
    durationMinutes: number;
    staffID: number;
    roomNumber: number;
    petID: number | null;
    message: string;
  }>(`/appointments/mine/${appointmentID}/reschedule`, {
    method: "POST",
    body: payload,
  });
}