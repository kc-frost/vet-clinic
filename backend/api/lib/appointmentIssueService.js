import { pool } from "../db.js";

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

export async function markAppointmentUnderReview(conn, appointmentID) {
	// Flag the appointment so it appears in the review queue
	await conn.query(
		`UPDATE appointment
		 SET underReview = 1
		 WHERE appointmentID = ?`,
		[appointmentID]
	);
}

export async function clearAppointmentIssues(conn, appointmentID) {
	// Remove all tracked issue rows for this appointment
	await conn.query(
		`DELETE FROM appointment_issue
		 WHERE appointmentID = ?`,
		[appointmentID]
	);
}

export async function createAppointmentIssues(conn, appointmentID, issues) {
	// Nothing to insert if the caller passed nothing useful
	if (!Array.isArray(issues) || !issues.length) return [];

	const seen = new Set();
	const values = [];

	for (const issue of issues) {
		const issueType = normalizeIssueType(issue?.issueType);
		const issueKey = normalizeIssueKey(issue?.issueKey);

		// Skip incomplete issue objects
		if (!issueType || !issueKey) continue;

		// Avoid inserting duplicate issue rows for the same type and key
		const dedupeKey = `${issueType}:${issueKey}`;
		if (seen.has(dedupeKey)) continue;
		seen.add(dedupeKey);

		values.push([appointmentID, issueType, issueKey]);
	}

	if (!values.length) return [];

	await conn.query(
		`INSERT INTO appointment_issue
			(appointmentID, issueType, issueKey)
		 VALUES ?`,
		[values]
	);

	// Return the created issue data in a simple shaped format
	return values.map((value) => ({ appointmentID, issueType: value[1], issueKey: value[2] }));
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
		`SELECT
			issueID,
			appointmentID,
			issueType,
			issueKey,
			createdAt
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