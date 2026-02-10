import type {
	ReservationFormData,
	ReservationFormErrors,
} from "../../types/reservation";

type OwnerDetailsStepProps = {
	formData: ReservationFormData;
	errors: ReservationFormErrors;
	onFieldChange: <K extends keyof ReservationFormData>(
		field: K,
		value: ReservationFormData[K]
	) => void;
	stateCodes: string[];
};

export default function OwnerDetailsStep({formData, errors, onFieldChange, stateCodes}: OwnerDetailsStepProps) {
	return (
		<div>
			<h2>Owner Details</h2>
			<p>Please provide your contact information.</p>

			<div className="form-grid two-col">
				<div className="form-row">
					<label htmlFor="legalFirstName">First Name *</label>
					<input
						id="legalFirstName"
						type="text"
						value={formData.legalFirstName}
						onChange={(e) => onFieldChange("legalFirstName", e.target.value)}
					/>
					{errors.legalFirstName ? (
						<p className="field-error">{errors.legalFirstName}</p>
					) : null}
				</div>

				<div className="form-row">
					<label htmlFor="legalLastName">Last Name *</label>
					<input
						id="legalLastName"
						type="text"
						value={formData.legalLastName}
						onChange={(e) => onFieldChange("legalLastName", e.target.value)}
					/>
					{errors.legalLastName ? (
						<p className="field-error">{errors.legalLastName}</p>
					) : null}
				</div>
			</div>

			<div className="form-row">
				<label htmlFor="email">Email *</label>
				<input
					id="email"
					type="email"
					value={formData.email}
					onChange={(e) => onFieldChange("email", e.target.value)}
				/>
				{errors.email ? <p className="field-error">{errors.email}</p> : null}
			</div>

			<div className="form-row">
				<label htmlFor="phone">Phone Number *</label>
				<input
					id="phone"
					type="tel"
					value={formData.phone}
					onChange={(e) => onFieldChange("phone", e.target.value)}
					placeholder="(555) 123-4567"
				/>
				{errors.phone ? <p className="field-error">{errors.phone}</p> : null}
			</div>

			<div className="form-row">
				<label htmlFor="addressLine1">Address Line 1 *</label>
				<input
					id="addressLine1"
					type="text"
					value={formData.addressLine1}
					onChange={(e) => onFieldChange("addressLine1", e.target.value)}
				/>
				{errors.addressLine1 ? (
					<p className="field-error">{errors.addressLine1}</p>
				) : null}
			</div>

			<div className="form-grid two-col">
				<div className="form-row">
					<label htmlFor="city">City *</label>
					<input
						id="city"
						type="text"
						value={formData.city}
						onChange={(e) => onFieldChange("city", e.target.value)}
					/>
					{errors.city ? <p className="field-error">{errors.city}</p> : null}
				</div>

				<div className="form-row">
					<label htmlFor="state">State *</label>
					<select
						id="state"
						value={formData.state}
						onChange={(e) => onFieldChange("state", e.target.value)}
					>
						<option value="">Select state</option>
						{stateCodes.map((code) => (
							<option key={code} value={code}>
								{code}
							</option>
						))}
					</select>
					{errors.state ? <p className="field-error">{errors.state}</p> : null}
				</div>
			</div>

			<div className="form-row">
				<label htmlFor="zipCode">ZIP Code *</label>
				<input
					id="zipCode"
					type="text"
					value={formData.zipCode}
					onChange={(e) => onFieldChange("zipCode", e.target.value)}
					placeholder="12345 or 12345-6789"
				/>
				{errors.zipCode ? <p className="field-error">{errors.zipCode}</p> : null}
			</div>
		</div>
	);
}
