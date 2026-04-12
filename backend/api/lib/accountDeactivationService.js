import { pool } from "../db.js";

function toPositiveInt(value) {
	// Make sure IDs coming in are real positive integers before we trust them
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) return null;
	return parsed;
}

function buildStaffCancellationMessage(appointment) {
	// Support either a real Date object or a raw DB date value
	const appointmentDate = appointment.date instanceof Date ? appointment.date : new Date(appointment.date);

	// Format the appointment date into something readable for the notification message
	const dateText = appointmentDate.toLocaleString("en-US", {
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});

	return `The appointment for ${dateText} has been canceled because the customer account was deactivated`;
}

async function refundConsumablesForAppointments(conn, appointmentIDs) {
	// Nothing to do if there are no appointments to process
	if (!appointmentIDs.length) return;

	/*
		Put reserved consumable quantities back into inventory for every canceled appointment
		then remove the appointment_consumable rows so those appointments are no longer
		holding inventory reservations
	*/
	await conn.query(
		`UPDATE inventory i
		 INNER JOIN (
			SELECT itemID, SUM(qtyUsed) AS qtyToReturn
			FROM appointment_consumable
			WHERE appointmentID IN (?)
			GROUP BY itemID
		 ) used
			on used.itemID = i.itemID
		 SET i.quantity = i.quantity + used.qtyToReturn`,
		[appointmentIDs]
	);

	await conn.query(
		`DELETE FROM appointment_consumable
		 WHERE appointmentID IN (?)`,
		[appointmentIDs]
	);
}

async function cancelFutureOwnedAppointments(conn, ownerUserID, actorUserID) {
	// Find all future active appointments owned by this customer
	const [rows] = await conn.query(
		`SELECT
			a.appointmentID,
			a.date,
			af.petName
		 FROM appointment a
		 LEFT JOIN appointment_form af
			on af.appointmentID = a.appointmentID
		 WHERE a.userID = ?
			AND a.date >= NOW()
			AND a.isCanceled = 0`,
		[ownerUserID]
	);

	// If the user has no future appointments, there is nothing to cancel
	if (!rows.length) {
		return { canceledAppointmentIDs: [] };
	}

	const appointmentIDs = rows.map((row) => Number(row.appointmentID));

	// Return any reserved consumables before marking the appointments canceled
	await refundConsumablesForAppointments(conn, appointmentIDs);

	// Mark the appointments canceled and clear underReview since they are no longer active
	await conn.query(
		`UPDATE appointment
		 SET isCanceled = 1,
			 underReview = 0
		 WHERE appointmentID IN (?)`,
		[appointmentIDs]
	);

	// Remove any existing issue rows because a canceled appointment should not stay in the issue queue
	await conn.query(
		`DELETE FROM appointment_issue
		 WHERE appointmentID IN (?)`,
		[appointmentIDs]
	);

	// Record who canceled these appointments and why
	const cancellationRows = appointmentIDs.map((appointmentID) => [appointmentID, actorUserID, "ADMIN", "The customer account was deactivated"]);
	await conn.query(
		`INSERT INTO appointment_cancellation
			(appointmentID, canceledByUserID, canceledByType, cancellationReason)
		 VALUES ?`,
		[cancellationRows]
	);

	// Find staff assigned to the canceled appointments so they can be notified
	const [staffRecipients] = await conn.query(
		`SELECT DISTINCT
			aps.appointmentID,
			s.userID AS staffUserID
		 FROM appointment_staff aps
		 INNER JOIN staff s
			on s.staffID = aps.staffID
		 WHERE aps.appointmentID IN (?)`,
		[appointmentIDs]
	);

	if (staffRecipients.length) {
		// Make appointment lookup easier when building the notification rows
		const appointmentByID = new Map(rows.map((row) => [Number(row.appointmentID), row]));

		// Create one in-app notification row per staff recipient
		const notificationRows = staffRecipients.map((recipient) => {
			const appointment = appointmentByID.get(Number(recipient.appointmentID));
			return [
				Number(recipient.staffUserID),
				Number(recipient.appointmentID),
				"ACCOUNT_DEACTIVATED_APPOINTMENT_CANCELED",
				"Appointment canceled",
				buildStaffCancellationMessage(appointment),
				"IN_APP",
				0,
			];
		});

		await conn.query(
			`INSERT INTO notification
				(userID, appointmentID, type, title, message, channel, isRead)
			 VALUES ?`,
			[notificationRows]
		);
	}

	return {
		canceledAppointmentIDs: appointmentIDs,
	};
}

