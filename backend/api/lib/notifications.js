import cron from "node-cron";
import { pool } from "../db.js";
import { sendEmail } from "./mailer.js";

export async function createInAppNotification({
  userID,
  appointmentID = null,
  type,
  title,
  message,
}) {
  await pool.execute(
    `INSERT INTO notification
      (userID, appointmentID, type, title, message, channel, isRead)
     VALUES (?, ?, ?, ?, ?, 'IN_APP', 0)`,
    [userID, appointmentID, type, title, message]
  );
}

async function inAppNotificationExists({ userID, appointmentID, type }) {
  const [rows] = await pool.execute(
    `SELECT notificationID
     FROM notification
     WHERE userID = ?
       AND appointmentID <=> ?
       AND type = ?
       AND channel = 'IN_APP'
     LIMIT 1`,
    [userID, appointmentID, type]
  );
  return rows.length > 0;
}

async function emailAlreadySent({ appointmentID, type, recipientEmail }) {
  const [rows] = await pool.execute(
    `SELECT emailLogID
     FROM email_log
     WHERE appointmentID <=> ?
       AND type = ?
       AND recipientEmail = ?
     LIMIT 1`,
    [appointmentID, type, recipientEmail]
  );
  return rows.length > 0;
}

async function logEmail({ userID = null, appointmentID = null, type, recipientEmail }) {
  await pool.execute(
    `INSERT INTO email_log (userID, appointmentID, type, recipientEmail)
     VALUES (?, ?, ?, ?)`,
    [userID, appointmentID, type, recipientEmail]
  );
}

export async function notifyStaffReservationCreated({
  staffUserID,
  staffEmail,
  appointmentID,
  reasonKey,
  startSql,
}) {
  if (staffUserID) {
    const exists = await inAppNotificationExists({
      userID: staffUserID,
      appointmentID,
      type: "STAFF_NEW_RESERVATION",
    });

    if (!exists) {
      await createInAppNotification({
        userID: staffUserID,
        appointmentID,
        type: "STAFF_NEW_RESERVATION",
        title: "New reservation assigned",
        message: `A new ${reasonKey} appointment was assigned to you for ${startSql}.`,
      });
    }
  }

  if (staffEmail) {
    const alreadySent = await emailAlreadySent({
      appointmentID,
      type: "STAFF_NEW_RESERVATION_EMAIL",
      recipientEmail: staffEmail,
    });

    if (!alreadySent) {
      await sendEmail({
        to: staffEmail,
        subject: "New reservation assigned",
        text: `A new ${reasonKey} appointment was assigned to you for ${startSql}.`,
      });

      await logEmail({
        userID: staffUserID || null,
        appointmentID,
        type: "STAFF_NEW_RESERVATION_EMAIL",
        recipientEmail: staffEmail,
      });
    }
  }
}

export function startNotificationScheduler() {
  cron.schedule("* * * * *", async () => {
    try {
      // 10-minute in-app reminders
      const [soonRows] = await pool.execute(
        `SELECT
           a.appointmentID,
           a.userID,
           a.reasonKey,
           a.date,
           c.email
         FROM appointment a
         INNER JOIN customer c ON c.userID = a.userID
         WHERE a.date >= NOW() + INTERVAL 10 MINUTE
           AND a.date < NOW() + INTERVAL 11 MINUTE`
      );

      for (const row of soonRows) {
        const exists = await inAppNotificationExists({
          userID: row.userID,
          appointmentID: row.appointmentID,
          type: "USER_10_MIN_REMINDER",
        });

        if (!exists) {
          await createInAppNotification({
            userID: row.userID,
            appointmentID: row.appointmentID,
            type: "USER_10_MIN_REMINDER",
            title: "Appointment starting soon",
            message: `Your ${row.reasonKey} appointment starts in 10 minutes.`,
          });
        }
      }

      // 24-hour email reminders
      const [dayRows] = await pool.execute(
        `SELECT
           a.appointmentID,
           a.userID,
           a.reasonKey,
           a.date,
           c.email
         FROM appointment a
         INNER JOIN customer c ON c.userID = a.userID
         WHERE a.date >= NOW() + INTERVAL 24 HOUR
           AND a.date < NOW() + INTERVAL 25 HOUR
           AND c.email IS NOT NULL
           AND c.email <> ''`
      );

      for (const row of dayRows) {
        const alreadySent = await emailAlreadySent({
          appointmentID: row.appointmentID,
          type: "USER_24_HOUR_REMINDER_EMAIL",
          recipientEmail: row.email,
        });

        if (!alreadySent) {
          await sendEmail({
            to: row.email,
            subject: "Appointment reminder",
            text: `Reminder: your ${row.reasonKey} appointment is scheduled for ${row.date}.`,
          });

          await logEmail({
            userID: row.userID,
            appointmentID: row.appointmentID,
            type: "USER_24_HOUR_REMINDER_EMAIL",
            recipientEmail: row.email,
          });
        }
      }
    } catch (err) {
      console.error("notification scheduler error:", err);
    }
  });
}