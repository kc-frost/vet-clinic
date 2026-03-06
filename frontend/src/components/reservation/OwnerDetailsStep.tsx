import type { ChangeEvent } from "react";
import type { ReservationFormData, ReservationFormErrors } from "../../types/reservation";

interface Props {
	formData: ReservationFormData;
	errors: ReservationFormErrors;
	onChange: (e: ChangeEvent<HTMLInputElement>) => void;
}

export default function OwnerDetailsStep({ formData, errors, onChange }: Props) {
	return (
		<div>
			<h2>Owner Details</h2>
			<p>Please enter your contact information.</p>

			{/* each input uses name=... so the shared onChange handler can update the matching field in formData */}
			{/* errors are displayed per-field so the user can see exactly what needs fixing */}

			<div className="form-group">
				<label>First Name</label>
				<input name="legalFirstName" value={formData.legalFirstName} onChange={onChange} />
				{errors.legalFirstName && <p className="error-text">{errors.legalFirstName}</p>}
			</div>

			<div className="form-group">
				<label>Last Name</label>
				<input name="legalLastName" value={formData.legalLastName} onChange={onChange} />
				{errors.legalLastName && <p className="error-text">{errors.legalLastName}</p>}
			</div>

			<div className="form-group">
				<label>Email</label>

				{/* email comes from the logged-in account and is not editable from this reservation form */}
				<input
					name="email"
					type="email"
					value={formData.email}
					readOnly
					aria-readonly="true"
					title="Email is tied to your account and cannot be changed here"
				/>

				{errors.email && <p className="error-text">{errors.email}</p>}
			</div>

			<div className="form-group">
				<label>Phone</label>
				<input name="phone" value={formData.phone} onChange={onChange} />
				{errors.phone && <p className="error-text">{errors.phone}</p>}
			</div>

			<div className="form-group">
				<label>Address</label>
				<input name="addressLine1" value={formData.addressLine1} onChange={onChange} />
				{errors.addressLine1 && <p className="error-text">{errors.addressLine1}</p>}
			</div>

			<div className="form-group">
				<label>City</label>
				<input name="city" value={formData.city} onChange={onChange} />
				{errors.city && <p className="error-text">{errors.city}</p>}
			</div>

			<div className="form-group">
				<label>State</label>

				{/* maxLength=2 because state is stored as a 2-letter abbreviation */}
				<input name="state" value={formData.state} onChange={onChange} maxLength={2} />

				{errors.state && <p className="error-text">{errors.state}</p>}
			</div>

			<div className="form-group">
				<label>Zip Code</label>
				<input name="zipCode" value={formData.zipCode} onChange={onChange} />
				{errors.zipCode && <p className="error-text">{errors.zipCode}</p>}
			</div>
		</div>
	);
}