import type { ReservationFormData, ReservationFormErrors } from "../../types/reservation";
import type { ChangeEvent } from "react";

type Props = {
	formData: ReservationFormData;
	errors: ReservationFormErrors;
	onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;
};

// state code dropdown list for the owner details section
const US_STATE_CODES = [
	"AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
	"HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
	"MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
	"NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
	"SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

export default function OwnerDetailsStep({ formData, errors, onChange }: Props) {
	return (
		<div>
			<h2>Owner Details</h2>
			<p>Please provide your contact information.</p>

			<div className="form-group">
				<label>First Name</label>
				<input
					name="legalFirstName"
					value={formData.legalFirstName}
					onChange={onChange}
				/>
				{errors.legalFirstName && <p className="error-text">{errors.legalFirstName}</p>}
			</div>

			<div className="form-group">
				<label>Last Name</label>
				<input
					name="legalLastName"
					value={formData.legalLastName}
					onChange={onChange}
				/>
				{errors.legalLastName && <p className="error-text">{errors.legalLastName}</p>}
			</div>

			<div className="form-group">
				<label>Email</label>
				<input
					name="email"
					value={formData.email}
					onChange={onChange}
					readOnly
				/>
				{errors.email && <p className="error-text">{errors.email}</p>}
			</div>

			<div className="form-group">
				<label>Phone</label>
				<input
					name="phone"
					value={formData.phone}
					onChange={onChange}
				/>
				{errors.phone && <p className="error-text">{errors.phone}</p>}
			</div>

			<div className="form-group">
				<label>Address</label>
				<input
					name="addressLine1"
					value={formData.addressLine1}
					onChange={onChange}
				/>
				{errors.addressLine1 && <p className="error-text">{errors.addressLine1}</p>}
			</div>

			<div className="form-group">
				<label>City</label>
				<input
					name="city"
					value={formData.city}
					onChange={onChange}
				/>
				{errors.city && <p className="error-text">{errors.city}</p>}
			</div>

			<div className="form-group">
				<label>State Code</label>
				<select
					name="state"
					value={formData.state}
					onChange={onChange}
				>
					<option value="">Select</option>
					{US_STATE_CODES.map((code) => (
						<option key={code} value={code}>
							{code}
						</option>
					))}
				</select>
				{errors.state && <p className="error-text">{errors.state}</p>}
			</div>

			<div className="form-group">
				<label>ZIP Code</label>
				<input
					name="zipCode"
					value={formData.zipCode}
					onChange={onChange}
				/>
				{errors.zipCode && <p className="error-text">{errors.zipCode}</p>}
			</div>
		</div>
	);
}