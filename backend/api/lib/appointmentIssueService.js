import { pool } from "../db.js";
import { sendEmail } from "./mailer.js";
import { getRule } from "./reservationRules.js";

function normalizeIssueType(issueType) {
	// Normalize issue types so comparisons and stored values stay consistent
	return String(issueType || "").trim().toUpperCase();
}

function normalizeIssueKey(issueKey) {
	// Normalize issue keys for the same reason as issue types
	return String(issueKey || "").trim().toUpperCase();
}

function buildIssueLabel(issueType, issueKey) {
	// Turn stored issue codes into something easier to read in the UI
	if (issueType === "STAFF_ROLE_MISSING") return `Missing staff role ${issueKey}`;
	if (issueType === "ROOM_TYPE_MISSING") return `Missing room type ${issueKey}`;
	if (issueType === "EQUIPMENT_MISSING") return `Missing equipment ${issueKey}`;
	return `${issueType} ${issueKey}`.trim();
}

function buildAssignedStaff(rows) {
	// Shape raw joined staff rows into the staff objects the UI expects
	return rows.map((row) => ({
		staffID: Number(row.staffID),
		userID: Number(row.userID),
		assignedRoleKey: String(row.assignedRoleKey || ""),
		name: String(row.staffName || "").trim(),
		positionTitle: String(row.positionTitle || ""),
	}));
}

function buildIssueRows(rows) {
	// Normalize issue values and add a readable label for each issue row
	return rows.map((row) => {
		const issueType = normalizeIssueType(row.issueType);
		const issueKey = normalizeIssueKey(row.issueKey);

		return {
			issueID: Number(row.issueID),
			appointmentID: Number(row.appointmentID),
			issueType,
			issueKey,
			label: buildIssueLabel(issueType, issueKey),
			createdAt: row.createdAt,
		};
	});
}

function pad2(value) {
	// Keep date/time pieces two digits so SQL strings stay valid
	return String(value).padStart(2, "0");
}

