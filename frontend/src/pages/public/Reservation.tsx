import { useEffect, useMemo, useState, type ChangeEvent, type KeyboardEvent } from "react";
import "../../styles/reservation.css";
import {
	INITIAL_RESERVATION_FORM,
	REASON_OPTIONS,
	type AvailableSlot,
	type CurrentUser,
	type PetProfile,
	type ReasonKey,
	type ReservationFormData,
	type ReservationFormErrors,
} from "../../types/reservation";
import OwnerDetailsStep from "../../components/reservation/OwnerDetailsStep";
import PetInformationStep from "../../components/reservation/PetInformationStep";
import MedicalHistoryStep from "../../components/reservation/MedicalHistoryStep";
import InsuranceStep from "../../components/reservation/InsuranceStep";
import ReviewConfirmStep from "../../components/reservation/ReviewConfirmStep";

import SlotCalendar from "../../components/calendar/SlotCalendar";

import { getCurrentUser } from "../../api/auth";
import { createReservation, getAvailability, getPetsForUser, getReservationProfile } from "../../api/reservations";

type Step = {
	id: string;
	title: string;
};

// reservation form sections shown in the progress bar
// step.id is used to decide which JSX block renders below
const STEPS: Step[] = [
	{ id: "owner", title: "Owner" },
	{ id: "pet", title: "Pet" },
	{ id: "medical", title: "Medical" },
	{ id: "appointment", title: "Appointment" },
	{ id: "insurance", title: "Insurance" },
	{ id: "review", title: "Review" },
];

function isBlank(v: string) {
	return !v || v.trim() === "";
}

function is2LetterState(v: string) {
	return /^[A-Za-z]{2}$/.test(v.trim());
}

function isZip(v: string) {
	return /^\d{5}(-\d{4})?$/.test(v.trim());
}

// accepts common US-style phone formats:
//  5125551234
//  (512) 555-1234
//  512-555-1234
//  +1 512 555 1234
function isPhone(v: string) {
	return /^\+?\d[\d\s().-]{7,}$/.test(v.trim());
}

function labelForReason(reasonKey: ReasonKey | "") {
	if (!reasonKey) return "—";
	const opt = REASON_OPTIONS.find((o) => o.value === reasonKey);
	return opt ? opt.label : reasonKey;
}

