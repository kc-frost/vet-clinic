import { pool } from "../db.js";
import { sendEmail } from "./mailer.js";

const EDIT_WINDOW_BEFORE_MINUTES = 32 * 60;
const EDIT_WINDOW_AFTER_MINUTES = 32 * 60;
const SUMMARY_READY_EMAIL_TYPE = "SUMMARY_READY";

function cleanText(value) {
	return typeof value === "string" ? value.trim() : "";
}

function normalizeDraftValue(value) {
	return typeof value === "string" ? value.trim() : "";
}

/*
	Uses the first value that actually exists
	Empty strings still count because staff may intentionally clear a draft field
*/
function firstDefinedValue(...values) {
	for (const value of values) {
		if (value !== undefined && value !== null) return value;
	}

	return "";
}

function hasOwnValue(object, key) {
	return Object.prototype.hasOwnProperty.call(object || {}, key);
}

/*
	Keeps the current stored value when a partial autosave payload does not include this field
	This prevents missing payload fields from wiping saved draft text
*/
function getPayloadTextValue(payload, key, currentValue) {
	if (hasOwnValue(payload, key)) return cleanText(payload[key]);
	return cleanText(currentValue);
}

/*
	Same idea as text fields, but for the draft pet profile object
	This lets autosave update one field without blanking the other draft fields
*/
function getPayloadDraftValue(payload, key, currentValue) {
	const draftPetProfile = payload?.draftPetProfile;
	if (hasOwnValue(draftPetProfile, key)) return normalizeDraftValue(draftPetProfile[key]);
	return normalizeDraftValue(currentValue);
}

function parsePositiveInt(value) {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) return null;
	return parsed;
}

function toIsoDateTime(value) {
	if (!value) return null;

	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return null;

	return date.toISOString();
}

/*
	The edit window is wider than the appointment time
	Staff can prepare before the appointment and clean up notes after it ends
*/
function getEditWindowState(appointmentDateValue, durationMinutes, isFinalized) {
	const startDate = appointmentDateValue instanceof Date ? appointmentDateValue : new Date(appointmentDateValue);
	const startMs = startDate.getTime();
	const endMs = startMs + Number(durationMinutes || 0) * 60 * 1000;
	const nowMs = Date.now();
	const editStartsAtMs = startMs - EDIT_WINDOW_BEFORE_MINUTES * 60 * 1000;
	const editEndsAtMs = endMs + EDIT_WINDOW_AFTER_MINUTES * 60 * 1000;
	const isEditableNow = !isFinalized && nowMs >= editStartsAtMs && nowMs <= editEndsAtMs;
	const shouldAutoFinalize = !isFinalized && nowMs > editEndsAtMs;
	const isOngoing = nowMs >= startMs && nowMs < endMs;

	// Staff can write early, but they should not publish the summary before the visit starts
	const canFinalizeNow = nowMs >= startMs;

	return {
		isEditableNow,
		shouldAutoFinalize,
		isOngoing,
		canFinalizeNow,
		editStartsAt: new Date(editStartsAtMs).toISOString(),
		editEndsAt: new Date(editEndsAtMs).toISOString(),
		startAt: new Date(startMs).toISOString(),
		endAt: new Date(endMs).toISOString(),
	};
}

// Session gives userID, but appointment assignments use staffID
async function getStaffContextByUserID(conn, userID) {
	const [rows] = await conn.execute(
		`SELECT staffID, userID
		 FROM staff
		 WHERE userID = ?
			AND isActive = 1
		 LIMIT 1`,
		[userID]
	);

	if (!rows.length) {
		const error = new Error("Staff not found");
		error.status = 404;
		throw error;
	}

	return { staffID: Number(rows[0].staffID), userID: Number(rows[0].userID) };
}

