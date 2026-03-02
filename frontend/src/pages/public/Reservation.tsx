import { useEffect, useMemo, useState } from "react";
import "../../styles/reservation.css";
import {
	INITIAL_RESERVATION_FORM,
	REASON_OPTIONS,
	type AvailabilityResponse,
	type AvailableSlot,
	type ReasonKey,
	type ReservationFormData,
	type ReservationFormErrors,
} from "../../types/reservation";
import OwnerDetailsStep from "../../components/reservation/OwnerDetailsStep";
import PetInformationStep from "../../components/reservation/PetInformationStep";
import MedicalHistoryStep from "../../components/reservation/MedicalHistoryStep";
import InsuranceStep from "../../components/reservation/InsuranceStep";
import ReviewConfirmStep from "../../components/reservation/ReviewConfirmStep";
import { createReservation, getAvailabilityByReason } from "../../api/reservations";


//type for rendering stepper UI. Denotes what the state of a form section is
type StepStatus = "complete" | "current" | "locked";

//type structure for each step in the navigation
type Step = {
	id: number;
	label: string;
};

//form is split into 6 steps, each step renders its own component based on which step user is on
const STEPS: Step[] = [
	{ id: 1, label: "Owner Details" },
	{ id: 2, label: "Pet Information" },
	{ id: 3, label: "Appointment" },
	{ id: 4, label: "Medical History" },
	{ id: 5, label: "Insurance" },
	{ id: 6, label: "Review & Confirm" },
];