async function markStaffAssignmentsUnderReview(conn, staffID) {
	// Find future active appointments where this staff member is assigned
	const [rows] = await conn.query(
		`SELECT
			aps.appointmentID,
			aps.assignedRoleKey
		 FROM appointment_staff aps
		 INNER JOIN appointment a
			on a.appointmentID = aps.appointmentID
		 WHERE aps.staffID = ?
			AND a.date >= NOW()
			AND a.isCanceled = 0`,
		[staffID]
	);

	// If they are not assigned anywhere upcoming, there is nothing to mark
	if (!rows.length) {
		return { underReviewAppointmentIDs: [] };
	}

	// One appointment can appear more than once if the staff member had multiple assignment rows
	const appointmentIDs = [...new Set(rows.map((row) => Number(row.appointmentID)))];

	// Mark those appointments under review because the staff member is no longer active
	await conn.query(
		`UPDATE appointment
		 SET underReview = 1
		 WHERE appointmentID IN (?)`,
		[appointmentIDs]
	);

	const seen = new Set();
	const issueRows = [];

	for (const row of rows) {
		const appointmentID = Number(row.appointmentID);
		const issueType = "STAFF_ROLE_MISSING";

		// Keep a normalized issue key so missing-role issues are consistent
		const issueKey = String(row.assignedRoleKey || "UNKNOWN_ROLE").trim().toUpperCase();

		// Prevent duplicate issue rows for the same appointment and role
		const dedupeKey = `${appointmentID}:${issueType}:${issueKey}`;
		if (seen.has(dedupeKey)) continue;
		seen.add(dedupeKey);

		issueRows.push([appointmentID, issueType, issueKey]);
	}

	if (issueRows.length) {
		await conn.query(
			`INSERT INTO appointment_issue
				(appointmentID, issueType, issueKey)
			 VALUES ?`,
			[issueRows]
		);
	}

	return {underReviewAppointmentIDs: appointmentIDs,};
}

export async function deactivateAccount({ targetUserID, actorUserID }) {
	// Validate both IDs before touching the database
	const safeTargetUserID = toPositiveInt(targetUserID);
	const safeActorUserID = toPositiveInt(actorUserID);

	if (!safeTargetUserID) {
		const err = new Error("Invalid target user id");
		err.status = 400;
		throw err;
	}

	if (!safeActorUserID) {
		const err = new Error("Invalid actor user id");
		err.status = 400;
		throw err;
	}

	const conn = await pool.getConnection();

	try {
		// Everything here should succeed or fail together
		await conn.beginTransaction();

		// Load the target user and also check whether they have a linked staff record
		const [userRows] = await conn.query(
			`SELECT
				c.userID,
				c.email,
				c.userType,
				c.isDeactivated,
				s.staffID
			 FROM customer c
			 LEFT JOIN staff s
				on s.userID = c.userID
			 WHERE c.userID = ?
			 LIMIT 1`,
			[safeTargetUserID]
		);

		if (!userRows.length) {
			const err = new Error("User not found");
			err.status = 404;
			throw err;
		}

		const targetUser = userRows[0];
		const targetUserType = String(targetUser.userType || "CUSTOMER").trim().toUpperCase();

		// Stop if the account is already deactivated
		if (Number(targetUser.isDeactivated) === 1) {
			const err = new Error("User is already deactivated");
			err.status = 409;
			throw err;
		}

		// Prevent admin accounts from being deactivated from this path
		if (targetUserType === "ADMIN") {
			const err = new Error("Admin accounts cannot be deactivated from the UI");
			err.status = 403;
			throw err;
		}

		// Deactivate the customer account first
		await conn.query(
			`UPDATE customer
			 SET isDeactivated = 1,
				 deactivatedAt = NOW()
			 WHERE userID = ?`,
			[safeTargetUserID]
		);

		// Cancel any future appointments they own and handle all related cleanup
		const cancellationResult = await cancelFutureOwnedAppointments(conn, safeTargetUserID, safeActorUserID);

		let reviewResult = { underReviewAppointmentIDs: [] };

		// If this user is also staff, deactivate the staff record and flag assigned appointments for review
		if (targetUser.staffID) {
			await conn.query(
				`UPDATE staff
				 SET isActive = 0,
					 deactivatedAt = NOW()
				 WHERE staffID = ?`,
				[Number(targetUser.staffID)]
			);

			reviewResult = await markStaffAssignmentsUnderReview(conn, Number(targetUser.staffID));
		}

		await conn.commit();

		return {
			userID: safeTargetUserID,
			email: String(targetUser.email || ""),
			userType: targetUserType,
			canceledAppointmentCount: cancellationResult.canceledAppointmentIDs.length,
			underReviewAppointmentCount: reviewResult.underReviewAppointmentIDs.length,
		};
	} catch (err) {
		await conn.rollback();
		throw err;
	} finally {
		conn.release();
	}
}