/*
	Loads the appointment only if this staff member is assigned to it
	This is the main staff-side access check for the summary page
*/
async function loadStaffAppointmentContext(conn, staffID, appointmentID) {
	const [rows] = await conn.execute(
		`SELECT
			a.appointmentID,
			a.userID,
			a.petID,
			a.roomNumber,
			a.reasonKey,
			a.date,
			a.durationMinutes,
			a.isCanceled,
			a.underReview,
			c.email,
			c.legalFirstName,
			c.legalLastName,
			p.petName,
			p.petType,
			p.breed,
			p.petSex,
			p.spayedNeutered,
			p.age,
			p.currentMedications,
			p.medicationHistory,
			p.knownAllergies,
			p.currentConditions,
			p.pastInjuriesConditions,
			p.vaccinationsUpToDate,
			p.heartwormPreventionCurrent,
			af.currentMedications AS formCurrentMedications,
			af.medicationHistory AS formMedicationHistory,
			af.knownAllergies AS formKnownAllergies,
			af.currentConditions AS formCurrentConditions,
			af.pastInjuriesConditions AS formPastInjuriesConditions,
			af.vaccinationsUpToDate AS formVaccinationsUpToDate,
			af.heartwormPreventionCurrent AS formHeartwormPreventionCurrent,
			af.groomingDyeStyleKey,
			af.groomingReferencePhotoPath,
			af.groomingStyleNotes,
			s.appointmentID AS summaryAppointmentID,
			s.symptoms,
			s.diagnosis,
			s.medicationPrescribed,
			s.treatmentPerformed,
			s.notes,
			s.draftAllergies,
			s.draftCurrentMedications,
			s.draftMedicationHistory,
			s.draftCurrentConditions,
			s.draftPastConditions,
			s.draftVaccinationsUpToDate,
			s.draftHeartwormPreventionCurrent,
			s.isFinalized,
			s.finalizedByStaffID,
			s.finalizedAt
		 FROM appointment_staff aps
		 INNER JOIN appointment a
			on a.appointmentID = aps.appointmentID
		 INNER JOIN customer c
			on c.userID = a.userID
		 LEFT JOIN pet p
			on p.petID = a.petID
		 LEFT JOIN appointment_form af
			on af.appointmentID = a.appointmentID
		 LEFT JOIN appointment_summary s
			on s.appointmentID = a.appointmentID
		 WHERE aps.staffID = ?
			AND a.appointmentID = ?
		 LIMIT 1`,
		[staffID, appointmentID]
	);

	if (!rows.length) {
		const error = new Error("Appointment summary not available for this staff member");
		error.status = 404;
		throw error;
	}

	return rows[0];
}

/*
	Customer access is based on owning the appointment
	This still does not mean they can see drafts
*/
async function loadCustomerAppointmentContext(conn, userID, appointmentID) {
	const [rows] = await conn.execute(
		`SELECT
			a.appointmentID,
			a.userID,
			a.petID,
			a.roomNumber,
			a.reasonKey,
			a.date,
			a.durationMinutes,
			a.isCanceled,
			a.underReview,
			c.email,
			c.legalFirstName,
			c.legalLastName,
			p.petName,
			p.petType,
			p.breed,
			p.petSex,
			p.spayedNeutered,
			p.age,
			p.currentMedications,
			p.medicationHistory,
			p.knownAllergies,
			p.currentConditions,
			p.pastInjuriesConditions,
			p.vaccinationsUpToDate,
			p.heartwormPreventionCurrent,
			af.currentMedications AS formCurrentMedications,
			af.medicationHistory AS formMedicationHistory,
			af.knownAllergies AS formKnownAllergies,
			af.currentConditions AS formCurrentConditions,
			af.pastInjuriesConditions AS formPastInjuriesConditions,
			af.vaccinationsUpToDate AS formVaccinationsUpToDate,
			af.heartwormPreventionCurrent AS formHeartwormPreventionCurrent,
			af.groomingDyeStyleKey,
			af.groomingReferencePhotoPath,
			af.groomingStyleNotes,
			s.appointmentID AS summaryAppointmentID,
			s.symptoms,
			s.diagnosis,
			s.medicationPrescribed,
			s.treatmentPerformed,
			s.notes,
			s.draftAllergies,
			s.draftCurrentMedications,
			s.draftMedicationHistory,
			s.draftCurrentConditions,
			s.draftPastConditions,
			s.draftVaccinationsUpToDate,
			s.draftHeartwormPreventionCurrent,
			s.isFinalized,
			s.finalizedByStaffID,
			s.finalizedAt
		 FROM appointment a
		 INNER JOIN customer c
			on c.userID = a.userID
		 LEFT JOIN pet p
			on p.petID = a.petID
		 LEFT JOIN appointment_form af
			on af.appointmentID = a.appointmentID
		 LEFT JOIN appointment_summary s
			on s.appointmentID = a.appointmentID
		 WHERE a.userID = ?
			AND a.appointmentID = ?
		 LIMIT 1`,
		[userID, appointmentID]
	);

	if (!rows.length) {
		const error = new Error("Appointment summary not available for this user");
		error.status = 404;
		throw error;
	}

	return rows[0];
}