//used for state validation in step 1
const US_STATE_CODES = [
	"AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
	"HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
	"MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
	"NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
	"SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

/**
 * DEV toggle:
 * true  bypass validations and backend availability fetch
 * false  normal production behavior
 */
const DEV_BYPASS_VALIDATION = false;

//determines the visual state of each form section navigation button
function getStepStatus(
	stepId: number,
	currentStep: number,
	furthestCompletedStep: number
): StepStatus {
	if (stepId === currentStep) return "current";
	if (stepId <= furthestCompletedStep) return "complete";
	return "locked";
}

//converts a date object into this format, YYYY-MM-DD, which the backend expects.
function formatDateForInput(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

//helper func that adds days to an existing date object. Used to create range of dates
//used when requesting availability from date range from backend.
function addDays(date: Date, days: number): Date {
	const next = new Date(date);
	next.setDate(next.getDate() + days);
	return next;
}

//basic email validation
function isValidEmail(emailRaw: string): boolean {
	const email = emailRaw.trim();
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

//phone number field validator and canonicalizer
//accepted inputs are exactly 10 digits or exactly ###-###-####
//if valid, returns and makes sure it's stored as ###-###-####. 
function canonicalizePhone(phoneRaw: string): { ok: boolean; formatted: string } {
	const raw = String(phoneRaw).trim();

	//only takes exactly 10 digits
	if (/^[0-9]{10}$/.test(raw)) {
		return {
			ok: true,
			formatted: `${raw.slice(0, 3)}-${raw.slice(3, 6)}-${raw.slice(6, 10)}`,
		};
	}

	//only takes string formatted exactly as ###-###-####
	if (/^[0-9]{3}-[0-9]{3}-[0-9]{4}$/.test(raw)) {
		const digits = raw.replace(/-/g, "");
		return {
			ok: true,
			formatted: `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`,
		};
	}

	return { ok: false, formatted: "" };
}

//validates zip code to 77777 or 77777+4 extra digit code
function isValidZip(zipRaw: string): boolean {
	const zip = zipRaw.trim();
	return /^\d{5}(-\d{4})?$/.test(zip);
}

//availability slotID has start/end times inside the string. So this pulls the startTime out of the 
//string. Parameter passed in strings look like slot_YYYY-MM-DD_HHMM_HHMM
//returns the first HHMM
function extractStartTimeFromSlotId(slotId: string): string {
	// expected: slot_YYYY-MM-DD_HHMM_HHMM
	const parts = String(slotId || "").split("_");
	if (parts.length < 4) return "";
	const hhmm = parts[2]; // start time segment
	if (!/^\d{4}$/.test(hhmm)) return "";
	return `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;
}



export default function Reservation() {
    //the step the user is currently on
	const [currentStep, setCurrentStep] = useState<number>(1);
	const [furthestCompletedStep, setFurthestCompletedStep] = useState<number>(1);

    //all form data lives in this one object, and each step edits its own relevant fields 
	const [formData, setFormData] = useState<ReservationFormData>(INITIAL_RESERVATION_FORM);

    //errors are stored per field, and are keyed by the field key.
	const [errors, setErrors] = useState<ReservationFormErrors>({});

    //these hold the availability responses from the backend for the Appointment Creation Step 
	const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
	const [availabilityLoading, setAvailabilityLoading] = useState<boolean>(false);
	const [availabilityError, setAvailabilityError] = useState<string>("");

    //submits state. this prevents double submits and lets us show submit message
	const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
	const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
	const [submitMessage, setSubmitMessage] = useState<string>("");

    //step bounds for next and previous buttons
	const canGoNext = useMemo(() => currentStep < STEPS.length, [currentStep]);
	const canGoPrev = useMemo(() => currentStep > 1, [currentStep]);

    //this component requests 90 days of availability from backend. So these are the date objects
	const today = useMemo(() => new Date(), []);
	const startDate = useMemo(() => formatDateForInput(today), [today]);
	const endDate = useMemo(() => formatDateForInput(addDays(today, 90)), [today]);

    // groups backend slots by date so we can populate the "date" dropdown first
	const slotsByDate = useMemo(() => {
		const map: Record<string, AvailableSlot[]> = {};
		if (!availability) return map;

		for (const slot of availability.slots) {
			if (!map[slot.date]) map[slot.date] = [];
			map[slot.date].push(slot);
		}
		return map;
	}, [availability]);

    //list of dates for date dropdown
	const availableDates = useMemo(
		() => Object.keys(slotsByDate).sort(),
		[slotsByDate]
	);

    //list of time slots for the currently selected date
	const currentDateSlots = useMemo(() => {
		if (!formData.appointmentDate) return [];
		return slotsByDate[formData.appointmentDate] || [];
	}, [formData.appointmentDate, slotsByDate]);

    //clears the appointment date/time selection whenever reason changes, or when no availability exists
	function clearAppointmentSelection() {
		setFormData((prev) => ({
			...prev,
			appointmentDate: "",
			appointmentTimeSlot: "",
		}));
	}

    //resets the entire form so a user can submit another appointment starting new from the beginning
	function resetReservationForm() {
		setFormData(INITIAL_RESERVATION_FORM);
		setErrors({});
		setAvailability(null);
		setAvailabilityError("");
		setAvailabilityLoading(false);
		setCurrentStep(1);
		setFurthestCompletedStep(1);
		setIsSubmitting(false);
		setIsSubmitted(false);
		setSubmitMessage("");
	}

    //calls backend to get availability for a given reason and date range
	async function fetchAvailabilityForReason(reasonKey: ReasonKey) {
		setAvailabilityLoading(true);
		setAvailabilityError("");

		try {
			const res = await getAvailabilityByReason({
				reasonKey,
				startDate,
				endDate,
			});
			setAvailability(res);
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Failed to load availability";
			setAvailabilityError(message);
			setAvailability(null);
		} finally {
			setAvailabilityLoading(false);
		}
	}

    //whenever "reason for visit" changes, re-fetches available slots from backend
	//also clears the old selected date and time so we don't let the user keep a stale date
	useEffect(() => {
		if (DEV_BYPASS_VALIDATION) {
			return;
		}

		if (!formData.reasonForVisit) {
			setAvailability(null);
			setAvailabilityError("");
			clearAppointmentSelection();
			return;
		}

		clearAppointmentSelection();
		fetchAvailabilityForReason(formData.reasonForVisit as ReasonKey);
	}, [formData.reasonForVisit]);

	function setField<K extends keyof ReservationFormData>(
		field: K,
		value: ReservationFormData[K]
	) {
		setFormData((prev) => ({ ...prev, [field]: value }));
		setErrors((prev) => ({ ...prev, [field]: "" }));
	}

	function validateStep1(): boolean {
		const nextErrors: ReservationFormErrors = {};

		if (!formData.legalFirstName.trim()) {
			nextErrors.legalFirstName = "First name is required.";
		}

		if (!formData.legalLastName.trim()) {
			nextErrors.legalLastName = "Last name is required.";
		}

		if (!formData.email.trim()) {
			nextErrors.email = "Email is required.";
		} else if (!isValidEmail(formData.email)) {
			nextErrors.email = "Please enter a valid email address.";
		}

        if (!formData.phone.trim()) {
            nextErrors.phone = "Phone number is required.";
        } else {
            const phone = canonicalizePhone(formData.phone);

            if (!phone.ok) {
                nextErrors.phone = "Phone number must be 10 digits (e.g. 7773334444 or 777-777-7777).";
            } else {
                //stores canonical format for consistency
                if (formData.phone !== phone.formatted) {
                    setFormData((prev) => ({ ...prev, phone: phone.formatted }));
                }
            }
}

		if (!formData.addressLine1.trim()) {
			nextErrors.addressLine1 = "Address line 1 is required.";
		}

		if (!formData.city.trim()) {
			nextErrors.city = "City is required.";
		}

		if (!formData.state.trim()) {
			nextErrors.state = "State is required.";
		} else if (!US_STATE_CODES.includes(formData.state)) {
			nextErrors.state = "Please select a valid state code.";
		}

		if (!formData.zipCode.trim()) {
			nextErrors.zipCode = "ZIP code is required.";
		} else if (!isValidZip(formData.zipCode)) {
			nextErrors.zipCode =
				"ZIP must be 5 digits or 5+4 format (e.g. 12345 or 12345-6789).";
		}

		setErrors((prev) => ({ ...prev, ...nextErrors }));
		return Object.keys(nextErrors).length === 0;
	}

	function validateStep2(): boolean {
		const nextErrors: ReservationFormErrors = {};

		if (!formData.petName.trim()) {
			nextErrors.petName = "Pet name is required.";
		}

		if (!formData.petType) {
			nextErrors.petType = "Pet type is required.";
		}

		if (!formData.breed.trim()) {
			nextErrors.breed = "Breed is required. If unknown, type 'Unknown'.";
		}

		if (!formData.petSex) {
			nextErrors.petSex = "Pet sex is required.";
		}

		if (!formData.spayedNeutered) {
			nextErrors.spayedNeutered = "Please select spayed/neutered status.";
		}

		if (formData.petAge === "") {
			nextErrors.petAge = "Pet age is required (best guess is okay).";
		} else if (
			typeof formData.petAge !== "number" ||
			Number.isNaN(formData.petAge)
		) {
			nextErrors.petAge = "Pet age must be a valid number.";
		} else if (formData.petAge < 0) {
			nextErrors.petAge = "Pet age cannot be negative.";
		} else if (formData.petAge > 80) {
			nextErrors.petAge = "Please enter a realistic pet age.";
		}

		setErrors((prev) => ({ ...prev, ...nextErrors }));
		return Object.keys(nextErrors).length === 0;
	}

	function validateStep3(): boolean {
		const nextErrors: ReservationFormErrors = {};

		if (!formData.reasonForVisit) {
			nextErrors.reasonForVisit = "Please select a reason for visit.";
		}
		if (!formData.appointmentDate) {
			nextErrors.appointmentDate = "Please select an appointment date.";
		}
		if (!formData.appointmentTimeSlot) {
			nextErrors.appointmentTimeSlot =
				"Please select an appointment time slot.";
		}

		setErrors((prev) => ({ ...prev, ...nextErrors }));
		return Object.keys(nextErrors).length === 0;
	}

	function validateStep4(): boolean {
		const nextErrors: ReservationFormErrors = {};

		const past = formData.pastInjuriesConditions.trim();
		const meds = formData.currentMedications.trim();
		const allergies = formData.knownAllergies.trim();

		if (!past) {
			nextErrors.pastInjuriesConditions =
				"Past injuries/conditions is required. Type 'None' if not applicable.";
		} else if (past.length > 500) {
			nextErrors.pastInjuriesConditions =
				"Past injuries/conditions must be 500 characters or fewer.";
		}

		if (!meds) {
			nextErrors.currentMedications =
				"Current medications is required. Type 'None' if not applicable.";
		} else if (meds.length > 500) {
			nextErrors.currentMedications =
				"Current medications must be 500 characters or fewer.";
		}

		if (!allergies) {
			nextErrors.knownAllergies =
				"Known allergies is required. Type 'None' if not applicable.";
		} else if (allergies.length > 500) {
			nextErrors.knownAllergies =
				"Known allergies must be 500 characters or fewer.";
		}

		if (!formData.vaccinationsUpToDate) {
			nextErrors.vaccinationsUpToDate = "Please select vaccination status.";
		}

		if (!formData.heartwormPreventionCurrent) {
			nextErrors.heartwormPreventionCurrent =
				"Please select heartworm prevention status.";
		}

		setErrors((prev) => ({ ...prev, ...nextErrors }));
		return Object.keys(nextErrors).length === 0;
	}

	function validateStep5(): boolean {
		const nextErrors: ReservationFormErrors = {};

		const provider = formData.insuranceProvider.trim();
		const memberId = formData.insuranceMemberId.trim();

		if (provider.length > 120) {
			nextErrors.insuranceProvider =
				"Insurance provider must be 120 characters or fewer.";
		}

		if (memberId.length > 120) {
			nextErrors.insuranceMemberId =
				"Member/Policy ID must be 120 characters or fewer.";
		}

		setErrors((prev) => ({ ...prev, ...nextErrors }));
		return Object.keys(nextErrors).length === 0;
	}

	function validateStep6(): boolean {
		const nextErrors: ReservationFormErrors = {};

		if (!formData.consentToFormInfo) {
			nextErrors.consentToFormInfo =
				"You must confirm consent before submitting.";
		}

		setErrors((prev) => ({ ...prev, ...nextErrors }));
		return Object.keys(nextErrors).length === 0;
	}

	function validateCurrentStep(step: number): boolean {
		if (step === 1) return validateStep1();
		if (step === 2) return validateStep2();
		if (step === 3) return validateStep3();
		if (step === 4) return validateStep4();
		if (step === 5) return validateStep5();
		if (step === 6) return validateStep6();
		return true;
	}

	function canProceedFromStep(step: number): boolean {
		if (DEV_BYPASS_VALIDATION) return true;
		return validateCurrentStep(step);
	}

    async function handleSubmitAppointment() {
    if (isSubmitting || isSubmitted) return;

    const isValid = validateStep6();
    if (!isValid) return;

    setIsSubmitting(true);
    setSubmitMessage("");

    try {
        // Convert UI slotId -> backend startTime
        const startTime = extractStartTimeFromSlotId(formData.appointmentTimeSlot);

        if (!startTime) {
        setSubmitMessage("Invalid appointment time slot format.");
        return;
        }

        // Build payload expected by backend /api/reservations
        const payload = {
        reasonKey: formData.reasonForVisit as ReasonKey,
        appointmentDate: formData.appointmentDate,
        startTime,
        userEmail: formData.email?.trim() || null,
        vetID: null,
        petID: null,
        };

        const res = await createReservation(payload);

        setIsSubmitted(true);
        setSubmitMessage(
        res.message || "Your appointment request has been submitted successfully."
        );
    } catch (err) {
        const msg =
        err instanceof Error ? err.message : "Failed to submit appointment.";
        setSubmitMessage(msg);
    } finally {
        setIsSubmitting(false);
    }
    }

	function handleNext() {
		if (isSubmitted) return;
		if (!canGoNext) return;

		const currentIsValid = canProceedFromStep(currentStep);
		if (!currentIsValid) return;

		const nextStep = currentStep + 1;
		setCurrentStep(nextStep);
		setFurthestCompletedStep((prev) => Math.max(prev, nextStep));
	}

	function handlePrev() {
		if (isSubmitted) return;
		if (!canGoPrev) return;
		setCurrentStep((prev) => prev - 1);
	}

	function handleStepClick(targetStep: number) {
		if (isSubmitted) return;
		if (targetStep > furthestCompletedStep) return;

		if (targetStep <= currentStep) {
			setCurrentStep(targetStep);
			return;
		}

		if (DEV_BYPASS_VALIDATION) {
			setCurrentStep(targetStep);
			return;
		}

		for (let step = currentStep; step < targetStep; step++) {
			const isValid = validateCurrentStep(step);
			if (!isValid) {
				setCurrentStep(step);
				return;
			}
		}

		setCurrentStep(targetStep);
	}

	function renderStepContent() {
		if (currentStep === 1) {
			return (
				<OwnerDetailsStep
					formData={formData}
					errors={errors}
					onFieldChange={setField}
					stateCodes={US_STATE_CODES}
				/>
			);
		}

		if (currentStep === 2) {
			return (
				<PetInformationStep
					formData={formData}
					errors={errors}
					onFieldChange={setField}
				/>
			);
		}

		if (currentStep === 3) {
			return (
				<div>
					<h2>Appointment</h2>
					<p>Select a reason first. Availability is filtered by reason.</p>

					<div className="form-row">
						<label htmlFor="reasonForVisit">Reason for Visit *</label>
						<select
							id="reasonForVisit"
							value={formData.reasonForVisit}
							onChange={(e) =>
								setField(
									"reasonForVisit",
									e.target.value as ReservationFormData["reasonForVisit"]
								)
							}
						>
							<option value="">Select a reason</option>
							{REASON_OPTIONS.map((opt) => (
								<option key={opt.key} value={opt.key}>
									{opt.label}
								</option>
							))}
						</select>
						{errors.reasonForVisit ? (
							<p className="field-error">{errors.reasonForVisit}</p>
						) : null}
					</div>

					{!formData.reasonForVisit ? (
						<div className="availability-placeholder">
							Please select a reason for visit to load available appointments.
						</div>
					) : (
						<>
							{availabilityLoading ? <p>Loading available appointments...</p> : null}
							{availabilityError ? (
								<p className="field-error">{availabilityError}</p>
							) : null}

							<div className="form-row">
								<label htmlFor="appointmentDate">Appointment Date *</label>
								<select
									id="appointmentDate"
									value={formData.appointmentDate}
									onChange={(e) => {
										setField("appointmentDate", e.target.value);
										setField("appointmentTimeSlot", "");
									}}
									disabled={availabilityLoading || availableDates.length === 0}
								>
									<option value="">
										{availableDates.length === 0
											? "No dates available"
											: "Select a date"}
									</option>
									{availableDates.map((dateValue) => (
										<option key={dateValue} value={dateValue}>
											{dateValue}
										</option>
									))}
								</select>
								{errors.appointmentDate ? (
									<p className="field-error">{errors.appointmentDate}</p>
								) : null}
							</div>

							<div className="form-row">
								<label htmlFor="appointmentTimeSlot">Appointment Time *</label>
								<select
									id="appointmentTimeSlot"
									value={formData.appointmentTimeSlot}
									onChange={(e) => setField("appointmentTimeSlot", e.target.value)}
									disabled={!formData.appointmentDate || currentDateSlots.length === 0}
								>
									<option value="">
										{!formData.appointmentDate
											? "Select a date first"
											: currentDateSlots.length === 0
											? "No times available for this date"
											: "Select a time"}
									</option>
									{currentDateSlots.map((slot) => (
										<option key={slot.slotId} value={slot.slotId}>
											{slot.displayLabel}
										</option>
									))}
								</select>
								{errors.appointmentTimeSlot ? (
									<p className="field-error">{errors.appointmentTimeSlot}</p>
								) : null}
							</div>
						</>
					)}
				</div>
			);
		}

		if (currentStep === 4) {
			return (
				<MedicalHistoryStep
					formData={formData}
					errors={errors}
					onFieldChange={setField}
				/>
			);
		}

		if (currentStep === 5) {
			return (
				<InsuranceStep
					formData={formData}
					errors={errors}
					onFieldChange={setField}
				/>
			);
		}

		if (currentStep === 6) {
			return (
				<ReviewConfirmStep
					formData={formData}
					errors={errors}
					onFieldChange={setField}
					onSubmit={handleSubmitAppointment}
					isSubmitting={isSubmitting}
					isSubmitted={isSubmitted}
					submitMessage={submitMessage}
					onCreateNewAppointment={resetReservationForm}
				/>
			);
		}

		return (
			<div>
				<h2>{STEPS[currentStep - 1].label}</h2>
				<p>Step content</p>
			</div>
		);
	}

	return (
		<main className="reservation-page">
			<section className="reservation-container">
				<header className="reservation-header">
					<h1>Create Appointment</h1>
					<p>
						Step {currentStep} of {STEPS.length}
					</p>
					{DEV_BYPASS_VALIDATION ? (
						<p className="dev-bypass-note">
							Dev mode: validation/backend availability bypass enabled
						</p>
					) : null}
				</header>

				<nav className="reservation-steps" aria-label="Appointment form steps">
					{STEPS.map((step) => {
						const status = getStepStatus(
							step.id,
							currentStep,
							furthestCompletedStep
						);
						const isLocked = step.id > furthestCompletedStep;

						return (
							<button
								key={step.id}
								type="button"
								className={`step-btn step-${status}`}
								onClick={() => handleStepClick(step.id)}
								disabled={isLocked || isSubmitted}
								aria-current={status === "current" ? "step" : undefined}
								title={
									isLocked
										? "Complete previous steps first"
										: `Go to ${step.label}`
								}
							>
								<span className="step-circle">
									{status === "complete" ? "✓" : step.id}
								</span>
								<span className="step-label">{step.label}</span>
							</button>
						);
					})}
				</nav>

				<section className="reservation-content">{renderStepContent()}</section>

				<footer className="reservation-footer">
					<button
						type="button"
						onClick={handlePrev}
						disabled={!canGoPrev || isSubmitted}
					>
						Previous
					</button>
					<button
						type="button"
						onClick={handleNext}
						disabled={!canGoNext || isSubmitted}
					>
						Next
					</button>
				</footer>
			</section>
		</main>
	);
}
