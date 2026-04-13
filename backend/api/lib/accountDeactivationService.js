import { pool } from "../db.js";
import { processInactiveStaffAssignments } from "./appointmentIssueService.js";
import { cancelAppointment } from "./appointmentCancellationService.js";

function toPositiveInt(value) {
	// Make sure IDs coming in are real positive integers before we trust them
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) return null;
	return parsed;
}

async function cancelFutureOwnedAppointments(conn, ownerUserID, actorUserID) {
	// Cancel each future appointment through the shared helper so metadata,
	// refund cleanup, and notification logic stay consistent
	const [rows] = await conn.query(
		`SELECT appointmentID
		 FROM appointment
		 WHERE userID = ?
		   AND date >= NOW()
		   AND COALESCE(isCanceled, 0) = 0`,
		[ownerUserID]
	);

	if (!rows.length) return { canceledAppointmentIDs: [] };

	const canceledAppointmentIDs = [];

	for (const row of rows) {
		const result = await cancelAppointment({
			conn,
			appointmentID: Number(row.appointmentID),
			canceledByUserID: actorUserID,
			canceledByType: "ADMIN",
			cancellationReason: "The customer account was deactivated",
			suppressCustomerNotification: true,
		});

		canceledAppointmentIDs.push(Number(result.appointmentID));
	}

	return { canceledAppointmentIDs };
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
		// Everything inside this transaction should succeed or fail together
		await conn.beginTransaction();

		// Load the target user and check whether they are linked to a staff record
		const [userRows] = await conn.query(
			`SELECT
				c.userID,
				c.email,
				c.userType,
				c.isDeactivated,
				s.staffID
			 FROM customer c
			 LEFT JOIN staff s
			   ON s.userID = c.userID
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

		// Stop early if the account is already deactivated
		if (Number(targetUser.isDeactivated) === 1) {
			const err = new Error("User is already deactivated");
			err.status = 409;
			throw err;
		}

		// Prevent admin accounts from being deactivated from this route
		if (targetUserType === "ADMIN") {
			const err = new Error("Admin accounts cannot be deactivated from the UI");
			err.status = 403;
			throw err;
		}

		// Deactivate the customer account itself first
		await conn.query(
			`UPDATE customer
			 SET isDeactivated = 1,
			     deactivatedAt = NOW()
			 WHERE userID = ?`,
			[safeTargetUserID]
		);

		// Cancel any future appointments owned by this user and do all related cleanup
		const cancellationResult = await cancelFutureOwnedAppointments(conn, safeTargetUserID, safeActorUserID);

		// Default result in case this user is not staff
		let reviewResult = { autoResolvedAppointmentIDs: [], underReviewAppointmentIDs: [] };

		if (targetUser.staffID) {
			// If this user is staff too, deactivate the staff record
			await conn.query(
				`UPDATE staff
				 SET isActive = 0,
				     deactivatedAt = NOW()
				 WHERE staffID = ?`,
				[Number(targetUser.staffID)]
			);

			// Let the appointment issue service decide which assignments can be auto-resolved
			// and which appointments still need admin review
			reviewResult = await processInactiveStaffAssignments(conn, Number(targetUser.staffID));
		}

		await conn.commit();

		return {
			userID: safeTargetUserID,
			email: String(targetUser.email || ""),
			userType: targetUserType,
			canceledAppointmentCount: cancellationResult.canceledAppointmentIDs.length,
			autoResolvedAppointmentCount: reviewResult.autoResolvedAppointmentIDs.length,
			underReviewAppointmentCount: reviewResult.underReviewAppointmentIDs.length,
		};
	} catch (err) {
		await conn.rollback();
		throw err;
	} finally {
		conn.release();
	}
}
