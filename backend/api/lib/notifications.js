import cron from "node-cron";
import { pool } from "../db.js";
import { sendEmail } from "./mailer.js";

function toSqlDateTimeString(value) {
	/* Convert a Date-like value into MySQL DATETIME text. */
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
	/* Format a Date-like value into readable text for notifications. */
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
	/* Turn a reason key like WELLNESS_EXAM into display text. */
	return String(reasonKey || "").replaceAll("_", " ");
}

function getHoursUntil(dateValue) {
	/*
		Return the fractional number of hours from now until the
		appointment time. A positive value means it is still upcoming.
	*/
	const appointmentDate = dateValue instanceof Date ? dateValue : new Date(dateValue);
	return (appointmentDate.getTime() - Date.now()) / (60 * 60 * 1000);
}

async function loadAppointmentNotificationContext(appointmentID) {
	/*
		Load the shared appointment data needed for both customer
		email reminders and staff in app reminders.
	*/
	const [appointmentRows] = await pool.execute(
		`SELECT
			a.appointmentID,
			a.userID,
			a.reasonKey,
			a.date,
			a.roomNumber,
			c.email,
			c.legalFirstName,
			c.legalLastName,
			p.petName
		 FROM appointment a
		 INNER JOIN customer c
			on c.userID = a.userID
		 LEFT JOIN pet p
			on p.petID = a.petID
		 WHERE a.appointmentID = ?
		 LIMIT 1`,
		[appointmentID]
	);

	if (!appointmentRows.length) {
		return null;
	}

	const appointment = appointmentRows[0];

	const [staffRows] = await pool.execute(
		`SELECT
			aps.staffID,
			aps.assignedRoleKey,
			s.userID AS staffUserID
		 FROM appointment_staff aps
		 INNER JOIN staff s
			on s.staffID = aps.staffID
		 WHERE aps.appointmentID = ?`,
		[appointmentID]
	);

	return {
		appointment,
		staffRows,
	};
}

function buildWindow(hoursAhead, windowMinutes) {
	/*
		Build the future time window the scheduler searches.

		start is the target offset from now.
		end is the end of that reminder window.
	*/
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
	/* Insert one unread in app notification for a user. */
	await pool.execute(
		`INSERT INTO notification
			(userID, appointmentID, type, title, message, channel, isRead)
		 VALUES (?, ?, ?, ?, ?, 'IN_APP', 0)`,
		[userID, appointmentID, type, title, message]
	);
}

async function inAppNotificationExists({ userID, appointmentID, type }) {
	/*
		Check whether this exact in app notification already exists
		so the scheduler does not create duplicates.
	*/
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
	/*
		Check the email log first so the same reminder email is not
		sent more than once to the same recipient.
	*/
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
	/* Record that an email reminder was sent. */
	await pool.execute(
		`INSERT INTO email_log (userID, appointmentID, type, recipientEmail)
		 VALUES (?, ?, ?, ?)`,
		[userID, appointmentID, type, recipientEmail]
	);
}

