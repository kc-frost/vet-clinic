import { useEffect, useMemo, useState } from "react";
import { getNotifications, markNotificationRead, type NotificationItem } from "../api/notifications";

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);

  async function loadNotifications() {
    try {
      const rows = await getNotifications();
      setItems(rows);
    } catch {
      setItems([]);
    }
  }

  useEffect(() => {
    loadNotifications();

    const timer = window.setInterval(() => {
      loadNotifications();
    }, 30000);

    return () => window.clearInterval(timer);
  }, []);

  const unreadCount = useMemo(
    () => items.filter((n) => Number(n.isRead) === 0).length,
    [items]
  );

  async function handleMarkRead(notificationID: number) {
    await markNotificationRead(notificationID);
    await loadNotifications();
  }

  return (
    <div style={{ position: "relative" }}>
      <button type="button" className="nav-btn" onClick={() => setOpen((v) => !v)}>
        Notifications {unreadCount > 0 ? `(${unreadCount})` : ""}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "110%",
            width: 340,
            background: "#fff",
            border: "1px solid #ddd",
            borderRadius: 8,
            padding: 12,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            zIndex: 2000,
            maxHeight: 420,
            overflowY: "auto",
          }}
        >
          {items.length === 0 ? (
            <p style={{ margin: 0 }}>No notifications.</p>
          ) : (
            items.map((item) => (
              <div
                key={item.notificationID}
                style={{
                  borderBottom: "1px solid #eee",
                  paddingBottom: 10,
                  marginBottom: 10,
                  opacity: Number(item.isRead) ? 0.7 : 1,
                }}
              >
                <strong>{item.title}</strong>
                <p style={{ margin: "6px 0" }}>{item.message}</p>
                {!Number(item.isRead) && (
                  <button type="button" onClick={() => handleMarkRead(item.notificationID)}>
                    Mark as read
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}