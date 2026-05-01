import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
	createFollowUpAppointment,
	finalizeStaffAppointmentSummary,
	getStaffAppointmentSummary,
	saveStaffAppointmentSummary,
} from "../../api/appointmentSummary";
import { getAvailability } from "../../api/reservations";
import type {
	AppointmentSummaryDraftPayload,
	DraftPetProfile,
	StaffAppointmentSummaryResponse,
	SummarySaveStatus,
} from "../../types/appointmentSummary";
import type { AvailableSlot, ReasonKey } from "../../types/reservation";
import { REASON_OPTIONS } from "../../types/reservation";
import SlotCalendar from "../../components/calendar/SlotCalendar";
import "../../styles/appointmentSummary.css";
import style1 from "../../assets/groomingStyles/style1.jpg";
import style2 from "../../assets/groomingStyles/style2.webp";
import style3 from "../../assets/groomingStyles/style3.webp";
import style4 from "../../assets/groomingStyles/style4.webp";
import style5 from "../../assets/groomingStyles/style5.webp";
import style6 from "../../assets/groomingStyles/style6.webp";
import style7 from "../../assets/groomingStyles/style7.webp";
import style8 from "../../assets/groomingStyles/style8.jpg";
import style9 from "../../assets/groomingStyles/style9.jpg";
import style10 from "../../assets/groomingStyles/style10.jpg";

// How long staff has to stop typing before autosave runs
const SAVE_DELAY_MS = 700;
const VACCINATION_OPTIONS = ["Yes", "No", "Unsure"];
const HEARTWORM_OPTIONS = ["Yes", "No", "Unsure", "NotApplicable"];

const GROOMING_DYE_STYLE_IMAGES: Record<string, string> = {
	STYLE_1: style1,
	STYLE_2: style2,
	STYLE_3: style3,
	STYLE_4: style4,
	STYLE_5: style5,
	STYLE_6: style6,
	STYLE_7: style7,
	STYLE_8: style8,
	STYLE_9: style9,
	STYLE_10: style10,
};

// Safe blank values for the editable pet profile form before backend data loads
const EMPTY_DRAFT_PET_PROFILE: DraftPetProfile = {
	allergies: "",
	currentMedications: "",
	medicationHistory: "",
	currentConditions: "",
	pastConditions: "",
	vaccinationsUpToDate: "",
	heartwormPreventionCurrent: "",
};

// Safe blank values for the editable summary form before backend data loads
const EMPTY_SUMMARY_VALUES = {
	symptoms: "",
	diagnosis: "",
	medicationPrescribed: "",
	treatmentPerformed: "",
	notes: "",
};