export default function Reservation() {
	// current logged-in user
	// loaded from GET /api/auth/me (getCurrentUser)
	// used for:
	//  userID in requests
	//  email shown in Owner section (readOnly input)
	const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

	// guards the initial auth request
	// while true, the UI shows Loading...
	const [isLoadingUser, setIsLoadingUser] = useState(true);

	// error message for GET /api/auth/me failures
	// shown if user is not authenticated or backend is unreachable
	const [userLoadError, setUserLoadError] = useState<string>("");

	// list of saved pets for the logged in user
	// loaded from GET /api/reservations/pets?userID=#
	// used to populate the dropdown in PetInformationStep
	const [pets, setPets] = useState<PetProfile[]>([]);

	// selected saved pet id
	// null means "new pet / not saved"
	// when a saved pet is selected, pet fields are autofilled into formData
	const [selectedPetId, setSelectedPetId] = useState<number | null>(null);

	// all reservation form input values live here
	// each form section reads and writes to this object
	const [formData, setFormData] = useState<ReservationFormData>(INITIAL_RESERVATION_FORM);

	// validation errors keyed by form field name
	// each validateX() function returns an object that gets set here
	const [errors, setErrors] = useState<ReservationFormErrors>({});

	// current section index inside STEPS
	// changing this changes which section is rendered
	const [stepIndex, setStepIndex] = useState(0);

	// highest step the user has successfully reached so far
	// used to decide which future steps can be clicked directly
	const [furthestReachedStepIndex, setFurthestReachedStepIndex] = useState(0);

	// derived current step object
	// used for:
	//  rendering the correct section JSX
	//  rendering progress text
	const step = STEPS[stepIndex];

	// available time slots returned by the backend
	// loaded from GET /api/reservations/availability?reasonKey=...&userID=...&days=...
	const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);

	// while true, the slot calendar shows a loading state
	const [slotsLoading, setSlotsLoading] = useState(false);

	// error message for slot fetch
	// shown inside the slot calendar area
	const [slotsError, setSlotsError] = useState<string>("");

	// UI-only identifier of the selected slot
	// this is NOT submitted to the backend
	// when selectedSlotId changes, the code writes slot.date + slot.startTime into formData
	const [selectedSlotId, setSelectedSlotId] = useState<string>("");

	// submission state for POST /api/reservations/book
	const [isSubmitting, setIsSubmitting] = useState(false);

	// turns true after a successful submit
	// used to:
	//  lock out Back/Next buttons
	//  show "Create New Appointment" button
	const [isSubmitted, setIsSubmitted] = useState(false);

	// user-visible submit result message
	// either a success message or an error message string
	const [submitMessage, setSubmitMessage] = useState<string>("");

	// EFFECT 1
	// loads the current logged-in user once when the page mounts
	// alive is a cancellation flag:
	//  if the component unmounts before the async request finishes,
	//  alive becomes false, and we skip setState calls
	//  this avoids React warnings about updating state on an unmounted component
	useEffect(() => {
		let alive = true;

		(async () => {
			try {
				setIsLoadingUser(true);
				setUserLoadError("");

				const me = await getCurrentUser();
				if (!alive) return;

				setCurrentUser(me);

				// email is tied to the account
				// this mirrors it into the form so the Owner section can display it
				setFormData((prev) => ({ ...prev, email: me.email }));
			} catch (err: any) {
				if (!alive) return;
				setUserLoadError(err?.message || "failed to load current user");
			} finally {
				if (!alive) return;
				setIsLoadingUser(false);
			}
		})();

		return () => {
			alive = false;
		};
	}, []);

	// EFFECT 2
	// after currentUser is known, pull the saved reservation profile + saved pets
	// profile is used to prefill contact fields (owner section)
	// pets are used for the pet dropdown (pet section)
	// alive is the same cancellation flag pattern as above
	useEffect(() => {
		let alive = true;

		(async () => {
			if (!currentUser) return;

			// GET /api/reservations/profile?userID=#
			try {
				const profile = await getReservationProfile(currentUser.userID);
				if (!alive) return;

				setFormData((prev) => ({
					...prev,

					// only fill blanks
					// if the user typed something already, keep their edits
					legalFirstName: isBlank(prev.legalFirstName) ? profile.legalFirstName : prev.legalFirstName,
					legalLastName: isBlank(prev.legalLastName) ? profile.legalLastName : prev.legalLastName,
					phone: isBlank(prev.phone) ? profile.phone : prev.phone,
					addressLine1: isBlank(prev.addressLine1) ? profile.addressLine1 : prev.addressLine1,
					city: isBlank(prev.city) ? profile.city : prev.city,
					state: isBlank(prev.state) ? profile.state : prev.state,
					zipCode: isBlank(prev.zipCode) ? profile.zipCode : prev.zipCode,

					// keep auth email as the source of truth
					email: currentUser.email,
				}));
			} catch {
				// profile is optional
				// if it fails, the form still works, it just stays blank
			}

			// GET /api/reservations/pets?userID=#
			try {
				const list = await getPetsForUser(currentUser.userID);
				if (!alive) return;
				setPets(list);
			} catch {
				// pets are optional
				// if it fails, the Pet section still works with "New pet"
			}
		})();

		return () => {
			alive = false;
		};
	}, [currentUser?.userID]);

	// EFFECT 3
	// when a reason is selected, fetch availability slots for that reason
	// alive is the cancellation flag pattern again
	useEffect(() => {
		let alive = true;

		(async () => {
			if (!currentUser) return;
			if (!formData.reasonKey) return;

			setSlotsLoading(true);
			setSlotsError("");

			try {
				const resp = await getAvailability({
					reasonKey: formData.reasonKey as ReasonKey,
					userID: currentUser.userID,
					days: 90,
				});
				if (!alive) return;
				setAvailableSlots(resp.slots || []);
			} catch (err: any) {
				if (!alive) return;
				setAvailableSlots([]);
				setSlotsError(err?.message || "failed to fetch availability");
			} finally {
				if (!alive) return;
				setSlotsLoading(false);
			}
		})();

		return () => {
			alive = false;
		};
	}, [currentUser?.userID, formData.reasonKey]);

	// clears errors[field] when the user edits that field again
	function clearFieldError<K extends keyof ReservationFormData>(field: K) {
		setErrors((prev) => {
			if (!prev[field]) return prev;
			const next = { ...prev };
			delete next[field];
			return next;
		});
	}

	// updates one field in formData and removes its error
	function onFieldChange<K extends keyof ReservationFormData>(field: K, value: ReservationFormData[K]) {
		setFormData((prev) => ({ ...prev, [field]: value }));
		clearFieldError(field);
	}

	// shared change handler for inputs/selects/textareas
	// input name must match a key in ReservationFormData
	function onInputChange(e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
		const { name, value, type } = e.target;

		if (type === "checkbox") {
			const checked = (e.target as HTMLInputElement).checked;
			onFieldChange(name as keyof ReservationFormData, checked as any);
			return;
		}

		onFieldChange(name as keyof ReservationFormData, value as any);
	}

	// selects a saved pet or "new pet"
	// saved pet selection fills both pet fields and medical history fields
	function onSelectPet(petID: number | null) {
		setSelectedPetId(petID);

		if (petID === null) {
			// reset pet-related fields to blank for a new pet entry
			setFormData((prev) => ({
				...prev,
				petName: "",
				petType: "",
				breed: "",
				petSex: "",
				spayedNeutered: "",
				petAge: "",
				currentMedications: "",
				knownAllergies: "",
				pastInjuriesConditions: "",
				vaccinationsUpToDate: "",
				heartwormPreventionCurrent: "",
			}));
			return;
		}

		const p = pets.find((x) => x.petID === petID);
		if (!p) return;

		setFormData((prev) => ({
			...prev,
			petName: p.petName || "",
			petType: p.petType || "",
			breed: p.breed || "",
			petSex: p.petSex || "",
			spayedNeutered: p.spayedNeutered || "",
			petAge: p.age === null ? "" : String(p.age),
			currentMedications: p.currentMedications || "",
			knownAllergies: p.knownAllergies || "",
			pastInjuriesConditions: p.pastInjuriesConditions || "",
			vaccinationsUpToDate: p.vaccinationsUpToDate || "",
			heartwormPreventionCurrent: p.heartwormPreventionCurrent || "",
		}));
	}

	// resets slot selection when the reason changes
	// reasonKey drives which slot list is fetched from the backend
	function onReasonChange(nextReason: ReasonKey | "") {
		setSelectedSlotId("");
		setAvailableSlots([]);

		setFormData((prev) => ({
			...prev,
			reasonKey: nextReason,
			appointmentDate: "",
			startTime: "",
		}));

		// clear reason/slot errors since the user is making a new selection
		setErrors((prev) => {
			const next = { ...prev };
			delete next.reasonKey;
			delete next.appointmentDate;
			delete next.startTime;
			return next;
		});
	}

	// if the user clicks a different date after already picking a time,
	// that old time should no longer count for the new date
	function onCalendarDateChange(nextDate: string) {
		setSelectedSlotId("");

		setFormData((prev) => ({
			...prev,
			appointmentDate: nextDate,
			startTime: "",
		}));

		clearFieldError("appointmentDate");
		clearFieldError("startTime");
	}

	// stores slotId for the calendar, but writes slot data into formData
	// backend submit uses appointmentDate + startTime, not slotId
	function onSlotSelect(value: { date: string; startTime: string; slotId?: string }) {
		setSelectedSlotId(value.slotId || "");

		setFormData((prev) => ({
			...prev,
			appointmentDate: value.date,
			startTime: value.startTime,
		}));

		clearFieldError("appointmentDate");
		clearFieldError("startTime");
	}

	// validation helpers
	// each one returns an object where keys are fields and values are error messages
	function validateOwner(data: ReservationFormData) {
		const e: ReservationFormErrors = {};

		if (isBlank(data.legalFirstName)) e.legalFirstName = "required";
		if (isBlank(data.legalLastName)) e.legalLastName = "required";
		if (isBlank(data.email)) e.email = "required";

		if (isBlank(data.phone)) e.phone = "required";
		else if (!isPhone(data.phone)) e.phone = "invalid phone";

		if (isBlank(data.addressLine1)) e.addressLine1 = "required";
		if (isBlank(data.city)) e.city = "required";

		if (isBlank(data.state)) e.state = "required";
		else if (!is2LetterState(data.state)) e.state = "use 2 letter state";

		if (isBlank(data.zipCode)) e.zipCode = "required";
		else if (!isZip(data.zipCode)) e.zipCode = "invalid zip";

		return e;
	}

	function validatePet(data: ReservationFormData) {
		const e: ReservationFormErrors = {};

		if (isBlank(data.petName)) e.petName = "required";
		if (isBlank(data.petType)) e.petType = "required";
		if (isBlank(data.breed)) e.breed = "required";
		if (isBlank(data.petSex)) e.petSex = "required";
		if (isBlank(data.spayedNeutered)) e.spayedNeutered = "required";

		if (isBlank(data.petAge)) {
			e.petAge = "required, enter a value from 0 to 120";
		} else {
			const n = Number(data.petAge);
			if (!Number.isFinite(n) || n < 0 || n > 120) {
				e.petAge = "enter an age from 0 to 120";
			}
		}

		return e;
	}

	function validateMedical(data: ReservationFormData) {
		const e: ReservationFormErrors = {};

		if (isBlank(data.pastInjuriesConditions)) e.pastInjuriesConditions = "required";
		if (isBlank(data.currentMedications)) e.currentMedications = "required";
		if (isBlank(data.knownAllergies)) e.knownAllergies = "required";
		if (isBlank(data.vaccinationsUpToDate)) e.vaccinationsUpToDate = "required";
		if (isBlank(data.heartwormPreventionCurrent)) e.heartwormPreventionCurrent = "required";

		return e;
	}

	function validateAppointment(data: ReservationFormData) {
		const e: ReservationFormErrors = {};

		if (!data.reasonKey) e.reasonKey = "required";
		if (isBlank(data.appointmentDate)) e.appointmentDate = "required";
		if (isBlank(data.startTime)) e.startTime = "required";

		return e;
	}

	function validateInsurance(data: ReservationFormData) {
		const e: ReservationFormErrors = {};

		if (!isBlank(data.insuranceProvider) && data.insuranceProvider.trim().length > 120) {
			e.insuranceProvider = "too long";
		}

		if (!isBlank(data.insuranceMemberId) && data.insuranceMemberId.trim().length > 120) {
			e.insuranceMemberId = "too long";
		}

		return e;
	}

	function validateConsent(data: ReservationFormData) {
		const e: ReservationFormErrors = {};
		if (!data.consentToFormInfo) e.consentToFormInfo = "required";
		return e;
	}

	// runs validation for a specific step index
	// used by Next and also by step jumping when the user clicks the progress boxes
	function validateStepByIndex(index: number) {
		let e: ReservationFormErrors = {};

		if (STEPS[index].id === "owner") e = validateOwner(formData);
		else if (STEPS[index].id === "pet") e = validatePet(formData);
		else if (STEPS[index].id === "medical") e = validateMedical(formData);
		else if (STEPS[index].id === "appointment") e = validateAppointment(formData);
		else if (STEPS[index].id === "insurance") e = validateInsurance(formData);
		else if (STEPS[index].id === "review") e = validateConsent(formData);

		setErrors(e);
		return Object.keys(e).length === 0;
	}

	// runs validation only for the current section
	// called by Next and by Submit
	function validateCurrentStep() {
		return validateStepByIndex(stepIndex);
	}

	function goNext() {
		if (!validateCurrentStep()) return;

		setStepIndex((i) => {
			const next = Math.min(i + 1, STEPS.length - 1);
			setFurthestReachedStepIndex((prev) => Math.max(prev, next));
			return next;
		});
	}

	function goBack() {
		setStepIndex((i) => Math.max(i - 1, 0));
	}

	// lets the user click old/current steps freely
	// and jump forward only if each step in between validates successfully
	function goToStep(targetIndex: number) {
		if (isSubmitted) return;
		if (targetIndex === stepIndex) return;

		// moving backward is always okay
		if (targetIndex < stepIndex) {
			setStepIndex(targetIndex);
			return;
		}

		// if user is moving forward, validate every step in between
		for (let i = stepIndex; i < targetIndex; i++) {
			const valid = validateStepByIndex(i);
			if (!valid) {
				setStepIndex(i);
				return;
			}
		}

		setStepIndex(targetIndex);
		setFurthestReachedStepIndex((prev) => Math.max(prev, targetIndex));
	}

	function onStepKeyDown(e: KeyboardEvent<HTMLDivElement>, targetIndex: number) {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			goToStep(targetIndex);
		}
	}

	// sends the final booking request
	// payload includes:
	//  userID for ownership/linking
	//  reasonKey + appointmentDate + startTime for scheduling
	//  petID for saved pet selection (can be null)
	//  formData for storing the submitted form details
	async function onSubmit() {
		if (!currentUser) return;
		if (!validateCurrentStep()) return;

		setIsSubmitting(true);
		setSubmitMessage("");

		try {
			const payload = {
				userID: currentUser.userID,
				reasonKey: formData.reasonKey as ReasonKey,
				appointmentDate: formData.appointmentDate,
				startTime: formData.startTime,
				enablePetProfiles: true,
				petID: selectedPetId,
				formData,
			};

			const resp = await createReservation(payload);

			setIsSubmitted(true);
			setSubmitMessage(
				`Appointment confirmed for ${labelForReason(resp.reasonKey)} on ${resp.date} (${resp.durationMinutes} min).`
			);
		} catch (err: any) {
			setSubmitMessage(err?.message || "submission failed");
		} finally {
			setIsSubmitting(false);
		}
	}

	// clears appointment-specific state to allow another booking
	// keeps owner fields so the user does not re-enter contact info
	function onCreateNewAppointment() {
		setIsSubmitted(false);
		setSubmitMessage("");
		setStepIndex(0);
		setFurthestReachedStepIndex(0);
		setSelectedPetId(null);
		setSelectedSlotId("");
		setAvailableSlots([]);

		setErrors({});
		setFormData((prev) => ({
			...INITIAL_RESERVATION_FORM,
			email: prev.email,
			legalFirstName: prev.legalFirstName,
			legalLastName: prev.legalLastName,
			phone: prev.phone,
			addressLine1: prev.addressLine1,
			city: prev.city,
			state: prev.state,
			zipCode: prev.zipCode,
		}));
	}

	// UI text for the step progress line
	const progressText = useMemo(() => {
		return `Step ${stepIndex + 1} of ${STEPS.length}: ${step.title}`;
	}, [stepIndex, step.title]);

	if (isLoadingUser) {
		return (
			<div className="reservation-page">
				<h1>Make a Reservation</h1>
				<p>Loading...</p>
			</div>
		);
	}

	if (userLoadError) {
		return (
			<div className="reservation-page">
				<h1>Make a Reservation</h1>
				<p className="error-text">{userLoadError}</p>
			</div>
		);
	}

	if (!currentUser) {
		return (
			<div className="reservation-page">
				<h1>Make a Reservation</h1>
				<p className="error-text">not logged in</p>
			</div>
		);
	}

	return (
		<div className="reservation-page">
			<h1>Make a Reservation</h1>
			<p className="step-progress">{progressText}</p>

			<div className="step-indicator">
				{STEPS.map((s, idx) => {
					const isActive = idx === stepIndex;
					const isCompleted = idx < stepIndex;
					const canClick = !isSubmitted && (idx <= furthestReachedStepIndex || idx <= stepIndex + 1 || idx < stepIndex);

					return (
						<div
							key={s.id}
							className={`step ${isActive ? "active" : ""} ${isCompleted ? "completed" : ""} ${canClick ? "step-clickable" : ""}`}
							onClick={() => {
								if (canClick) goToStep(idx);
							}}
							onKeyDown={(e) => {
								if (canClick) onStepKeyDown(e, idx);
							}}
							role="button"
							tabIndex={canClick ? 0 : -1}
							aria-current={isActive ? "step" : undefined}
							aria-disabled={!canClick}
							title={canClick ? `Go to ${s.title}` : "Complete previous steps first"}
						>
							{s.title}
						</div>
					);
				})}
			</div>

			<div className="form-container">
				{step.id === "owner" ? (
					<OwnerDetailsStep formData={formData} errors={errors} onChange={onInputChange} />
				) : null}

				{step.id === "pet" ? (
					<PetInformationStep
						formData={formData}
						errors={errors}
						onChange={onInputChange}
						pets={pets}
						selectedPetId={selectedPetId}
						onSelectPet={onSelectPet}
					/>
				) : null}

				{step.id === "medical" ? (
					<MedicalHistoryStep formData={formData} errors={errors} onFieldChange={onFieldChange} />
				) : null}

				{step.id === "appointment" ? (
					<div>
						<h2>Appointment Details</h2>
						<p>Select a reason, then pick a highlighted date and time.</p>

						<div className="form-row">
							<label>Reason for visit</label>
							<select
								name="reasonKey"
								value={formData.reasonKey}
								onChange={(e) => onReasonChange(e.target.value as any)}
							>
								<option value="">Select a reason</option>
								{REASON_OPTIONS.map((opt) => (
									<option key={opt.value} value={opt.value}>
										{opt.label}
									</option>
								))}
							</select>
							{errors.reasonKey ? <p className="field-error">{errors.reasonKey}</p> : null}
						</div>

						<div className="form-row">
							<label>Available dates and times</label>

							{!formData.reasonKey ? (
								<div className="availability-placeholder">
									Select a reason first to load available dates and times.
								</div>
							) : (
								<SlotCalendar
									key={formData.reasonKey}
									slots={availableSlots}
									value={
										formData.appointmentDate && formData.startTime
											? {
													date: formData.appointmentDate,
													startTime: formData.startTime,
													slotId: selectedSlotId || undefined,
											  }
											: null
									}
									onSelectSlot={onSlotSelect}
									onBrowseDateChange={onCalendarDateChange}
									isLoading={slotsLoading}
									errorText={slotsError}
								/>
							)}

							{errors.startTime || errors.appointmentDate ? (
								<p className="field-error">select a time slot</p>
							) : null}
						</div>

						<div className="form-row">
							<label>Notes (optional)</label>
							<textarea
								name="reasonDetails"
								value={formData.reasonDetails}
								onChange={onInputChange}
								rows={4}
							/>
						</div>
					</div>
				) : null}

				{step.id === "insurance" ? (
					<InsuranceStep formData={formData} errors={errors} onFieldChange={onFieldChange} />
				) : null}

				{step.id === "review" ? (
					<ReviewConfirmStep
						formData={formData}
						errors={errors}
						onFieldChange={onFieldChange}
						onSubmit={onSubmit}
						isSubmitting={isSubmitting}
						isSubmitted={isSubmitted}
						submitMessage={submitMessage}
						onCreateNewAppointment={onCreateNewAppointment}
					/>
				) : null}

				<div className="navigation-buttons">
					{stepIndex > 0 && !isSubmitted ? (
						<button type="button" onClick={goBack} className="back-button">
							Back
						</button>
					) : null}

					{stepIndex < STEPS.length - 1 && !isSubmitted ? (
						<button type="button" onClick={goNext} className="next-button">
							Next
						</button>
					) : null}
				</div>
			</div>
		</div>
	);
}