/*
	Draft values come first because staff may have already edited them
	Only missing draft values fall back to the pet profile or booking snapshot
*/
function buildDraftPetValues(row) {
	return {
		draftAllergies: normalizeDraftValue(firstDefinedValue(row.draftAllergies, row.knownAllergies, row.formKnownAllergies)),
		draftCurrentMedications: normalizeDraftValue(firstDefinedValue(row.draftCurrentMedications, row.currentMedications, row.formCurrentMedications)),
		draftMedicationHistory: normalizeDraftValue(firstDefinedValue(row.draftMedicationHistory, row.medicationHistory, row.formMedicationHistory)),
		draftCurrentConditions: normalizeDraftValue(firstDefinedValue(row.draftCurrentConditions, row.currentConditions, row.formCurrentConditions)),
		draftPastConditions: normalizeDraftValue(firstDefinedValue(row.draftPastConditions, row.pastInjuriesConditions, row.formPastInjuriesConditions)),
		draftVaccinationsUpToDate: normalizeDraftValue(firstDefinedValue(row.draftVaccinationsUpToDate, row.vaccinationsUpToDate, row.formVaccinationsUpToDate)),
		draftHeartwormPreventionCurrent: normalizeDraftValue(firstDefinedValue(row.draftHeartwormPreventionCurrent, row.heartwormPreventionCurrent, row.formHeartwormPreventionCurrent)),
	};
}

