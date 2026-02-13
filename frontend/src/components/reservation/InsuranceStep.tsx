import type {
	ReservationFormData,
	ReservationFormErrors,
} from "../../types/reservation";

type InsuranceStepProps = {
	formData: ReservationFormData;
	errors: ReservationFormErrors;
	onFieldChange: <K extends keyof ReservationFormData>(
		field: K,
		value: ReservationFormData[K]
	) => void;
};

export default function InsuranceStep({formData, errors, onFieldChange}: InsuranceStepProps) {
	return (
		<div>
			<h2>Insurance</h2>
			<p>
				Insurance information is optional. You may leave these blank if you do not
				have pet insurance.
			</p>

			<div className="form-row">
				<label htmlFor="insuranceProvider">Insurance Provider (Optional)</label>
				<input
					id="insuranceProvider"
					type="text"
					value={formData.insuranceProvider}
					onChange={(e) => onFieldChange("insuranceProvider", e.target.value)}
					placeholder="Example: Trupanion, Nationwide, ASPCA"
				/>
				{errors.insuranceProvider ? (
					<p className="field-error">{errors.insuranceProvider}</p>
				) : null}
			</div>

			<div className="form-row">
				<label htmlFor="insuranceMemberId">Member / Policy ID (Optional)</label>
				<input
					id="insuranceMemberId"
					type="text"
					value={formData.insuranceMemberId}
					onChange={(e) => onFieldChange("insuranceMemberId", e.target.value)}
					placeholder="Enter policy/member ID if available"
				/>
				{errors.insuranceMemberId ? (
					<p className="field-error">{errors.insuranceMemberId}</p>
				) : null}
			</div>

			<div className="form-row">
				<p className="form-note">
					You can continue without insurance details.
				</p>
			</div>
		</div>
	);
}
