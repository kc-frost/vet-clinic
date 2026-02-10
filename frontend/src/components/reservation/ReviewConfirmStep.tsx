import type {
	ReservationFormData,
	ReservationFormErrors,
} from "../../types/reservation";

type ReviewConfirmStepProps = {
	formData: ReservationFormData;
	errors: ReservationFormErrors;
	onFieldChange: <K extends keyof ReservationFormData>(
		field: K,
		value: ReservationFormData[K]
	) => void;
	onSubmit: () => void;
	isSubmitting: boolean;
	isSubmitted: boolean;
	submitMessage: string;
	onCreateNewAppointment: () => void;
};

function labelForReason(reason: ReservationFormData["reasonForVisit"]): string {
	if (!reason) return "—";
	return reason;
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
}: ReviewConfirmStepProps) {
	if (isSubmitted) {
		return (
			<div className="submit-success-card">
				<h2>Appointment Submitted</h2>
				<p>{submitMessage || "Your appointment request has been submitted."}</p>
				<button type="button" onClick={onCreateNewAppointment}>
					Create New Appointment
				</button>
			</div>
		);
	}

	return (
		<div>
			<h2>Review & Confirm</h2>
			<p>Please review your information before submitting.</p>

			<div className="review-section">
				<h3>Owner Details</h3>
				<p><strong>Name:</strong> {formData.legalFirstName} {formData.legalLastName}</p>
				<p><strong>Email:</strong> {formData.email}</p>
				<p><strong>Phone:</strong> {formData.phone}</p>
				<p><strong>Address:</strong> {formData.addressLine1}, {formData.city}, {formData.state} {formData.zipCode}</p>
			</div>

			<div className="review-section">
				<h3>Pet Information</h3>
				<p><strong>Pet Name:</strong> {formData.petName}</p>
				<p><strong>Type:</strong> {formData.petType}</p>
				<p><strong>Breed:</strong> {formData.breed}</p>
				<p><strong>Sex:</strong> {formData.petSex}</p>
				<p><strong>Spayed/Neutered:</strong> {formData.spayedNeutered}</p>
				<p><strong>Age:</strong> {formData.petAge === "" ? "—" : formData.petAge}</p>
			</div>

			<div className="review-section">
				<h3>Appointment</h3>
				<p><strong>Reason:</strong> {labelForReason(formData.reasonForVisit)}</p>
				<p><strong>Date:</strong> {formData.appointmentDate || "—"}</p>
				<p><strong>Time Slot:</strong> {formData.appointmentTimeSlot || "—"}</p>
				<p><strong>Notes:</strong> {formData.reasonDetails || "None"}</p>
			</div>

			<div className="review-section">
				<h3>Medical History</h3>
				<p><strong>Past Injuries/Conditions:</strong> {formData.pastInjuriesConditions || "—"}</p>
				<p><strong>Current Medications:</strong> {formData.currentMedications || "—"}</p>
				<p><strong>Known Allergies:</strong> {formData.knownAllergies || "—"}</p>
				<p><strong>Vaccinations Up To Date:</strong> {formData.vaccinationsUpToDate || "—"}</p>
				<p><strong>Heartworm Prevention:</strong> {formData.heartwormPreventionCurrent || "—"}</p>
			</div>

			<div className="review-section">
				<h3>Insurance (Optional)</h3>
				<p><strong>Provider:</strong> {formData.insuranceProvider || "Not provided"}</p>
				<p><strong>Member/Policy ID:</strong> {formData.insuranceMemberId || "Not provided"}</p>
			</div>

			<div className="form-row">
				<label className="checkbox-row" htmlFor="consentToFormInfo">
					<input
						id="consentToFormInfo"
						type="checkbox"
						checked={formData.consentToFormInfo}
						onChange={(e) => onFieldChange("consentToFormInfo", e.target.checked)}
					/>
					<span>
						I confirm the information above is accurate and I consent to submit this appointment request. *
					</span>
				</label>
				{errors.consentToFormInfo ? (
					<p className="field-error">{errors.consentToFormInfo}</p>
				) : null}
			</div>

			<div className="form-row">
				<button
					type="button"
					onClick={onSubmit}
					disabled={isSubmitting}
				>
					{isSubmitting ? "Submitting..." : "Submit Appointment"}
				</button>
			</div>
		</div>
	);
}
