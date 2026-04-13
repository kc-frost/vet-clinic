import { api } from "./client";

export type AppointmentIssueRow = {
  appointmentID: number;
  issueType?: string;
  issueMessage?: string;
  underReview?: boolean;
};

export function getAppointmentIssues() {
  return api<AppointmentIssueRow[]>("/appointment-issues");
}

export function getAppointmentIssueRescheduleOptions(appointmentID: number) {
  return api(`/appointment-issues/${appointmentID}/options`);
}

export function resolveAppointmentIssueByReschedule(
  appointmentID: number,
  payload: {
    date: string;
    roomNumber?: number | null;
    staffIDs?: number[];
  }
) {
  return api(`/appointment-issues/${appointmentID}/reschedule`, {
    method: "PATCH",
    body: payload,
  });
}

export function cancelIssueAppointment(
  appointmentID: number,
  payload: { cancellationReason: string }
) {
  return api<{ message: string; result: { appointmentID: number } }>(
    `/appointment-issues/${appointmentID}/cancel`,
    {
      method: "POST",
      body: payload,
    }
  );
}