function formatDateTime(value: string | null) {
	if (!value) return "";

	const date = new Date(value);

	// If JavaScript cannot read the date, show the original backend value instead of Invalid Date
	if (Number.isNaN(date.getTime())) return value;

	return date.toLocaleString("en-US", {
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

function formatReasonLabel(reasonKey: string) {
	// Turns WELLNESS_EXAM into WELLNESS EXAM for display
	return String(reasonKey || "").replaceAll("_", " ");
}

function isGroomingReason(reasonKey: string) {
	// Normalizes the reason so lowercase or weird casing still matches correctly
	return ["BASIC_GROOMING", "FLEA_BATH_GROOMING", "GROOMING_DYE"].includes(String(reasonKey || "").toUpperCase());
}

function getGroomingImagePath(summaryData: StaffAppointmentSummaryResponse) {
	const referencePhotoPath = summaryData.appointment.groomingReferencePhotoPath;

	// A real uploaded reference photo takes priority over the preset style image
	if (referencePhotoPath) return referencePhotoPath;

	const styleKey = String(summaryData.appointment.groomingDyeStyleKey || "").toUpperCase();
	return GROOMING_DYE_STYLE_IMAGES[styleKey] || "";
}

function buildDraftPayload(draftSummaryValues: typeof EMPTY_SUMMARY_VALUES, draftPetProfile: DraftPetProfile): AppointmentSummaryDraftPayload {
	// Builds the exact object the backend save route expects
	return {
		symptoms: draftSummaryValues.symptoms,
		diagnosis: draftSummaryValues.diagnosis,
		medicationPrescribed: draftSummaryValues.medicationPrescribed,
		treatmentPerformed: draftSummaryValues.treatmentPerformed,
		notes: draftSummaryValues.notes,
		draftPetProfile,
	};
}

function DetailItem({ label, value }: { label: string; value: string | number | null }) {
	return (
		<div className="appointmentSummaryDetailItem">
			<span className="appointmentSummaryDetailLabel">{label}</span>
			<span className="appointmentSummaryDetailValue">{value || "N/A"}</span>
		</div>
	);
}

export default function AppointmentSummary() {
	const { appointmentID: appointmentIDParam } = useParams();
	const appointmentID = Number(appointmentIDParam);

	// Page loading and page-level backend error state
	const [loading, setLoading] = useState(true);
	const [pageError, setPageError] = useState("");

	// Full backend response for this appointment summary page
	const [summaryData, setSummaryData] = useState<StaffAppointmentSummaryResponse | null>(null);

	// Editable copies of the backend values that the form inputs actually use
	const [draftSummaryValues, setDraftSummaryValues] = useState(EMPTY_SUMMARY_VALUES);
	const [draftPetProfile, setDraftPetProfile] = useState<DraftPetProfile>(EMPTY_DRAFT_PET_PROFILE);

	// Save/finalize/follow-up UI state
	const [saveStatus, setSaveStatus] = useState<SummarySaveStatus>("idle");
	const [saveError, setSaveError] = useState("");
	const [finalizing, setFinalizing] = useState(false);
	const [followUpLoading, setFollowUpLoading] = useState(false);
	const [followUpMessage, setFollowUpMessage] = useState("");
	const [followUpReasonKey, setFollowUpReasonKey] = useState<ReasonKey | "">("");
	const [followUpSlots, setFollowUpSlots] = useState<AvailableSlot[]>([]);
	const [followUpSelectedSlotId, setFollowUpSelectedSlotId] = useState("");
	const [followUpDate, setFollowUpDate] = useState("");
	const [followUpStartTime, setFollowUpStartTime] = useState("");

	// This tells autosave not to run while the first backend load is filling the form
	const hasLoadedRef = useRef(false);

	// Stores the current autosave timer id so the old timer can be cancelled when staff keeps typing
	const saveTimerRef = useRef<number | null>(null);

	useEffect(() => {
		if (!Number.isInteger(appointmentID) || appointmentID < 1) {
			setLoading(false);
			setPageError("Invalid appointment id");
			return;
		}

		let cancelled = false;

		async function loadSummary() {
			try {
				setLoading(true);
				setPageError("");

				// Load the backend summary response for this appointment
				const result = await getStaffAppointmentSummary(appointmentID);

				// If the page changed or unmounted while waiting, ignore this old response
				if (cancelled) return;

				setSummaryData(result);

				// Copy only the editable summary fields into the form state
				setDraftSummaryValues({
					symptoms: result.summary.symptoms,
					diagnosis: result.summary.diagnosis,
					medicationPrescribed: result.summary.medicationPrescribed,
					treatmentPerformed: result.summary.treatmentPerformed,
					notes: result.summary.notes,
				});

				// Copy the editable pet profile draft into its own form state
				setDraftPetProfile({ ...result.draftPetProfile });

				// Initial load is done, so later form changes are allowed to autosave
				hasLoadedRef.current = true;
			} catch (error) {
				if (!cancelled) setPageError(error instanceof Error ? error.message : "Failed to load appointment summary");
			} finally {
				if (!cancelled) setLoading(false);
			}
		}

		loadSummary();

		return () => {
			// Mark this effect as old so any unfinished load does not update this page
			cancelled = true;

			// Cancel any pending autosave when leaving this appointment summary page
			if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
		};
	}, [appointmentID]);

	// Memoized values avoid recalculating this display logic unless summaryData changes
	const groomingAppointment = useMemo(() => isGroomingReason(summaryData?.appointment.reasonKey || ""), [summaryData]);
	const groomingImagePath = useMemo(() => (summaryData ? getGroomingImagePath(summaryData) : ""), [summaryData]);

	// Staff can only edit or finalize when the backend says the appointment is in the right state
	const canEdit = Boolean(summaryData && !summaryData.summary.isFinalized && summaryData.state.isEditableNow);
	const canFinalize = Boolean(summaryData && !summaryData.summary.isFinalized && summaryData.state.canFinalizeNow);
	const followUpAlreadyCreated = Boolean(summaryData?.appointment.followUpAppointmentID);
	const canCreateFollowUp = Boolean(summaryData && summaryData.state.isEditableNow && !followUpAlreadyCreated);

	useEffect(() => {
		// Do not autosave until data exists, the first load finished, and editing is allowed
		if (!summaryData || !hasLoadedRef.current || !canEdit) return;

		// The user typed again, so cancel the old pending autosave before starting a new one
		if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);

		setSaveStatus("saving");
		setSaveError("");

		// Wait a little after typing stops, then save the newest draft values
		saveTimerRef.current = window.setTimeout(async () => {
			try {
				const result = await saveStaffAppointmentSummary(summaryData.appointment.appointmentID, buildDraftPayload(draftSummaryValues, draftPetProfile));

				// Refresh backend data and form drafts from the saved result
				setSummaryData(result);
				setDraftSummaryValues({
					symptoms: result.summary.symptoms,
					diagnosis: result.summary.diagnosis,
					medicationPrescribed: result.summary.medicationPrescribed,
					treatmentPerformed: result.summary.treatmentPerformed,
					notes: result.summary.notes,
				});
				setDraftPetProfile({ ...result.draftPetProfile });
				setSaveStatus("saved");
			} catch (error) {
				setSaveStatus("error");
				setSaveError(error instanceof Error ? error.message : "Failed to save summary");
			}
		}, SAVE_DELAY_MS);

		return () => {
			// If the draft changes again before the delay ends, cancel this save and let the next effect start a new one
			if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
		};
	}, [summaryData, draftSummaryValues, draftPetProfile, canEdit]);

	
	useEffect(() => {
		if (!summaryData || !followUpReasonKey || !canCreateFollowUp) {
			setFollowUpSlots([]);
			setFollowUpSelectedSlotId("");
			setFollowUpDate("");
			setFollowUpStartTime("");
			return;
		}

		let cancelled = false;

		async function loadFollowUpSlots() {
			try {
				const result = await getAvailability({
					reasonKey: followUpReasonKey as ReasonKey,
					userID: summaryData!.owner.userID,
					petID: summaryData!.appointment.petID,
					days: 90,
				});

				if (cancelled) return;
				setFollowUpSlots(result.slots || []);
			} catch (error) {
				if (cancelled) return;
				setFollowUpSlots([]);
				setFollowUpMessage(error instanceof Error ? error.message : "Failed to load follow-up slots");
			}
		}

		loadFollowUpSlots();

		return () => {
			cancelled = true;
		};
	}, [summaryData, followUpReasonKey, canCreateFollowUp]);

function updateSummaryField(field: keyof typeof EMPTY_SUMMARY_VALUES, value: string) {
		// Keep the other summary fields the same and replace only the field that changed
		setDraftSummaryValues((prev) => ({ ...prev, [field]: value }));
	}

	function updateDraftPetField(field: keyof DraftPetProfile, value: string) {
		// Keep the other pet profile draft fields the same and replace only the field that changed
		setDraftPetProfile((prev) => ({ ...prev, [field]: value }));
	}

	
	function handleFollowUpReasonChange(value: string) {
		setFollowUpReasonKey(value as ReasonKey | "");
		setFollowUpSelectedSlotId("");
		setFollowUpDate("");
		setFollowUpStartTime("");
		setFollowUpMessage("");
	}

	function handleFollowUpSlotSelect(value: { date: string; startTime: string; slotId?: string }) {
		setFollowUpSelectedSlotId(value.slotId || "");
		setFollowUpDate(value.date);
		setFollowUpStartTime(value.startTime);
		setFollowUpMessage("");
	}

async function handleFinalize() {
		if (!summaryData || !canFinalize) return;

		try {
			setFinalizing(true);
			setPageError("");

			// Ask the backend to lock the summary and return the updated summary data
			const result = await finalizeStaffAppointmentSummary(summaryData.appointment.appointmentID);
			setSummaryData(result);

			// Keep the disabled form showing whatever the backend says is now finalized
			setDraftSummaryValues({
				symptoms: result.summary.symptoms,
				diagnosis: result.summary.diagnosis,
				medicationPrescribed: result.summary.medicationPrescribed,
				treatmentPerformed: result.summary.treatmentPerformed,
				notes: result.summary.notes,
			});
			setDraftPetProfile({ ...result.draftPetProfile });
			setSaveStatus("saved");
		} catch (error) {
			setPageError(error instanceof Error ? error.message : "Failed to finalize summary");
		} finally {
			setFinalizing(false);
		}
	}

	async function handleCreateFollowUp() {
		if (!summaryData || !canCreateFollowUp) return;

		if (!followUpReasonKey || !followUpDate || !followUpStartTime) {
			setFollowUpMessage("Pick a follow-up reason and an available slot");
			return;
		}

		try {
			setFollowUpLoading(true);
			setFollowUpMessage("");

			const result = await createFollowUpAppointment(summaryData.appointment.appointmentID, {
				reasonKey: followUpReasonKey as ReasonKey,
				appointmentDate: followUpDate,
				startTime: followUpStartTime,
			});

			setSummaryData((prev) => prev ? {
				...prev,
				appointment: {
					...prev.appointment,
					followUpAppointmentID: result.followUpAppointmentID,
				},
			} : prev);
			setFollowUpMessage("Follow-up appointment created");
		} catch (error) {
			setFollowUpMessage(error instanceof Error ? error.message : "Failed to create follow-up appointment");
		} finally {
			setFollowUpLoading(false);
		}
	}

// Turns the save status enum into text and a matching CSS class
	const saveText = saveStatus === "idle" ? "Not saved yet" : saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "Save failed";
	const saveClass = `appointmentSummarySaveLine appointmentSummarySaveState${saveStatus.charAt(0).toUpperCase()}${saveStatus.slice(1)}`;

	if (loading) {
		return <div className="appointmentSummaryPage"><p>Loading...</p></div>;
	}

	if (pageError && !summaryData) {
		return (
			<div className="appointmentSummaryPage">
				<div className="appointmentSummaryError">{pageError}</div>
				<Link className="appointmentSummarySecondaryBtn appointmentSummaryLinkBtn" to="/staff/dashboard">Back to Dashboard</Link>
			</div>
		);
	}

	if (!summaryData) return null;

	return (
		<div className="appointmentSummaryPage">
			<div className="appointmentSummaryTopBar">
				<Link className="appointmentSummaryBackBtn" to="/staff/dashboard">Back to Dashboard</Link>
			</div>

			<div className="appointmentSummaryHeader">
				<div>
					<h1 className="appointmentSummaryTitle">Appointment Summary</h1>
					<p className="appointmentSummarySubtext">{summaryData.appointment.petName} — {formatReasonLabel(summaryData.appointment.reasonKey)}</p>
				</div>

				<div className="appointmentSummaryHeaderActions">
					<button type="button" className="appointmentSummaryPrimaryBtn" onClick={handleFinalize} disabled={!canFinalize || finalizing}>
						{finalizing ? "Finalizing..." : "Finalize Summary"}
					</button>
				</div>
			</div>

			<div className={saveClass}>{saveText}</div>
			{saveError ? <div className="appointmentSummaryInlineError">{saveError}</div> : null}
			{pageError ? <div className="appointmentSummaryInlineError">{pageError}</div> : null}

			<div className="appointmentSummaryTopGrid">
				<div className="appointmentSummaryCard">
					<h2>Appointment and Owner Details</h2>

					<div className="appointmentSummaryDetailsGrid">
						<DetailItem label="Appointment ID" value={summaryData.appointment.appointmentID} />
						<DetailItem label="Reason" value={formatReasonLabel(summaryData.appointment.reasonKey)} />
						<DetailItem label="Scheduled" value={formatDateTime(summaryData.appointment.date)} />
						<DetailItem label="Duration" value={`${summaryData.appointment.durationMinutes} minutes`} />
						<DetailItem label="Room" value={summaryData.appointment.roomNumber ?? "N/A"} />
						<DetailItem label="Pet Name" value={summaryData.appointment.petName} />
						<DetailItem label="Owner Name" value={`${summaryData.owner.legalFirstName} ${summaryData.owner.legalLastName}`.trim()} />
						<DetailItem label="Owner Email" value={summaryData.owner.email} />
					</div>

					<div className="appointmentSummaryStatusBox">
						<h3>Status</h3>
						<div className="appointmentSummaryStatusGrid">
							<DetailItem label="Appointment" value={summaryData.state.isOngoing ? "Ongoing" : "Ended"} />
							<DetailItem label="Summary" value={summaryData.summary.isFinalized ? "Finalized" : "Not Finalized"} />
							<DetailItem label="Edit Window" value={`${formatDateTime(summaryData.state.editStartsAt)} to ${formatDateTime(summaryData.state.editEndsAt)}`} />
							{summaryData.summary.finalizedAt ? <DetailItem label="Finalized At" value={formatDateTime(summaryData.summary.finalizedAt)} /> : null}
							{summaryData.summary.finalizedByStaffName ? <DetailItem label="Finalized By" value={summaryData.summary.finalizedByStaffName} /> : null}
						</div>
					</div>
				</div>

				<div className="appointmentSummaryCard">
					<h2>Mini Pet Profile Read Only</h2>
					<div className="appointmentSummaryMiniProfileGrid">
						<DetailItem label="Pet Name" value={summaryData.miniPetProfile.petName} />
						<DetailItem label="Type" value={summaryData.miniPetProfile.petType} />
						<DetailItem label="Breed" value={summaryData.miniPetProfile.breed} />
						<DetailItem label="Sex" value={summaryData.miniPetProfile.petSex} />
						<DetailItem label="Spayed / Neutered" value={summaryData.miniPetProfile.spayedNeutered} />
						<DetailItem label="Age" value={summaryData.miniPetProfile.age} />
						<DetailItem label="Current Medications" value={summaryData.miniPetProfile.currentMedications || "None"} />
						<DetailItem label="Medication History" value={summaryData.miniPetProfile.medicationHistory || "None"} />
						<DetailItem label="Allergies" value={summaryData.miniPetProfile.allergies || "None"} />
						<DetailItem label="Current Conditions" value={summaryData.miniPetProfile.currentConditions || "None"} />
						<DetailItem label="Past Conditions" value={summaryData.miniPetProfile.pastConditions || "None"} />
						<DetailItem label="Vaccinations Up To Date" value={summaryData.miniPetProfile.vaccinationsUpToDate || "N/A"} />
						<DetailItem label="Heartworm Prevention Current" value={summaryData.miniPetProfile.heartwormPreventionCurrent || "N/A"} />
					</div>
				</div>
			</div>

			{/* Grooming appointments only need the summary box, regular medical appointments also show pet profile draft updates */}
			<div className={groomingAppointment ? "appointmentSummaryWorkGrid appointmentSummaryWorkGridSingle" : "appointmentSummaryWorkGrid"}>
				<div className="appointmentSummaryCard">
					<h2>{groomingAppointment ? "Grooming Summary" : "Appointment Summary"}</h2>

					{groomingAppointment ? (
						<>
							{summaryData.appointment.groomingDyeStyleKey ? <div className="appointmentSummaryInfoBox"><b>Requested Style:</b> {summaryData.appointment.groomingDyeStyleKey}</div> : null}

							{groomingImagePath ? (
								<div className="appointmentSummaryImageWrap">
									<span className="appointmentSummaryLabel">{summaryData.appointment.groomingReferencePhotoPath ? "Reference Photo" : "Selected Preset Style"}</span>
									<img className="appointmentSummaryImage" src={groomingImagePath} alt="Grooming style reference" />
								</div>
							) : null}

							{summaryData.appointment.groomingStyleNotes ? <div className="appointmentSummaryInfoBox"><b>Customer Style Notes:</b> {summaryData.appointment.groomingStyleNotes}</div> : null}

							<label className="appointmentSummaryField">
								<span className="appointmentSummaryLabel">Treatment Performed</span>
								<textarea className="appointmentSummaryTextarea" value={draftSummaryValues.treatmentPerformed} onChange={(e) => updateSummaryField("treatmentPerformed", e.target.value)} rows={5} disabled={!canEdit} />
							</label>

							<label className="appointmentSummaryField">
								<span className="appointmentSummaryLabel">Notes</span>
								<textarea className="appointmentSummaryTextarea" value={draftSummaryValues.notes} onChange={(e) => updateSummaryField("notes", e.target.value)} rows={8} disabled={!canEdit} />
							</label>
						</>
					) : (
						<>
							<label className="appointmentSummaryField">
								<span className="appointmentSummaryLabel">Symptoms</span>
								<textarea className="appointmentSummaryTextarea" value={draftSummaryValues.symptoms} onChange={(e) => updateSummaryField("symptoms", e.target.value)} rows={4} disabled={!canEdit} />
							</label>

							<label className="appointmentSummaryField">
								<span className="appointmentSummaryLabel">Diagnosis</span>
								<textarea className="appointmentSummaryTextarea" value={draftSummaryValues.diagnosis} onChange={(e) => updateSummaryField("diagnosis", e.target.value)} rows={4} disabled={!canEdit} />
							</label>

							<label className="appointmentSummaryField">
								<span className="appointmentSummaryLabel">Medication Prescribed</span>
								<textarea className="appointmentSummaryTextarea" value={draftSummaryValues.medicationPrescribed} onChange={(e) => updateSummaryField("medicationPrescribed", e.target.value)} rows={4} disabled={!canEdit} />
							</label>

							<label className="appointmentSummaryField">
								<span className="appointmentSummaryLabel">Treatment Performed</span>
								<textarea className="appointmentSummaryTextarea" value={draftSummaryValues.treatmentPerformed} onChange={(e) => updateSummaryField("treatmentPerformed", e.target.value)} rows={4} disabled={!canEdit} />
							</label>

							<label className="appointmentSummaryField">
								<span className="appointmentSummaryLabel">Notes</span>
								<textarea className="appointmentSummaryTextarea" value={draftSummaryValues.notes} onChange={(e) => updateSummaryField("notes", e.target.value)} rows={6} disabled={!canEdit} />
							</label>

							<div className="appointmentSummaryInfoBox">
								Medication prescribed can carry into draft current medications
							</div>
						</>
					)}
				</div>

				{!groomingAppointment ? (
					<div className="appointmentSummaryCard">
						<h2>Draft Pet Profile Updates</h2>

						<label className="appointmentSummaryField">
							<span className="appointmentSummaryLabel">Current Medications</span>
							<textarea className="appointmentSummaryTextarea" value={draftPetProfile.currentMedications} onChange={(e) => updateDraftPetField("currentMedications", e.target.value)} rows={4} disabled={!canEdit} />
						</label>

						<label className="appointmentSummaryField">
							<span className="appointmentSummaryLabel">Medication History</span>
							<textarea className="appointmentSummaryTextarea" value={draftPetProfile.medicationHistory} onChange={(e) => updateDraftPetField("medicationHistory", e.target.value)} rows={4} disabled={!canEdit} />
						</label>

						<label className="appointmentSummaryField">
							<span className="appointmentSummaryLabel">Allergies</span>
							<textarea className="appointmentSummaryTextarea" value={draftPetProfile.allergies} onChange={(e) => updateDraftPetField("allergies", e.target.value)} rows={4} disabled={!canEdit} />
						</label>

						<label className="appointmentSummaryField">
							<span className="appointmentSummaryLabel">Current Conditions</span>
							<textarea className="appointmentSummaryTextarea" value={draftPetProfile.currentConditions} onChange={(e) => updateDraftPetField("currentConditions", e.target.value)} rows={4} disabled={!canEdit} />
						</label>

						<label className="appointmentSummaryField">
							<span className="appointmentSummaryLabel">Past Conditions</span>
							<textarea className="appointmentSummaryTextarea" value={draftPetProfile.pastConditions} onChange={(e) => updateDraftPetField("pastConditions", e.target.value)} rows={4} disabled={!canEdit} />
						</label>

						<div className="appointmentSummaryDetailsGrid">
							<label className="appointmentSummaryField">
								<span className="appointmentSummaryLabel">Vaccinations Up To Date</span>
								<select className="appointmentSummarySelect" value={draftPetProfile.vaccinationsUpToDate} onChange={(e) => updateDraftPetField("vaccinationsUpToDate", e.target.value)} disabled={!canEdit}>
									<option value="">Select</option>
									{VACCINATION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
								</select>
							</label>

							<label className="appointmentSummaryField">
								<span className="appointmentSummaryLabel">Heartworm Prevention Current</span>
								<select className="appointmentSummarySelect" value={draftPetProfile.heartwormPreventionCurrent} onChange={(e) => updateDraftPetField("heartwormPreventionCurrent", e.target.value)} disabled={!canEdit}>
									<option value="">Select</option>
									{HEARTWORM_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
								</select>
							</label>
						</div>
					</div>
				) : null}
			</div>

			<div className="appointmentSummarySection">
				<h2>Follow-Up</h2>
				<div className="appointmentSummaryFollowUpBox">
					<label className="appointmentSummaryField">
						<span className="appointmentSummaryLabel">Follow-Up Reason</span>
						<select className="appointmentSummarySelect" value={followUpReasonKey} onChange={(e) => handleFollowUpReasonChange(e.target.value)} disabled={!canCreateFollowUp || followUpLoading}>
							<option value="">Select</option>
							{REASON_OPTIONS.filter((option) => option.value !== "GROOMING_DYE").map((option) => (
								<option key={option.value} value={option.value}>{option.label}</option>
							))}
						</select>
					</label>

					{followUpReasonKey ? (
						<div className="appointmentSummaryFollowUpCalendar">
							<SlotCalendar
								slots={followUpSlots}
								value={followUpDate && followUpStartTime ? { date: followUpDate, startTime: followUpStartTime, slotId: followUpSelectedSlotId } : null}
								onSelectSlot={handleFollowUpSlotSelect}
								isLoading={followUpLoading}
								errorText=""
							/>
						</div>
					) : null}

					{followUpMessage ? <div className="appointmentSummaryMessage">{followUpMessage}</div> : null}

					<div className="appointmentSummaryBottomActions">
						<button
							type="button"
							className="appointmentSummarySecondaryBtn"
							onClick={handleCreateFollowUp}
							disabled={!canCreateFollowUp || followUpLoading || !followUpReasonKey || !followUpDate || !followUpStartTime}
						>
							{followUpAlreadyCreated ? "Follow-Up Created" : followUpLoading ? "Creating..." : "Create Follow-Up"}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