function dateToSqlDateTime(dateValue) {
	// Convert a JS Date into a SQL datetime string for overlap queries
	const year = dateValue.getFullYear();
	const month = pad2(dateValue.getMonth() + 1);
	const day = pad2(dateValue.getDate());
	const hour = pad2(dateValue.getHours());
	const minute = pad2(dateValue.getMinutes());
	const second = pad2(dateValue.getSeconds());
	return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function dateToSqlTime(dateValue) {
	// Pull just the time part when checking staff availability windows
	const hour = pad2(dateValue.getHours());
	const minute = pad2(dateValue.getMinutes());
	const second = pad2(dateValue.getSeconds());
	return `${hour}:${minute}:${second}`;
}

function getDayOfWeekForAvailability(dateValue) {
	// JS uses 0 for Sunday but staff availability uses 7
	const day = dateValue.getDay();
	if (day === 0) return 7;
	return day;
}

async function syncAppointmentUnderReviewFlag(conn, appointmentID) {
	// Keep the underReview flag in sync with whether the appointment still has active issue rows
	const [rows] = await conn.query(
		`SELECT COUNT(*) AS activeIssueCount
		 FROM appointment_issue
		 WHERE appointmentID = ?`,
		[appointmentID]
	);

	const activeIssueCount = Number(rows[0]?.activeIssueCount || 0);

	await conn.query(
		`UPDATE appointment
		 SET underReview = ?
		 WHERE appointmentID = ?
		 AND COALESCE(isCanceled, 0) = 0`,
		[activeIssueCount > 0 ? 1 : 0, appointmentID]
	);
}

async function clearMatchingIssue(conn, appointmentID, issueType, issueKey) {
	// Remove one specific issue row when that exact problem gets resolved
	await conn.query(
		`DELETE FROM appointment_issue
		 WHERE appointmentID = ?
		 AND issueType = ?
		 AND issueKey = ?`,
		[appointmentID, normalizeIssueType(issueType), normalizeIssueKey(issueKey)]
	);
}

async function getExistingIssueKeys(conn, appointmentID) {
	// Load existing issue keys so new inserts do not create duplicates already in the table
	const [rows] = await conn.query(
		`SELECT issueType, issueKey
		 FROM appointment_issue
		 WHERE appointmentID = ?`,
		[appointmentID]
	);

	return new Set(rows.map((row) => `${normalizeIssueType(row.issueType)}:${normalizeIssueKey(row.issueKey)}`));
}

async function getAppointmentAssignmentStaffIDs(conn, appointmentID, excludedStaffID = null) {
	// Get staff already assigned to this appointment so we do not reuse them as a replacement
	const values = [appointmentID];
	let sql = `SELECT staffID FROM appointment_staff WHERE appointmentID = ?`;

	if (excludedStaffID !== null) {
		sql += ` AND staffID <> ?`;
		values.push(excludedStaffID);
	}

	const [rows] = await conn.query(sql, values);
	return rows.map((row) => Number(row.staffID)).filter((staffID) => Number.isInteger(staffID));
}

async function findReplacementStaffID(conn, roleKey, appointmentID, appointmentStart, appointmentEnd, excludedStaffIDs = []) {
	// Look for an active staff member with the needed role who is available
	// during the full appointment window and not already assigned somewhere overlapping
	const startSql = dateToSqlDateTime(appointmentStart);
	const endSql = dateToSqlDateTime(appointmentEnd);
	const dayOfWeek = getDayOfWeekForAvailability(appointmentStart);
	const startTimeSql = dateToSqlTime(appointmentStart);
	const endTimeSql = dateToSqlTime(appointmentEnd);

	let sql =
		`SELECT s.staffID
		 FROM staff s
		 INNER JOIN customer c
			on c.userID = s.userID
		 INNER JOIN staff_role sr
			on sr.staffID = s.staffID
		 INNER JOIN staff_availability sa
			on sa.staffID = s.staffID
		 WHERE sr.roleKey = ?
		 AND sa.dayOfWeek = ?
		 AND sa.startTime <= ?
		 AND sa.endTime >= ?
		 AND COALESCE(s.isActive, 1) = 1
		 AND COALESCE(c.isDeactivated, 0) = 0`;

	const values = [roleKey, dayOfWeek, startTimeSql, endTimeSql];

	if (excludedStaffIDs.length) {
		const placeholders = excludedStaffIDs.map(() => "?").join(",");
		sql += ` AND s.staffID NOT IN (${placeholders})`;
		values.push(...excludedStaffIDs);
	}

	sql +=
		` AND NOT EXISTS (
			SELECT 1
			FROM appointment_staff aps
			INNER JOIN appointment a
				on a.appointmentID = aps.appointmentID
			WHERE aps.staffID = s.staffID
			AND a.appointmentID <> ?
			AND a.date < ?
			AND DATE_ADD(a.date, INTERVAL a.durationMinutes MINUTE) > ?
			AND COALESCE(a.isCanceled, 0) = 0
		 )
		 ORDER BY s.staffID ASC
		 LIMIT 1`;

	values.push(appointmentID, endSql, startSql);

	const [rows] = await conn.query(sql, values);
	if (!rows.length) return null;
	return Number(rows[0].staffID);
}

async function findReplacementRoomNumber(conn, roomType, appointmentID, appointmentStart, appointmentEnd, excludedRoomNumber) {
	// Find another active room of the same type that is free for the appointment window
	const startSql = dateToSqlDateTime(appointmentStart);
	const endSql = dateToSqlDateTime(appointmentEnd);

	const [rows] = await conn.query(
		`SELECT r.roomNumber
		 FROM rooms r
		 WHERE r.roomType = ?
		 AND COALESCE(r.isActive, 1) = 1
		 AND r.roomNumber <> ?
		 AND NOT EXISTS (
			SELECT 1
			FROM appointment a
			WHERE a.roomNumber = r.roomNumber
			AND a.appointmentID <> ?
			AND a.date < ?
			AND DATE_ADD(a.date, INTERVAL a.durationMinutes MINUTE) > ?
			AND COALESCE(a.isCanceled, 0) = 0
		 )
		 ORDER BY r.roomNumber ASC
		 LIMIT 1`,
		[roomType, excludedRoomNumber, appointmentID, endSql, startSql]
	);

	if (!rows.length) return null;
	return Number(rows[0].roomNumber);
}

export async function markAppointmentUnderReview(conn, appointmentID) {
	// Flag the appointment so it appears in the review queue
	await conn.query(
		`UPDATE appointment
		 SET underReview = 1
		 WHERE appointmentID = ?
		 AND COALESCE(isCanceled, 0) = 0`,
		[appointmentID]
	);
}

export async function clearAppointmentIssues(conn, appointmentID) {
	// Remove all tracked issue rows for this appointment
	await conn.query(`DELETE FROM appointment_issue WHERE appointmentID = ?`, [appointmentID]);

	// Recalculate the review flag after clearing the issue rows
	await syncAppointmentUnderReviewFlag(conn, appointmentID);
}

export async function createAppointmentIssues(conn, appointmentID, issues) {
	// Nothing to insert if the caller passed nothing useful
	if (!Array.isArray(issues) || !issues.length) return [];

	const existingIssueKeys = await getExistingIssueKeys(conn, appointmentID);
	const seenIssueKeys = new Set();
	const values = [];

	for (const issue of issues) {
		const issueType = normalizeIssueType(issue?.issueType);
		const issueKey = normalizeIssueKey(issue?.issueKey);

		// Skip incomplete issue objects
		if (!issueType || !issueKey) continue;

		// Avoid duplicate issues both inside this batch and already in the table
		const dedupeKey = `${issueType}:${issueKey}`;
		if (seenIssueKeys.has(dedupeKey) || existingIssueKeys.has(dedupeKey)) continue;
		seenIssueKeys.add(dedupeKey);

		values.push([appointmentID, issueType, issueKey]);
	}

	if (!values.length) {
		await syncAppointmentUnderReviewFlag(conn, appointmentID);
		return [];
	}

	await conn.query(
		`INSERT INTO appointment_issue
			(appointmentID, issueType, issueKey)
		 VALUES ?`,
		[values]
	);

	// Recalculate review state after inserting issues
	await syncAppointmentUnderReviewFlag(conn, appointmentID);

	// Return the created issue data in a simple shaped format
	return values.map((value) => ({ appointmentID, issueType: value[1], issueKey: value[2] }));
}

export async function processInactiveStaffAssignments(conn, inactiveStaffID) {
	// Find future active appointments where this staff member is assigned
	const [rows] = await conn.query(
		`SELECT
			aps.appointmentID,
			aps.assignedRoleKey,
			a.date,
			a.durationMinutes
		 FROM appointment_staff aps
		 INNER JOIN appointment a
			on a.appointmentID = aps.appointmentID
		 WHERE aps.staffID = ?
		 AND a.date >= NOW()
		 AND COALESCE(a.isCanceled, 0) = 0
		 ORDER BY a.date ASC, aps.appointmentID ASC`,
		[inactiveStaffID]
	);

	if (!rows.length) return { autoResolvedAppointmentIDs: [], underReviewAppointmentIDs: [] };

	const autoResolvedAppointmentIDs = [];
	const underReviewAppointmentIDs = [];

	for (const row of rows) {
		const appointmentID = Number(row.appointmentID);
		const issueKey = normalizeIssueKey(row.assignedRoleKey);
		const appointmentStart = new Date(row.date);
		const appointmentEnd = new Date(appointmentStart.getTime() + Number(row.durationMinutes) * 60000);

		// Exclude the inactive staff member and any staff already assigned to this appointment
		const assignedStaffIDs = await getAppointmentAssignmentStaffIDs(conn, appointmentID, Number(inactiveStaffID));

		// Try to auto-replace the inactive staff member with someone valid for the same role
		const replacementStaffID = await findReplacementStaffID(conn, issueKey, appointmentID, appointmentStart, appointmentEnd, assignedStaffIDs);

		if (replacementStaffID) {
			await conn.query(
				`UPDATE appointment_staff
				 SET staffID = ?
				 WHERE appointmentID = ?
				 AND staffID = ?
				 AND assignedRoleKey = ?`,
				[replacementStaffID, appointmentID, inactiveStaffID, row.assignedRoleKey]
			);

			await clearMatchingIssue(conn, appointmentID, "STAFF_ROLE_MISSING", issueKey);
			await syncAppointmentUnderReviewFlag(conn, appointmentID);
			autoResolvedAppointmentIDs.push(appointmentID);
			continue;
		}

		// If no replacement exists, remove the dead assignment and flag the appointment for review
		await conn.query(
			`DELETE FROM appointment_staff
			 WHERE appointmentID = ?
			 AND staffID = ?
			 AND assignedRoleKey = ?`,
			[appointmentID, inactiveStaffID, row.assignedRoleKey]
		);

		await markAppointmentUnderReview(conn, appointmentID);
		await createAppointmentIssues(conn, appointmentID, [{ issueType: "STAFF_ROLE_MISSING", issueKey }]);
		underReviewAppointmentIDs.push(appointmentID);
	}

	return {
		autoResolvedAppointmentIDs: [...new Set(autoResolvedAppointmentIDs)],
		underReviewAppointmentIDs: [...new Set(underReviewAppointmentIDs)],
	};
}

export async function processInactiveRoom(conn, roomNumber) {
	// Load the room first so we know what room type we are trying to replace
	const [roomRows] = await conn.query(
		`SELECT roomNumber, roomType
		 FROM rooms
		 WHERE roomNumber = ?
		 LIMIT 1`,
		[roomNumber]
	);

	if (!roomRows.length) return { autoResolvedAppointmentIDs: [], underReviewAppointmentIDs: [] };

	const roomType = String(roomRows[0].roomType || "").trim().toUpperCase();

	// Find future active appointments using this room
	const [rows] = await conn.query(
		`SELECT appointmentID, date, durationMinutes
		 FROM appointment
		 WHERE roomNumber = ?
		 AND date >= NOW()
		 AND COALESCE(isCanceled, 0) = 0
		 ORDER BY date ASC, appointmentID ASC`,
		[roomNumber]
	);

	if (!rows.length) return { autoResolvedAppointmentIDs: [], underReviewAppointmentIDs: [] };

	const autoResolvedAppointmentIDs = [];
	const underReviewAppointmentIDs = [];

	for (const row of rows) {
		const appointmentID = Number(row.appointmentID);
		const appointmentStart = new Date(row.date);
		const appointmentEnd = new Date(appointmentStart.getTime() + Number(row.durationMinutes) * 60000);

		// Try to find another room of the same type that is free during the appointment window
		const replacementRoomNumber = await findReplacementRoomNumber(conn, roomType, appointmentID, appointmentStart, appointmentEnd, Number(roomNumber));

		if (replacementRoomNumber) {
			await conn.query(`UPDATE appointment SET roomNumber = ? WHERE appointmentID = ?`, [replacementRoomNumber, appointmentID]);
			await clearMatchingIssue(conn, appointmentID, "ROOM_TYPE_MISSING", roomType);
			await syncAppointmentUnderReviewFlag(conn, appointmentID);
			autoResolvedAppointmentIDs.push(appointmentID);
			continue;
		}

		// If no replacement room exists, leave the appointment in review with a matching issue row
		await markAppointmentUnderReview(conn, appointmentID);
		await createAppointmentIssues(conn, appointmentID, [{ issueType: "ROOM_TYPE_MISSING", issueKey: roomType }]);
		underReviewAppointmentIDs.push(appointmentID);
	}

	return {
		autoResolvedAppointmentIDs: [...new Set(autoResolvedAppointmentIDs)],
		underReviewAppointmentIDs: [...new Set(underReviewAppointmentIDs)],
	};
}

function appointmentsOverlap(firstAppointment, secondAppointment) {
	// Two appointments overlap when each one starts before the other one ends
	return firstAppointment.startAt < secondAppointment.endAt && firstAppointment.endAt > secondAppointment.startAt;
}

async function getFutureAppointmentsRequiringEquipmentKey(conn, issueKey) {
	// Pull future active appointments and keep only the ones whose reason rule needs this exact equipment key
	const [rows] = await conn.query(
		`SELECT appointmentID, reasonKey, date, durationMinutes
		 FROM appointment
		 WHERE date >= NOW()
		 AND COALESCE(isCanceled, 0) = 0
		 ORDER BY date ASC, appointmentID ASC`
	);

	const matchingAppointments = [];

	for (const row of rows) {
		const rule = getRule(row.reasonKey);
		if (!rule || !(rule.nonConsumables || []).includes(issueKey)) continue;

		const startAt = new Date(row.date);
		const endAt = new Date(startAt.getTime() + Number(row.durationMinutes) * 60000);
		matchingAppointments.push({
			appointmentID: Number(row.appointmentID),
			reasonKey: String(row.reasonKey || ""),
			startAt,
			endAt,
			durationMinutes: Number(row.durationMinutes),
		});
	}

	return matchingAppointments;
}

async function applyNonConsumableCapacityRules(conn, issueKey, availableQuantity) {
	// Keep earlier appointments inside the remaining exact key capacity and send overflow appointments into review
	const matchingAppointments = await getFutureAppointmentsRequiringEquipmentKey(conn, issueKey);
	if (!matchingAppointments.length) return { keptAppointmentIDs: [], underReviewAppointmentIDs: [] };

	const safeAvailableQuantity = Math.max(0, Number(availableQuantity) || 0);
	const keptAppointments = [];
	const keptAppointmentIDs = [];
	const underReviewAppointmentIDs = [];

	for (const appointment of matchingAppointments) {
		const overlappingKeptAppointments = keptAppointments.filter((keptAppointment) => appointmentsOverlap(keptAppointment, appointment));

		if (overlappingKeptAppointments.length < safeAvailableQuantity) {
			keptAppointments.push(appointment);
			keptAppointmentIDs.push(appointment.appointmentID);
			await clearMatchingIssue(conn, appointment.appointmentID, "EQUIPMENT_MISSING", issueKey);
			await syncAppointmentUnderReviewFlag(conn, appointment.appointmentID);
			continue;
		}

		await markAppointmentUnderReview(conn, appointment.appointmentID);
		await createAppointmentIssues(conn, appointment.appointmentID, [{ issueType: "EQUIPMENT_MISSING", issueKey }]);
		underReviewAppointmentIDs.push(appointment.appointmentID);
	}

	return {
		keptAppointmentIDs: [...new Set(keptAppointmentIDs)],
		underReviewAppointmentIDs: [...new Set(underReviewAppointmentIDs)],
	};
}

export async function processInactiveInventoryItem(conn, inventoryItemID) {
	// Deactivating a non-consumable means effective capacity becomes zero
	const [itemRows] = await conn.query(
		`SELECT itemID, itemKey, isConsumable
		 FROM inventory
		 WHERE itemID = ?
		 LIMIT 1`,
		[inventoryItemID]
	);

	if (!itemRows.length) return { keptAppointmentIDs: [], underReviewAppointmentIDs: [] };

	const itemRow = itemRows[0];
	if (Number(itemRow.isConsumable) === 1) return { keptAppointmentIDs: [], underReviewAppointmentIDs: [] };

	const issueKey = normalizeIssueKey(itemRow.itemKey);
	return applyNonConsumableCapacityRules(conn, issueKey, 0);
}

export async function processNonConsumableQuantityChange(conn, inventoryItemID, nextQuantity) {
	// When exact key capacity drops, keep earlier appointments and send the overflow into review
	const [itemRows] = await conn.query(
		`SELECT itemID, itemKey, isConsumable, COALESCE(isActive, 1) AS isActive
		 FROM inventory
		 WHERE itemID = ?
		 LIMIT 1`,
		[inventoryItemID]
	);

	if (!itemRows.length) return { keptAppointmentIDs: [], underReviewAppointmentIDs: [] };

	const itemRow = itemRows[0];
	if (Number(itemRow.isConsumable) === 1 || Number(itemRow.isActive) !== 1) return { keptAppointmentIDs: [], underReviewAppointmentIDs: [] };

	const issueKey = normalizeIssueKey(itemRow.itemKey);
	return applyNonConsumableCapacityRules(conn, issueKey, nextQuantity);
}


function formatIssueNotificationDateTime(value) {
	// Keep the under review email date text readable for the user
	const dateValue = value instanceof Date ? value : new Date(value);
	return dateValue.toLocaleString("en-US", {
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

function formatIssueNotificationDate(value) {
	// This is for same-day ranges where the date only needs to show once
	const dateValue = value instanceof Date ? value : new Date(value);
	return dateValue.toLocaleDateString("en-US", {
		year: "numeric",
		month: "numeric",
		day: "numeric",
	});
}

function formatIssueNotificationTime(value) {
	// This is for same-day ranges where only the time changes
	const dateValue = value instanceof Date ? value : new Date(value);
	return dateValue.toLocaleTimeString("en-US", {
		hour: "numeric",
		minute: "2-digit",
	});
}

function formatIssueNotificationReason(reasonKey) {
	// Turn the stored reason key into readable title text in the email
	const label = String(reasonKey || "")
		.replaceAll("_", " ")
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ")
		.trim();
	return label || "Appointment";
}

function buildResolvedAppointmentSubject() {
	// Keep the subject plain so the user immediately knows the appointment was fixed
	return "Appointment resolved and rescheduled";
}

function buildResolvedAppointmentMessage(row, startAt, endAt) {
	// Tell the user the appointment was fixed and give the new time window
	const petName = String(row.petName || "").trim() || "your pet";
	const reasonLabel = formatIssueNotificationReason(row.reasonKey);
	const startDate = startAt instanceof Date ? startAt : new Date(startAt);
	const endDate = endAt instanceof Date ? endAt : new Date(endAt);
	const sameDay = formatIssueNotificationDate(startDate) === formatIssueNotificationDate(endDate);

	if (sameDay) {
		const dateText = formatIssueNotificationDate(startDate);
		const startTimeText = formatIssueNotificationTime(startDate);
		const endTimeText = formatIssueNotificationTime(endDate);
		return `Your appointment for ${petName} for ${reasonLabel} was resolved by an administrator and has been rescheduled to ${dateText}, ${startTimeText} - ${endTimeText}.`;
	}

	const startText = formatIssueNotificationDateTime(startDate);
	const endText = formatIssueNotificationDateTime(endDate);
	return `Your appointment for ${petName} for ${reasonLabel} was resolved by an administrator and has been rescheduled to ${startText} through ${endText}.`;
}

export async function notifyUserAboutRescheduledAppointment({ appointmentID, startAt, endAt }) {
	// Only notify when the appointment and recipient data are both real
	const safeAppointmentID = Number(appointmentID);
	if (!Number.isInteger(safeAppointmentID) || safeAppointmentID < 1) return;

	const [rows] = await pool.query(
		`SELECT
			a.appointmentID,
			c.email,
			af.petName,
			a.reasonKey
		 FROM appointment a
		 INNER JOIN customer c
			on c.userID = a.userID
		 LEFT JOIN appointment_form af
			on af.appointmentID = a.appointmentID
		 WHERE a.appointmentID = ?
		 LIMIT 1`,
		[safeAppointmentID]
	);

	if (!rows.length) return;

	const row = rows[0];
	const recipientEmail = String(row.email || "").trim();
	if (!recipientEmail) return;

	try {
		await sendEmail({
			to: recipientEmail,
			subject: buildResolvedAppointmentSubject(),
			text: buildResolvedAppointmentMessage(row, startAt, endAt),
		});
	} catch (err) {
		console.error("resolved appointment email error", err);
	}
}

export async function notifyUsersAboutUnderReviewAppointments(appointmentIDs) {
	// Only send one email per appointment id and skip empty input entirely
	const uniqueAppointmentIDs = [...new Set((appointmentIDs || []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
	if (!uniqueAppointmentIDs.length) return;

	const [rows] = await pool.query(
		`SELECT
			a.appointmentID,
			c.email,
			COALESCE(p.petName, af.petName, 'your pet') AS petName,
			a.reasonKey,
			a.date
		 FROM appointment a
		 INNER JOIN customer c
			on c.userID = a.userID
		 LEFT JOIN pet p
			on p.petID = a.petID
		 LEFT JOIN appointment_form af
			on af.appointmentID = a.appointmentID
		 WHERE a.appointmentID IN (?)`,
		[uniqueAppointmentIDs]
	);

	for (const row of rows) {
		const recipientEmail = String(row.email || "").trim();
		if (!recipientEmail) continue;

		const appointmentDateText = formatIssueNotificationDateTime(row.date);
		const petName = String(row.petName || "").trim() || "your pet";
		const reasonLabel = formatIssueNotificationReason(row.reasonKey);
		const subject = "Appointment needs review";
		const message = `Sorry, your appointment at ${appointmentDateText} for ${petName} for ${reasonLabel} has encountered a problem in our system and will be promptly resolved by an administrator. If it is fixed you will be notified, and if it is canceled you will be notified as well`;

		try {
			await sendEmail({ to: recipientEmail, subject, text: message });
		} catch (err) {
			console.error("under review appointment email error", err);
		}
	}
}

export async function getUnderReviewAppointments() {
	// Pull the base appointment rows first
	// This is the main list of active appointments currently sitting in review
	const [appointmentRows] = await pool.query(
		`SELECT
			a.appointmentID,
			a.userID,
			a.petID,
			a.roomNumber,
			a.reasonKey,
			a.date,
			a.durationMinutes,
			a.underReview,
			a.isCanceled,
			af.legalFirstName,
			af.legalLastName,
			af.petName,
			af.reasonDetails
		 FROM appointment a
		 LEFT JOIN appointment_form af
			on af.appointmentID = a.appointmentID
		 WHERE a.underReview = 1
		 AND a.isCanceled = 0
		 ORDER BY a.date ASC, a.appointmentID ASC`
	);

	if (!appointmentRows.length) return [];

	const appointmentIDs = appointmentRows.map((row) => Number(row.appointmentID));

	// Pull all issue rows for the under-review appointments in one query
	const [issueRows] = await pool.query(
		`SELECT issueID, appointmentID, issueType, issueKey, createdAt
		 FROM appointment_issue
		 WHERE appointmentID IN (?)
		 ORDER BY createdAt ASC, issueID ASC`,
		[appointmentIDs]
	);

	// Pull all assigned staff rows for those same appointments in one query
	const [staffRows] = await pool.query(
		`SELECT
			aps.appointmentID,
			aps.staffID,
			aps.assignedRoleKey,
			s.userID,
			s.positionTitle,
			TRIM(CONCAT(COALESCE(c.legalFirstName, ''), ' ', COALESCE(c.legalLastName, ''))) AS staffName
		 FROM appointment_staff aps
		 INNER JOIN staff s
			on s.staffID = aps.staffID
		 INNER JOIN customer c
			on c.userID = s.userID
		 WHERE aps.appointmentID IN (?)
		 ORDER BY aps.appointmentID ASC, aps.staffID ASC`,
		[appointmentIDs]
	);

	const issuesByAppointmentID = new Map();
	for (const issue of buildIssueRows(issueRows)) {
		const appointmentID = issue.appointmentID;
		if (!issuesByAppointmentID.has(appointmentID)) issuesByAppointmentID.set(appointmentID, []);
		issuesByAppointmentID.get(appointmentID).push(issue);
	}

	const staffByAppointmentID = new Map();
	for (const row of staffRows) {
		const appointmentID = Number(row.appointmentID);
		if (!staffByAppointmentID.has(appointmentID)) staffByAppointmentID.set(appointmentID, []);
		staffByAppointmentID.get(appointmentID).push(row);
	}

	// Merge the base appointment rows with their issues and assigned staff
	return appointmentRows.map((row) => {
		const appointmentID = Number(row.appointmentID);
		const startDate = new Date(row.date);

		// Build the end time from the stored start date and duration
		const endDate = new Date(startDate.getTime() + Number(row.durationMinutes) * 60000);
		const ownerName = `${String(row.legalFirstName || "").trim()} ${String(row.legalLastName || "").trim()}`.trim();

		return {
			appointmentID,
			userID: Number(row.userID),
			petID: row.petID == null ? null : Number(row.petID),
			roomNumber: row.roomNumber == null ? null : Number(row.roomNumber),
			reasonKey: String(row.reasonKey || ""),
			reasonDetails: String(row.reasonDetails || ""),
			petName: String(row.petName || ""),
			ownerName,
			startAt: startDate,
			endAt: endDate,
			durationMinutes: Number(row.durationMinutes),
			underReview: Number(row.underReview) === 1,
			isCanceled: Number(row.isCanceled) === 1,
			issues: issuesByAppointmentID.get(appointmentID) || [],
			assignedStaff: buildAssignedStaff(staffByAppointmentID.get(appointmentID) || []),
		};
	});
}

export async function getUnderReviewAppointmentByID(appointmentID) {
	// Only allow real positive integer appointment IDs
	const safeAppointmentID = Number(appointmentID);
	if (!Number.isInteger(safeAppointmentID) || safeAppointmentID < 1) return null;

	// Reuse the shared loader and then grab the one matching appointment
	const appointments = await getUnderReviewAppointments();
	return appointments.find((appointment) => appointment.appointmentID === safeAppointmentID) || null;
}