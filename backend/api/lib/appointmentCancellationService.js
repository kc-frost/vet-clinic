import { pool } from "../db.js";
import { sendEmail } from "./mailer.js";

function toPositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

function normalizeCancelType(value) {
  const type = String(value || "").trim().toUpperCase();
  if (type === "ADMIN" || type === "STAFF" || type === "CUSTOMER") return type;
  return null;
}

function toReadableDateTime(value) {
  const dt = value instanceof Date ? value : new Date(value);
  return dt.toLocaleString("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatAppointmentReason(reasonKey) {
  return String(reasonKey || "").trim() || "General appointment";
}

function buildCustomerEmailMessage({
  cancelType,
  cancelerName,
  reasonLabel,
  appointmentDateText,
  petName,
}) {
  if (cancelType === "ADMIN") {
    return `Your appointment for ${petName} on ${appointmentDateText} was canceled by administrator ${cancelerName}. Reason: ${reasonLabel}`;
  }

  if (cancelType === "STAFF") {
    return `Your appointment for ${petName} on ${appointmentDateText} was canceled by staff ${cancelerName}. Reason: ${reasonLabel}. Sorry for the inconvenience.`;
  }

  return `Your appointment for ${petName} on ${appointmentDateText} was canceled.`;
}

function buildStaffInAppMessage({
  cancelType,
  cancelerName,
  reasonLabel,
  appointmentDateText,
  petName,
  ownerName,
  appointmentReason,
}) {
  if (cancelType === "ADMIN") {
    return `The appointment for ${ownerName} and ${petName} on ${appointmentDateText} was canceled by administrator ${cancelerName}. Appointment reason: ${appointmentReason}. Cancellation reason: ${reasonLabel}`;
  }

  if (cancelType === "STAFF") {
    return `The appointment for ${ownerName} and ${petName} on ${appointmentDateText} was canceled by staff ${cancelerName}. Appointment reason: ${appointmentReason}. Cancellation reason: ${reasonLabel}`;
  }

  return `The appointment for ${ownerName} and ${petName} on ${appointmentDateText} was canceled by the customer. Appointment reason: ${appointmentReason}.`;
}

async function createNotification(conn, { userID, appointmentID, type, title, message }) {
  await conn.execute(
    `INSERT INTO notification
      (userID, appointmentID, type, title, message, channel, isRead)
     VALUES (?, ?, ?, ?, ?, 'IN_APP', 0)`,
    [userID, appointmentID, type, title, message]
  );
}

async function logEmail(conn, { userID, appointmentID, type, recipientEmail }) {
  await conn.execute(
    `INSERT INTO email_log
      (userID, appointmentID, type, recipientEmail)
     VALUES (?, ?, ?, ?)`,
    [userID, appointmentID, type, recipientEmail]
  );
}

async function refundConsumables(conn, appointmentID) {
  const [consRows] = await conn.execute(
    `SELECT itemID, qtyUsed
     FROM appointment_consumable
     WHERE appointmentID = ?
     FOR UPDATE`,
    [appointmentID]
  );

  for (const row of consRows) {
    await conn.execute(
      `UPDATE inventory
       SET quantity = quantity + ?
       WHERE itemID = ?
         AND isConsumable = 1`,
      [Number(row.qtyUsed), Number(row.itemID)]
    );
  }

  await conn.execute(`DELETE FROM appointment_consumable WHERE appointmentID = ?`, [appointmentID]);
}

async function loadAppointmentContext(conn, appointmentID) {
  const [rows] = await conn.execute(
    `SELECT
      a.appointmentID,
      a.userID,
      a.date,
      a.reasonKey,
      a.durationMinutes,
      a.roomNumber,
      COALESCE(a.isCanceled, 0) AS isCanceled,
      c.email AS customerEmail,
      TRIM(CONCAT(COALESCE(c.legalFirstName, ''), ' ', COALESCE(c.legalLastName, ''))) AS customerName,
      COALESCE(p.petName, af.petName, 'Unknown Pet') AS petName
     FROM appointment a
     INNER JOIN customer c
       ON c.userID = a.userID
     LEFT JOIN pet p
       ON p.petID = a.petID
     LEFT JOIN appointment_form af
       ON af.appointmentID = a.appointmentID
     WHERE a.appointmentID = ?
     LIMIT 1
     FOR UPDATE`,
    [appointmentID]
  );

  if (!rows.length) return null;

  const appointment = rows[0];

  const [staffRows] = await conn.execute(
    `SELECT
      s.userID AS staffUserID,
      s.staffID,
      aps.assignedRoleKey,
      TRIM(CONCAT(COALESCE(sc.legalFirstName, ''), ' ', COALESCE(sc.legalLastName, ''))) AS staffName
     FROM appointment_staff aps
     INNER JOIN staff s
       ON s.staffID = aps.staffID
     INNER JOIN customer sc
       ON sc.userID = s.userID
     WHERE aps.appointmentID = ?`,
    [appointmentID]
  );

  return {
    appointment,
    staffRows,
  };
}

async function loadCancelerDisplayName(conn, canceledByUserID, canceledByType) {
  const [rows] = await conn.execute(
    `SELECT TRIM(CONCAT(COALESCE(legalFirstName, ''), ' ', COALESCE(legalLastName, ''))) AS fullName
     FROM customer
     WHERE userID = ?
     LIMIT 1`,
    [canceledByUserID]
  );

  if (rows.length && String(rows[0].fullName || "").trim()) {
    return String(rows[0].fullName).trim();
  }

  if (canceledByType === "ADMIN") return "Unknown Administrator";
  if (canceledByType === "STAFF") return "Unknown Staff";
  return "Unknown Customer";
}

async function executeCancellation(
  conn,
  {
    appointmentID,
    canceledByUserID,
    canceledByType,
    cancellationReason = null,
    suppressCustomerNotification = false,
  }
) {
  const safeAppointmentID = toPositiveInt(appointmentID);
  const safeCanceledByUserID = toPositiveInt(canceledByUserID);
  const safeCanceledByType = normalizeCancelType(canceledByType);
  const safeReason = cancellationReason == null ? null : String(cancellationReason).trim();
  const shouldSuppressCustomerNotification = Boolean(suppressCustomerNotification);

  if (!safeAppointmentID) {
    const err = new Error("Invalid appointment id");
    err.status = 400;
    throw err;
  }

  if (!safeCanceledByUserID) {
    const err = new Error("Invalid canceledByUserID");
    err.status = 400;
    throw err;
  }

  if (!safeCanceledByType) {
    const err = new Error("Invalid canceledByType");
    err.status = 400;
    throw err;
  }

  if ((safeCanceledByType === "ADMIN" || safeCanceledByType === "STAFF") && !safeReason) {
    const err = new Error("Cancellation reason is required");
    err.status = 400;
    throw err;
  }

  const loaded = await loadAppointmentContext(conn, safeAppointmentID);

  if (!loaded) {
    const err = new Error("Appointment not found");
    err.status = 404;
    throw err;
  }

  const { appointment, staffRows } = loaded;

  if (Number(appointment.isCanceled) === 1) {
    const err = new Error("Appointment is already canceled");
    err.status = 409;
    throw err;
  }

  const startDt = appointment.date instanceof Date ? appointment.date : new Date(appointment.date);
  if (startDt.getTime() < Date.now()) {
    const err = new Error("Appointments that have already started cannot be canceled");
    err.status = 400;
    throw err;
  }

  await refundConsumables(conn, safeAppointmentID);

  await conn.execute(
    `UPDATE appointment
     SET isCanceled = 1,
         underReview = 0
     WHERE appointmentID = ?`,
    [safeAppointmentID]
  );

  await conn.execute(`DELETE FROM appointment_issue WHERE appointmentID = ?`, [safeAppointmentID]);

  await conn.execute(
    `INSERT INTO appointment_cancellation
      (appointmentID, canceledByUserID, canceledByType, cancellationReason)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       canceledByUserID = VALUES(canceledByUserID),
       canceledByType = VALUES(canceledByType),
       cancellationReason = VALUES(cancellationReason),
       canceledAt = CURRENT_TIMESTAMP`,
    [safeAppointmentID, safeCanceledByUserID, safeCanceledByType, safeReason]
  );

  const appointmentDateText = toReadableDateTime(appointment.date);
  const ownerName = String(appointment.customerName || "").trim() || "Unknown Owner";
  const petName = String(appointment.petName || "").trim() || "Unknown Pet";
  const reasonLabel = safeReason || "No reason provided";
  const appointmentReason = formatAppointmentReason(appointment.reasonKey);
  const cancelerName = await loadCancelerDisplayName(conn, safeCanceledByUserID, safeCanceledByType);

  // Customers get email for admin and staff cancellations unless the caller suppresses it
  if (!shouldSuppressCustomerNotification && (safeCanceledByType === "ADMIN" || safeCanceledByType === "STAFF")) {
    const customerTitle = "Appointment canceled";
    const customerMessage = buildCustomerEmailMessage({
      cancelType: safeCanceledByType,
      cancelerName,
      reasonLabel,
      appointmentDateText,
      petName,
    });

    if (appointment.customerEmail) {
      try {
        await sendEmail({
          to: appointment.customerEmail,
          subject: customerTitle,
          text: customerMessage,
        });

        await logEmail(conn, {
          userID: Number(appointment.userID),
          appointmentID: safeAppointmentID,
          type: `${safeCanceledByType}_APPOINTMENT_CANCELED`,
          recipientEmail: appointment.customerEmail,
        });
      } catch (err) {
        console.error("customer cancellation email error", err);
      }
    }
  }

  // Staff get in app notifications only
  let notifiedStaffCount = 0;

  for (const staffRow of staffRows) {
    const staffUserID = Number(staffRow.staffUserID);

    if (safeCanceledByType === "STAFF" && staffUserID === safeCanceledByUserID) {
      continue;
    }

    const staffTitle = "Appointment canceled";
    const staffMessage = buildStaffInAppMessage({
      cancelType: safeCanceledByType,
      cancelerName,
      reasonLabel,
      appointmentDateText,
      petName,
      ownerName,
      appointmentReason,
    });

    await createNotification(conn, {
      userID: staffUserID,
      appointmentID: safeAppointmentID,
      type: `${safeCanceledByType}_APPOINTMENT_CANCELED`,
      title: staffTitle,
      message: staffMessage,
    });

    notifiedStaffCount += 1;
  }

  return {
    ok: true,
    appointmentID: safeAppointmentID,
    canceledByUserID: safeCanceledByUserID,
    canceledByType: safeCanceledByType,
    cancellationReason: safeReason,
    cancelerName,
    suppressCustomerNotification: shouldSuppressCustomerNotification,
    notifiedStaffCount,
    customerUserID: Number(appointment.userID),
  };
}

export async function cancelAppointment(args) {
  if (args?.conn) {
    return executeCancellation(args.conn, args);
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    const result = await executeCancellation(conn, args);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}