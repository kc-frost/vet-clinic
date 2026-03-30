import { api } from "./client";

export type NotificationItem = {
  notificationID: number;
  userID: number;
  appointmentID: number | null;
  type: string;
  title: string;
  message: string;
  channel: string;
  isRead: number;
  createdAt: string;
};

export function getNotifications() {
  return api<NotificationItem[]>("/notifications");
}

export function markNotificationRead(notificationID: number) {
  return api<{ ok: true }>(`/notifications/${notificationID}/read`, {
    method: "PATCH",
  });
}