/*
	Summary rows are created only when the summary system needs them
	The local row is patched after insert so the same request can keep using it
*/
async function ensureSummaryRow(conn, row) {
	if (row.summaryAppointmentID) return;

	const draftValues = buildDraftPetValues(row);

	await conn.execute(
		`INSERT INTO appointment_summary (
			appointmentID,
			draftAllergies,
			draftCurrentMedications,
			draftMedicationHistory,
			draftCurrentConditions,
			draftPastConditions,
			draftVaccinationsUpToDate,
			draftHeartwormPreventionCurrent
		 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			row.appointmentID,
			draftValues.draftAllergies,
			draftValues.draftCurrentMedications,
			draftValues.draftMedicationHistory,
			draftValues.draftCurrentConditions,
			draftValues.draftPastConditions,
			draftValues.draftVaccinationsUpToDate,
			draftValues.draftHeartwormPreventionCurrent,
		]
	);

	row.summaryAppointmentID = Number(row.appointmentID);
	row.draftAllergies = draftValues.draftAllergies;
	row.draftCurrentMedications = draftValues.draftCurrentMedications;
	row.draftMedicationHistory = draftValues.draftMedicationHistory;
	row.draftCurrentConditions = draftValues.draftCurrentConditions;
	row.draftPastConditions = draftValues.draftPastConditions;
	row.draftVaccinationsUpToDate = draftValues.draftVaccinationsUpToDate;
	row.draftHeartwormPreventionCurrent = draftValues.draftHeartwormPreventionCurrent;
	row.isFinalized = 0;
	row.finalizedByStaffID = null;
	row.finalizedAt = null;
	row.symptoms = row.symptoms || "";
	row.diagnosis = row.diagnosis || "";
	row.medicationPrescribed = row.medicationPrescribed || "";
	row.treatmentPerformed = row.treatmentPerformed || "";
	row.notes = row.notes || "";
}

// Shapes the database row into the structure the frontend summary page expects
function buildSummaryResponse(row) {
	const summaryState = getEditWindowState(row.date, row.durationMinutes, Boolean(row.isFinalized));
	const draftPetValues = buildDraftPetValues(row);

	return {
		appointment: {
			appointmentID: Number(row.appointmentID),
			reasonKey: row.reasonKey,
			date: toIsoDateTime(row.date),
			durationMinutes: Number(row.durationMinutes || 0),
			roomNumber: row.roomNumber === null ? null : Number(row.roomNumber),
			isCanceled: Boolean(row.isCanceled),
			underReview: Boolean(row.underReview),
			petID: row.petID === null ? null : Number(row.petID),
			petName: row.petName || "",
			groomingDyeStyleKey: row.groomingDyeStyleKey || "",
			groomingReferencePhotoPath: row.groomingReferencePhotoPath || "",
			groomingStyleNotes: row.groomingStyleNotes || "",
		},
		owner: {
			legalFirstName: row.legalFirstName || "",
			legalLastName: row.legalLastName || "",
			email: row.email || "",
		},
		summary: {
			symptoms: row.symptoms || "",
			diagnosis: row.diagnosis || "",
			medicationPrescribed: row.medicationPrescribed || "",
			treatmentPerformed: row.treatmentPerformed || "",
			notes: row.notes || "",
			isFinalized: Boolean(row.isFinalized),
			finalizedByStaffID: row.finalizedByStaffID === null ? null : Number(row.finalizedByStaffID),
			finalizedAt: toIsoDateTime(row.finalizedAt),
		},
		miniPetProfile: {
			petName: row.petName || "",
			petType: row.petType || "",
			breed: row.breed || "",
			petSex: row.petSex || "",
			spayedNeutered: row.spayedNeutered || "",
			age: row.age === null ? null : Number(row.age),
			currentMedications: normalizeDraftValue(firstDefinedValue(row.currentMedications, row.formCurrentMedications)),
			medicationHistory: normalizeDraftValue(firstDefinedValue(row.medicationHistory, row.formMedicationHistory)),
			allergies: normalizeDraftValue(firstDefinedValue(row.knownAllergies, row.formKnownAllergies)),
			currentConditions: normalizeDraftValue(firstDefinedValue(row.currentConditions, row.formCurrentConditions)),
			pastConditions: normalizeDraftValue(firstDefinedValue(row.pastInjuriesConditions, row.formPastInjuriesConditions)),
			vaccinationsUpToDate: normalizeDraftValue(firstDefinedValue(row.vaccinationsUpToDate, row.formVaccinationsUpToDate)),
			heartwormPreventionCurrent: normalizeDraftValue(firstDefinedValue(row.heartwormPreventionCurrent, row.formHeartwormPreventionCurrent)),
		},
		draftPetProfile: {
			allergies: draftPetValues.draftAllergies,
			currentMedications: draftPetValues.draftCurrentMedications,
			medicationHistory: draftPetValues.draftMedicationHistory,
			currentConditions: draftPetValues.draftCurrentConditions,
			pastConditions: draftPetValues.draftPastConditions,
			vaccinationsUpToDate: draftPetValues.draftVaccinationsUpToDate,
			heartwormPreventionCurrent: draftPetValues.draftHeartwormPreventionCurrent,
		},
		state: summaryState,
	};
}

/*
	Follow-up creation starts from the draft values, not the stale pet table values
	That lets staff use their newest summary work before finalizing
*/
function buildFollowUpPrefillResponse(row) {
	const draftPetValues = buildDraftPetValues(row);

	return {
		sourceAppointmentID: Number(row.appointmentID),
		owner: {
			userID: Number(row.userID),
			legalFirstName: row.legalFirstName || "",
			legalLastName: row.legalLastName || "",
			email: row.email || "",
		},
		pet: {
			petID: row.petID === null ? null : Number(row.petID),
			petName: row.petName || "",
			petType: row.petType || "",
			breed: row.breed || "",
			petSex: row.petSex || "",
			spayedNeutered: row.spayedNeutered || "",
			petAge: row.age === null ? null : Number(row.age),
			currentMedications: draftPetValues.draftCurrentMedications,
			medicationHistory: draftPetValues.draftMedicationHistory,
			knownAllergies: draftPetValues.draftAllergies,
			currentConditions: draftPetValues.draftCurrentConditions,
			pastInjuriesConditions: draftPetValues.draftPastConditions,
			vaccinationsUpToDate: draftPetValues.draftVaccinationsUpToDate,
			heartwormPreventionCurrent: draftPetValues.draftHeartwormPreventionCurrent,
		},
		suggestedReasonKey: row.reasonKey,
	};
}

// The email log keeps explicit summary-ready emails from being sent twice
async function loadSummaryReadyEmailLog(conn, appointmentID, recipientEmail) {
	const [rows] = await conn.execute(
		`SELECT emailLogID
		 FROM email_log
		 WHERE appointmentID = ?
			AND type = ?
			AND recipientEmail = ?
		 LIMIT 1`,
		[appointmentID, SUMMARY_READY_EMAIL_TYPE, recipientEmail]
	);

	return rows.length > 0;
}

async function logSummaryReadyEmail(conn, row) {
	await conn.execute(
		`INSERT INTO email_log (userID, appointmentID, type, recipientEmail)
		 VALUES (?, ?, ?, ?)`,
		[row.userID, row.appointmentID, SUMMARY_READY_EMAIL_TYPE, row.email]
	);
}

async function sendSummaryReadyEmail(conn, row) {
	if (!row.email) return;

	const alreadyLogged = await loadSummaryReadyEmailLog(conn, row.appointmentID, row.email);
	if (alreadyLogged) return;

	const ownerName = [row.legalFirstName, row.legalLastName].filter(Boolean).join(" ").trim() || "there";
	const petName = row.petName || "your pet";
	const scheduledText = new Date(row.date).toLocaleString("en-US", {
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});

	await sendEmail({
		to: row.email,
		subject: "Your appointment summary is ready",
		text: `Hello ${ownerName},\n\nYour appointment summary for ${petName} is ready to view in your profile.\n\nAppointment reason: ${row.reasonKey}\nAppointment time: ${scheduledText}\n\nYou can log in and open the summary from your past appointments.`,
	});

	await logSummaryReadyEmail(conn, row);
}

// Finalization is when the draft pet profile actually updates the real pet profile
async function applyPetProfileUpdates(conn, row) {
	if (!row.petID) return;

	const draftValues = buildDraftPetValues(row);

	await conn.execute(
		`UPDATE pet
		 SET currentMedications = ?,
			 medicationHistory = ?,
			 knownAllergies = ?,
			 currentConditions = ?,
			 pastInjuriesConditions = ?,
			 vaccinationsUpToDate = ?,
			 heartwormPreventionCurrent = ?
		 WHERE petID = ?`,
		[
			draftValues.draftCurrentMedications,
			draftValues.draftMedicationHistory,
			draftValues.draftAllergies,
			draftValues.draftCurrentConditions,
			draftValues.draftPastConditions,
			draftValues.draftVaccinationsUpToDate,
			draftValues.draftHeartwormPreventionCurrent,
			row.petID,
		]
	);
}

/*
	Used by both explicit staff finalization and automatic cutoff finalization
	Only explicit staff finalization sends the ready email
*/
async function finalizeSummaryInsideTransaction(conn, row, finalizedByStaffID, shouldSendReadyEmail) {
	await ensureSummaryRow(conn, row);

	if (row.isFinalized) return;

	await applyPetProfileUpdates(conn, row);

	await conn.execute(
		`UPDATE appointment_summary
		 SET isFinalized = 1,
			 finalizedByStaffID = ?,
			 finalizedAt = NOW()
		 WHERE appointmentID = ?`,
		[finalizedByStaffID, row.appointmentID]
	);

	row.isFinalized = 1;
	row.finalizedByStaffID = finalizedByStaffID;
	row.finalizedAt = new Date();

	if (shouldSendReadyEmail) {
		await sendSummaryReadyEmail(conn, row);
	}
}

// Locks old drafts after the post-appointment edit window has passed
async function maybeAutoFinalizeSummary(conn, row) {
	const summaryState = getEditWindowState(row.date, row.durationMinutes, Boolean(row.isFinalized));
	if (!summaryState.shouldAutoFinalize) return row;

	await finalizeSummaryInsideTransaction(conn, row, null, false);
	return row;
}

/*
	Prescribed medication is appointment-specific, but it usually also belongs in current medications
	This appends it without duplicating it if it is already there
*/
function applyMedicationAutoCarry(summaryValues, draftPetValues) {
	const prescribedMedication = cleanText(summaryValues.medicationPrescribed);
	const currentDraftMedications = normalizeDraftValue(draftPetValues.currentMedications);

	if (!prescribedMedication) return currentDraftMedications;
	if (!currentDraftMedications) return prescribedMedication;

	const normalizedLower = currentDraftMedications.toLowerCase();
	if (normalizedLower.includes(prescribedMedication.toLowerCase())) return currentDraftMedications;

	return `${currentDraftMedications}\n${prescribedMedication}`.trim();
}

// Staff summary load is the main entry point for opening the summary page
export async function getStaffSummary(sessionUserID, rawAppointmentID) {
	const appointmentID = parsePositiveInt(rawAppointmentID);
	if (!appointmentID) {
		const error = new Error("Invalid appointment id");
		error.status = 400;
		throw error;
	}

	const conn = await pool.getConnection();

	try {
		const staffContext = await getStaffContextByUserID(conn, sessionUserID);
		let row = await loadStaffAppointmentContext(conn, staffContext.staffID, appointmentID);

		await conn.beginTransaction();
		await ensureSummaryRow(conn, row);
		await maybeAutoFinalizeSummary(conn, row);
		await conn.commit();

		return buildSummaryResponse(row);
	} catch (error) {
		if (conn.connection?._fatalError || conn.connection?.stream?.destroyed) throw error;
		try { await conn.rollback(); } catch {}
		throw error;
	} finally {
		conn.release();
	}
}

// Autosave updates both the appointment summary fields and the staged pet profile values
export async function saveDraftSummary(sessionUserID, rawAppointmentID, payload) {
	const appointmentID = parsePositiveInt(rawAppointmentID);
	if (!appointmentID) {
		const error = new Error("Invalid appointment id");
		error.status = 400;
		throw error;
	}

	const conn = await pool.getConnection();

	try {
		const staffContext = await getStaffContextByUserID(conn, sessionUserID);
		let row = await loadStaffAppointmentContext(conn, staffContext.staffID, appointmentID);

		await conn.beginTransaction();
		await ensureSummaryRow(conn, row);
		await maybeAutoFinalizeSummary(conn, row);

		if (row.isFinalized) {
			const error = new Error("This summary has already been finalized");
			error.status = 409;
			throw error;
		}

		const summaryState = getEditWindowState(row.date, row.durationMinutes, Boolean(row.isFinalized));
		if (!summaryState.isEditableNow) {
			const error = new Error("This summary is outside the edit window");
			error.status = 403;
			throw error;
		}

		const currentDraftValues = buildDraftPetValues(row);

		const nextSummaryValues = {
			symptoms: getPayloadTextValue(payload, "symptoms", row.symptoms),
			diagnosis: getPayloadTextValue(payload, "diagnosis", row.diagnosis),
			medicationPrescribed: getPayloadTextValue(payload, "medicationPrescribed", row.medicationPrescribed),
			treatmentPerformed: getPayloadTextValue(payload, "treatmentPerformed", row.treatmentPerformed),
			notes: getPayloadTextValue(payload, "notes", row.notes),
		};

		const nextDraftPetValues = {
			allergies: getPayloadDraftValue(payload, "allergies", currentDraftValues.draftAllergies),
			currentMedications: getPayloadDraftValue(payload, "currentMedications", currentDraftValues.draftCurrentMedications),
			medicationHistory: getPayloadDraftValue(payload, "medicationHistory", currentDraftValues.draftMedicationHistory),
			currentConditions: getPayloadDraftValue(payload, "currentConditions", currentDraftValues.draftCurrentConditions),
			pastConditions: getPayloadDraftValue(payload, "pastConditions", currentDraftValues.draftPastConditions),
			vaccinationsUpToDate: getPayloadDraftValue(payload, "vaccinationsUpToDate", currentDraftValues.draftVaccinationsUpToDate),
			heartwormPreventionCurrent: getPayloadDraftValue(payload, "heartwormPreventionCurrent", currentDraftValues.draftHeartwormPreventionCurrent),
		};

		nextDraftPetValues.currentMedications = applyMedicationAutoCarry(nextSummaryValues, nextDraftPetValues);

		await conn.execute(
			`UPDATE appointment_summary
			 SET symptoms = ?,
				 diagnosis = ?,
				 medicationPrescribed = ?,
				 treatmentPerformed = ?,
				 notes = ?,
				 draftAllergies = ?,
				 draftCurrentMedications = ?,
				 draftMedicationHistory = ?,
				 draftCurrentConditions = ?,
				 draftPastConditions = ?,
				 draftVaccinationsUpToDate = ?,
				 draftHeartwormPreventionCurrent = ?
			 WHERE appointmentID = ?`,
			[
				nextSummaryValues.symptoms,
				nextSummaryValues.diagnosis,
				nextSummaryValues.medicationPrescribed,
				nextSummaryValues.treatmentPerformed,
				nextSummaryValues.notes,
				nextDraftPetValues.allergies,
				nextDraftPetValues.currentMedications,
				nextDraftPetValues.medicationHistory,
				nextDraftPetValues.currentConditions,
				nextDraftPetValues.pastConditions,
				nextDraftPetValues.vaccinationsUpToDate,
				nextDraftPetValues.heartwormPreventionCurrent,
				appointmentID,
			]
		);

		row.symptoms = nextSummaryValues.symptoms;
		row.diagnosis = nextSummaryValues.diagnosis;
		row.medicationPrescribed = nextSummaryValues.medicationPrescribed;
		row.treatmentPerformed = nextSummaryValues.treatmentPerformed;
		row.notes = nextSummaryValues.notes;
		row.draftAllergies = nextDraftPetValues.allergies;
		row.draftCurrentMedications = nextDraftPetValues.currentMedications;
		row.draftMedicationHistory = nextDraftPetValues.medicationHistory;
		row.draftCurrentConditions = nextDraftPetValues.currentConditions;
		row.draftPastConditions = nextDraftPetValues.pastConditions;
		row.draftVaccinationsUpToDate = nextDraftPetValues.vaccinationsUpToDate;
		row.draftHeartwormPreventionCurrent = nextDraftPetValues.heartwormPreventionCurrent;

		await conn.commit();
		return buildSummaryResponse(row);
	} catch (error) {
		try { await conn.rollback(); } catch {}
		throw error;
	} finally {
		conn.release();
	}
}

// Explicit finalization publishes the summary and sends the ready email
export async function finalizeSummary(sessionUserID, rawAppointmentID) {
	const appointmentID = parsePositiveInt(rawAppointmentID);
	if (!appointmentID) {
		const error = new Error("Invalid appointment id");
		error.status = 400;
		throw error;
	}

	const conn = await pool.getConnection();

	try {
		const staffContext = await getStaffContextByUserID(conn, sessionUserID);
		let row = await loadStaffAppointmentContext(conn, staffContext.staffID, appointmentID);

		await conn.beginTransaction();
		await ensureSummaryRow(conn, row);
		await maybeAutoFinalizeSummary(conn, row);

		if (!row.isFinalized) {
			const summaryState = getEditWindowState(row.date, row.durationMinutes, Boolean(row.isFinalized));
			if (!summaryState.canFinalizeNow) {
				const error = new Error("This summary cannot be finalized before the appointment starts");
				error.status = 403;
				throw error;
			}

			await finalizeSummaryInsideTransaction(conn, row, staffContext.staffID, true);
		}

		await conn.commit();
		return buildSummaryResponse(row);
	} catch (error) {
		try { await conn.rollback(); } catch {}
		throw error;
	} finally {
		conn.release();
	}
}

// Customer can only see the summary after it is finalized
export async function getCustomerSummary(sessionUserID, rawAppointmentID) {
	const appointmentID = parsePositiveInt(rawAppointmentID);
	if (!appointmentID) {
		const error = new Error("Invalid appointment id");
		error.status = 400;
		throw error;
	}

	const conn = await pool.getConnection();

	try {
		let row = await loadCustomerAppointmentContext(conn, sessionUserID, appointmentID);

		await conn.beginTransaction();
		await ensureSummaryRow(conn, row);
		await maybeAutoFinalizeSummary(conn, row);

		if (!row.isFinalized) {
			const error = new Error("This summary is not ready yet");
			error.status = 403;
			throw error;
		}

		await conn.commit();
		return buildSummaryResponse(row);
	} catch (error) {
		try { await conn.rollback(); } catch {}
		throw error;
	} finally {
		conn.release();
	}
}

// Follow-up prefill can use draft pet values before the summary is finalized
export async function getFollowUpPrefill(sessionUserID, rawAppointmentID) {
	const appointmentID = parsePositiveInt(rawAppointmentID);
	if (!appointmentID) {
		const error = new Error("Invalid appointment id");
		error.status = 400;
		throw error;
	}

	const conn = await pool.getConnection();

	try {
		const staffContext = await getStaffContextByUserID(conn, sessionUserID);
		let row = await loadStaffAppointmentContext(conn, staffContext.staffID, appointmentID);

		await conn.beginTransaction();
		await ensureSummaryRow(conn, row);
		await maybeAutoFinalizeSummary(conn, row);
		await conn.commit();

		return buildFollowUpPrefillResponse(row);
	} catch (error) {
		try { await conn.rollback(); } catch {}
		throw error;
	} finally {
		conn.release();
	}
}