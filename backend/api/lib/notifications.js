import cron from "node-cron";
import { pool } from "../db.js";
import { sendEmail } from "./mailer.js";

function toSqlDateTimeString(value) {
	const dt = value instanceof Date ? value : new Date(value);

	const year = dt.getFullYear();
	const month = String(dt.getMonth() + 1).padStart(2, "0");
	const day = String(dt.getDate()).padStart(2, "0");
	const hours = String(dt.getHours()).padStart(2, "0");
	const minutes = String(dt.getMinutes()).padStart(2, "0");
	const seconds = String(dt.getSeconds()).padStart(2, "0");

	return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function toDisplayDateTime(value) {
	const dt = value instanceof Date ? value : new Date(value);

	return dt.toLocaleString("en-US", {
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

function formatReasonLabel(reasonKey) {
	return String(reasonKey || "").replaceAll("_", " ");
}

function buildWindow(hoursAhead, windowMinutes) {
	const now = new Date();
	const start = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);
	const end = new Date(start.getTime() + windowMinutes * 60 * 1000);

	return {
		startSql: toSqlDateTimeString(start),
		endSql: toSqlDateTimeString(end),
	};
}

export async function createInAppNotification({
	userID,
	appointmentID,
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
			AND appointmentID = ?
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
		 WHERE appointmentID = ?
			AND type = ?
			AND recipientEmail = ?
		 LIMIT 1`,
		[appointmentID, type, recipientEmail]
	);

	return rows.length > 0;
}

async function logEmail({ userID, appointmentID, type, recipientEmail }) {
	await pool.execute(
		`INSERT INTO email_log (userID, appointmentID, type, recipientEmail)
		 VALUES (?, ?, ?, ?)`,
		[userID, appointmentID, type, recipientEmail]
	);
}

async function createStaffOneHourReminders() {
	const window = buildWindow(1, 1);

	const [rows] = await pool.execute(
		`SELECT
			aps.appointmentID,
			aps.staffID,
			aps.assignedRoleKey,
			a.reasonKey,
			a.date,
			a.roomNumber,
			s.userID AS staffUserID,
			p.petName,
			owner.legalFirstName AS ownerFirstName,
			owner.legalLastName AS ownerLastName
		 FROM appointment_staff aps
		 INNER JOIN appointment a
			ON a.appointmentID = aps.appointmentID
		 INNER JOIN staff s
			ON s.staffID = aps.staffID
		 LEFT JOIN pet p
			ON p.petID = a.petID
		 INNER JOIN customer owner
			ON owner.userID = a.userID
		 WHERE a.date >= ?
			AND a.date < ?`,
		[window.startSql, window.endSql]
	);

	for (const row of rows) {
		const exists = await inAppNotificationExists({
			userID: row.staffUserID,
			appointmentID: row.appointmentID,
			type: "STAFF_1_HOUR_REMINDER",
		});

		if (exists) {
			continue;
		}

		const scheduledText = toDisplayDateTime(row.date);
		const reasonLabel = formatReasonLabel(row.reasonKey);
		const ownerName = [row.ownerFirstName, row.ownerLastName].filter(Boolean).join(" ").trim() || "Unknown Owner";
		const petName = row.petName || "Unknown Pet";
		const roomText = row.roomNumber ? `Room ${row.roomNumber}` : "No Room";
		const roleText = row.assignedRoleKey || "Unspecified Role";

		const title = "Upcoming appointment";
		const message = `Upcoming appointment in about 1 hour. Service: ${reasonLabel}. Pet: ${petName}. Owner: ${ownerName}. Room: ${roomText}. Your role: ${roleText}. Time: ${scheduledText}`;

		await createInAppNotification({
			userID: row.staffUserID,
			appointmentID: row.appointmentID,
			type: "STAFF_1_HOUR_REMINDER",
			title,
			message,
		});
	}
}

async function sendCustomer24HourEmails() {
	const window = buildWindow(24, 60);

	const [rows] = await pool.execute(
		`SELECT
			a.appointmentID,
			a.userID,
			a.reasonKey,
			a.date,
			c.email,
			c.legalFirstName,
			p.petName
		 FROM appointment a
		 INNER JOIN customer c
			ON c.userID = a.userID
		 LEFT JOIN pet p
			ON p.petID = a.petID
		 WHERE a.date >= ?
			AND a.date < ?
			AND c.email IS NOT NULL
			AND c.email <> ''`,
		[window.startSql, window.endSql]
	);

	for (const row of rows) {
		const alreadySent = await emailAlreadySent({
			appointmentID: row.appointmentID,
			type: "CUSTOMER_24_HOUR_REMINDER_EMAIL",
			recipientEmail: row.email,
		});

		if (alreadySent) {
			continue;
		}

		const scheduledText = toSqlDateTimeString(row.date);
		const helloName = row.legalFirstName ? ` ${row.legalFirstName}` : "";
		const petText = row.petName ? ` for ${row.petName}` : "";

		await sendEmail({
			to: row.email,
			subject: "Appointment reminder",
			text: `Hello${helloName}, this is a reminder that your ${row.reasonKey} appointment${petText} is scheduled for ${scheduledText}.`,
		});

		await logEmail({
			userID: row.userID,
			appointmentID: row.appointmentID,
			type: "CUSTOMER_24_HOUR_REMINDER_EMAIL",
			recipientEmail: row.email,
		});
	}
}

let schedulerStarted = false;

export function startNotificationScheduler() {
	if (schedulerStarted) {
		return;
	}

	schedulerStarted = true;

	cron.schedule("* * * * *", async () => {
		try {
			await createStaffOneHourReminders();
			await sendCustomer24HourEmails();
		} catch (err) {
			console.error("notification scheduler error:", err);
		}
	});
}