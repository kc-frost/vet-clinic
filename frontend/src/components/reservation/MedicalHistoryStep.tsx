import type {
	ReservationFormData,
	ReservationFormErrors,
} from "../../types/reservation";

type MedicalHistoryStepProps = {
	formData: ReservationFormData;
	errors: ReservationFormErrors;
	onFieldChange: <K extends keyof ReservationFormData>(
		field: K,
		value: ReservationFormData[K]
	) => void;
};

export default function MedicalHistoryStep({formData, errors, onFieldChange}: MedicalHistoryStepProps) {
	return (
		<div>
			<h2>Medical History</h2>
			<p>
				Provide relevant medical context. If none, type "None" in required text
				fields.
			</p>

			<div className="form-row">
				<label htmlFor="pastInjuriesConditions">
					Past Injuries / Conditions *
				</label>
				<textarea
					id="pastInjuriesConditions"
					rows={4}
					maxLength={500}
					value={formData.pastInjuriesConditions}
					onChange={(e) =>
						onFieldChange("pastInjuriesConditions", e.target.value)
					}
					placeholder="Example: Previous fracture in 2024. If none, type 'None'."
				/>
				{errors.pastInjuriesConditions ? (
					<p className="field-error">{errors.pastInjuriesConditions}</p>
				) : null}
			</div>

			<div className="form-row">
				<label htmlFor="currentMedications">Current Medications *</label>
				<textarea
					id="currentMedications"
					rows={3}
					maxLength={500}
					value={formData.currentMedications}
					onChange={(e) => onFieldChange("currentMedications", e.target.value)}
					placeholder="List current medications. If none, type 'None'."
				/>
				{errors.currentMedications ? (
					<p className="field-error">{errors.currentMedications}</p>
				) : null}
			</div>

			<div className="form-row">
				<label htmlFor="knownAllergies">Known Allergies *</label>
				<textarea
					id="knownAllergies"
					rows={3}
					maxLength={500}
					value={formData.knownAllergies}
					onChange={(e) => onFieldChange("knownAllergies", e.target.value)}
					placeholder="Food/drug/environmental allergies. If none, type 'None'."
				/>
				{errors.knownAllergies ? (
					<p className="field-error">{errors.knownAllergies}</p>
				) : null}
			</div>

			<div className="form-grid two-col">
				<div className="form-row">
					<label htmlFor="vaccinationsUpToDate">
						Vaccinations Up To Date? *
					</label>
					<select
						id="vaccinationsUpToDate"
						value={formData.vaccinationsUpToDate}
						onChange={(e) =>
							onFieldChange(
								"vaccinationsUpToDate",
								e.target.value as ReservationFormData["vaccinationsUpToDate"]
							)
						}
					>
						<option value="">Select</option>
						<option value="Yes">Yes</option>
						<option value="No">No</option>
						<option value="Unsure">Unsure</option>
					</select>
					{errors.vaccinationsUpToDate ? (
						<p className="field-error">{errors.vaccinationsUpToDate}</p>
					) : null}
				</div>

				<div className="form-row">
					<label htmlFor="heartwormPreventionCurrent">
						On Heartworm Prevention? *
					</label>
					<select
						id="heartwormPreventionCurrent"
						value={formData.heartwormPreventionCurrent}
						onChange={(e) =>
							onFieldChange(
								"heartwormPreventionCurrent",
								e.target.value as ReservationFormData["heartwormPreventionCurrent"]
							)
						}
					>
						<option value="">Select</option>
						<option value="Yes">Yes</option>
						<option value="No">No</option>
						<option value="Unsure">Unsure</option>
						<option value="Not Applicable">Not Applicable</option>
					</select>
					{errors.heartwormPreventionCurrent ? (
						<p className="field-error">{errors.heartwormPreventionCurrent}</p>
					) : null}
				</div>
			</div>
		</div>
	);
}
