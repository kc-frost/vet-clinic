import type { ReservationFormData, ReservationFormErrors } from "../../types/reservation";
import { REASON_OPTIONS } from "../../types/reservation";

interface Props {
	formData: ReservationFormData;
	errors: ReservationFormErrors;
	onFieldChange: <K extends keyof ReservationFormData>(field: K, value: ReservationFormData[K]) => void;
	onSubmit: () => void;
	isSubmitting: boolean;
	isSubmitted: boolean;
	submitMessage: string;
	onCreateNewAppointment: () => void;
}

// maps the stored reasonKey value to the human-friendly label shown in the dropdown
// if the key is missing or not found, it falls back to showing the raw key
function reasonLabel(reasonKey: ReservationFormData["reasonKey"]) {
	if (!reasonKey) return "—";
	const opt = REASON_OPTIONS.find((o) => o.value === reasonKey);
	return opt ? opt.label : reasonKey;
}

export default function ReviewConfirmStep({
	formData,
	errors,
	onFieldChange,
	onSubmit,
	isSubmitting,
	isSubmitted,
	submitMessage,
	onCreateNewAppointment,
}: Props) {
	return (
		<div>
			<h2>Review & Confirm</h2>
			<p>Review your details and confirm your reservation.</p>

			{/* this is a read-only summary view
			   it pulls values from formData and shows placeholders ("—") when something is empty */}

			<div className="review-box">
				<h3>Owner</h3>
				<p>
					<strong>Name:</strong> {formData.legalFirstName} {formData.legalLastName}
				</p>
				<p>
					<strong>Email:</strong> {formData.email}
				</p>
				<p>
					<strong>Phone:</strong> {formData.phone}
				</p>
				<p>
					<strong>Address:</strong> {formData.addressLine1}, {formData.city}, {formData.state} {formData.zipCode}
				</p>

				<hr />

				<h3>Pet</h3>
				<p>
					<strong>Name:</strong> {formData.petName}
				</p>
				<p>
					<strong>Type:</strong> {formData.petType}
				</p>
				<p>
					<strong>Breed:</strong> {formData.breed}
				</p>
				<p>
					<strong>Sex:</strong> {formData.petSex}
				</p>
				<p>
					<strong>Spayed/Neutered:</strong> {formData.spayedNeutered}
				</p>
				<p>
					<strong>Age:</strong> {formData.petAge || "—"}
				</p>

				<hr />

				<h3>Appointment</h3>
				<p>
					<strong>Reason:</strong> {reasonLabel(formData.reasonKey)}
				</p>
				<p>
					<strong>Date:</strong> {formData.appointmentDate || "—"}
				</p>
				<p>
					<strong>Start time:</strong> {formData.startTime || "—"}
				</p>

				{/* reasonDetails is optional, so only show it if the user typed something */}
				{formData.reasonDetails ? (
					<p>
						<strong>Notes:</strong> {formData.reasonDetails}
					</p>
				) : null}

				<hr />

				<h3>Medical History</h3>
				<p>
					<strong>Current medications:</strong> {formData.currentMedications || "—"}
				</p>
				<p>
					<strong>Medication history:</strong> {formData.medicationHistory || "—"}
				</p>
				<p>
					<strong>Known allergies:</strong> {formData.knownAllergies || "—"}
				</p>
				<p>
					<strong>Current conditions:</strong> {formData.currentConditions || "—"}
				</p>
				<p>
					<strong>Past injuries / conditions:</strong> {formData.pastInjuriesConditions || "—"}
				</p>
				<p>
					<strong>Vaccinations up to date:</strong> {formData.vaccinationsUpToDate || "—"}
				</p>
				<p>
					<strong>Heartworm prevention current:</strong> {formData.heartwormPreventionCurrent || "—"}
				</p>

				<hr />

				<h3>Insurance</h3>
				<p>
					<strong>Provider:</strong> {formData.insuranceProvider || "—"}
				</p>
				<p>
					<strong>Member ID:</strong> {formData.insuranceMemberId || "—"}
				</p>
			</div>

			{/* This warning is for edits after submit */}
			<p className="reservation-warning-text">
				If you need to edit appointment information after creation, cancel the appointment and create a new one.
			</p>

			{/* final confirmation checkbox
			   this is the only editable control on this step */}
			<div className="form-row consentRow">
				<label className="consentLabel">
					<input
						type="checkbox"
						checked={formData.consentToFormInfo}
						onChange={(e) => onFieldChange("consentToFormInfo", e.target.checked)}
					/>
					<span>I confirm the information above is accurate.</span>
				</label>

				{errors.consentToFormInfo ? <p className="field-error">{errors.consentToFormInfo}</p> : null}
			</div>

			{/* submitMessage is used for both error messages and the success message after submit */}
			{submitMessage ? <p className={isSubmitted ? "success-text" : "field-error"}>{submitMessage}</p> : null}

			{/* if submit succeeded, show "create new appointment"
			   otherwise show the submit button and disable it while submitting */}
			{isSubmitted ? (
				<button type="button" className="next-button" onClick={onCreateNewAppointment}>
					Create New Appointment
				</button>
			) : (
				<button type="button" className="next-button" onClick={onSubmit} disabled={isSubmitting}>
					{isSubmitting ? "Submitting..." : "Submit Reservation"}
				</button>
			)}
		</div>
	);
}