async function createStaffOneHourReminders() {
	/*
		Find appointments starting about one hour from now and create
		in app reminders for assigned staff members.
	*/
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
		/* Skip rows that already have this reminder. */
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
	/*
		Find appointments about 24 hours ahead and send customer
		reminder emails if one has not already been sent.
	*/
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
		/*
			Skip emails that were already sent for this appointment,
			email type, and recipient.
		*/
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

async function createImmediateStaffSoonReminders(appointmentContext) {
	/*
		If a newly created appointment is already within the next hour,
		create the in app reminder immediately instead of waiting for the
		scheduler's normal 1 hour reminder window.
	*/
	const appointment = appointmentContext?.appointment;
	const staffRows = appointmentContext?.staffRows || [];

	if (!appointment || !staffRows.length) {
		return;
	}

	const hoursUntilAppointment = getHoursUntil(appointment.date);
	if (hoursUntilAppointment <= 0 || hoursUntilAppointment > 1) {
		return;
	}

	const scheduledText = toDisplayDateTime(appointment.date);
	const reasonLabel = formatReasonLabel(appointment.reasonKey);
	const ownerName = [appointment.legalFirstName, appointment.legalLastName].filter(Boolean).join(" ").trim() || "Unknown Owner";
	const petName = appointment.petName || "Unknown Pet";
	const roomText = appointment.roomNumber ? `Room ${appointment.roomNumber}` : "No Room";

	for (const row of staffRows) {
		const exists = await inAppNotificationExists({
			userID: row.staffUserID,
			appointmentID: appointment.appointmentID,
			type: "STAFF_SOON_AFTER_BOOKING",
		});

		if (exists) {
			continue;
		}

		const roleText = row.assignedRoleKey || "Unspecified Role";
		const title = "Upcoming appointment soon";
		const message = `A newly scheduled appointment assigned to you is coming up soon. Service: ${reasonLabel}. Pet: ${petName}. Owner: ${ownerName}. Room: ${roomText}. Your role: ${roleText}. Time: ${scheduledText}`;

		await createInAppNotification({
			userID: row.staffUserID,
			appointmentID: appointment.appointmentID,
			type: "STAFF_SOON_AFTER_BOOKING",
			title,
			message,
		});
	}
}

async function sendImmediateCustomerSoonEmail(appointmentContext) {
	/*
		If a newly created appointment is already within the next 24 hours,
		send the customer an immediate "coming up soon" email instead of
		making them wait for the normal 24 hour scheduler reminder.
	*/
	const appointment = appointmentContext?.appointment;
	if (!appointment) {
		return;
	}

	const hoursUntilAppointment = getHoursUntil(appointment.date);
	if (hoursUntilAppointment <= 0 || hoursUntilAppointment > 24) {
		return;
	}

	const recipientEmail = String(appointment.email || "").trim();
	if (!recipientEmail) {
		return;
	}

	const alreadySent = await emailAlreadySent({
		appointmentID: appointment.appointmentID,
		type: "CUSTOMER_SOON_AFTER_BOOKING_EMAIL",
		recipientEmail,
	});

	if (alreadySent) {
		return;
	}

	const helloName = appointment.legalFirstName ? ` ${appointment.legalFirstName}` : "";
	const reasonLabel = formatReasonLabel(appointment.reasonKey);
	const petText = appointment.petName ? ` for ${appointment.petName}` : "";
	const scheduledText = toDisplayDateTime(appointment.date);

	await sendEmail({
		to: recipientEmail,
		subject: "Appointment scheduled - coming up soon",
		text: `Hello${helloName}, your ${reasonLabel} appointment${petText} is scheduled for ${scheduledText}. Your appointment is coming up soon.`,
	});

	await logEmail({
		userID: appointment.userID,
		appointmentID: appointment.appointmentID,
		type: "CUSTOMER_SOON_AFTER_BOOKING_EMAIL",
		recipientEmail,
	});
}

export async function handleImmediateNotificationsForNewAppointment(appointmentID) {
	/*
		Run the immediate notification rules after a booking succeeds.

		Appointments happening soon dont wait for the normal scheduled reminder windows:
		  customers get an email right away if the appointment is within 24 hours
		  staff get an in app reminder right away if the appointment is within 1 hour
	*/
	if (!Number.isInteger(Number(appointmentID)) || Number(appointmentID) < 1) {
		return;
	}

	const appointmentContext = await loadAppointmentNotificationContext(Number(appointmentID));
	if (!appointmentContext) {
		return;
	}

	await sendImmediateCustomerSoonEmail(appointmentContext);
	await createImmediateStaffSoonReminders(appointmentContext);
}

let schedulerStarted = false;

export function startNotificationScheduler() {
	/* Only start the cron scheduler once per server process. */
	if (schedulerStarted) {
		return;
	}

	schedulerStarted = true;

	/* Run the reminder checks once every minute. */
	cron.schedule("* * * * *", async () => {
		try {
			await createStaffOneHourReminders();
			await sendCustomer24HourEmails();
		} catch (err) {
			console.error("notification scheduler error:", err);
		}
	});
}