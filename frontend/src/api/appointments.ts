import {api} from "./client";
import type {Appointment} from "../types/appointment";

export function getAppointments() {
    return api<Appointment[]>("/appointments");
}

export function deleteAppointment(appointmentID: number) {
    return api<void>(`/appointments/${appointmentID}`, { method: "DELETE" });
}