import type { ChangeEvent } from "react";
import type { PetProfile, ReservationFormData, ReservationFormErrors } from "../../types/reservation";

interface Props {
	formData: ReservationFormData;
	errors: ReservationFormErrors;
	onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;

	pets: PetProfile[];
	selectedPetId: number | null;
	onSelectPet: (petID: number | null) => void;
}

export default function PetInformationStep({
	formData,
	errors,
	onChange,
	pets,
	selectedPetId,
	onSelectPet,
}: Props) {
	// the select uses a string value, so null becomes "NEW"
	const selectValue = selectedPetId === null ? "NEW" : String(selectedPetId);

	return (
		<div>
			<h2>Pet Information</h2>
			<p>Tell us about the pet coming in for the appointment.</p>

			<div className="form-group">
				<label>Saved Pets (optional)</label>

				{/* this dropdown is optional
				   if the user picks a saved pet, Reservation.tsx can autofill the fields below */}
				<select
					value={selectValue}
					onChange={(e) => {
						// select values come in as strings
						const v = e.target.value;

						// "NEW" means "not using a saved pet profile"
						if (v === "NEW") onSelectPet(null);
						else onSelectPet(Number(v));
					}}
				>
					<option value="NEW">New pet / not saved</option>
					{pets.map((p) => (
						<option key={p.petID} value={String(p.petID)}>
							{p.petName || `Pet #${p.petID}`}
						</option>
					))}
				</select>

				<p className="helper-text">Selecting a saved pet will autofill fields below.</p>
			</div>

			{/* from here down, inputs are controlled by formData */}
			{/* name=... is what lets the shared onChange handler update the correct field */}

			<div className="form-group">
				<label>Pet Name</label>
				<input name="petName" value={formData.petName} onChange={onChange} />
				{errors.petName && <p className="error-text">{errors.petName}</p>}
			</div>

			<div className="form-group">
				<label>Pet Type</label>
				<select name="petType" value={formData.petType} onChange={onChange}>
					<option value="">Select</option>
					<option value="DOG">Dog</option>
					<option value="CAT">Cat</option>
					<option value="OTHER">Other</option>
				</select>
				{errors.petType && <p className="error-text">{errors.petType}</p>}
			</div>

			<div className="form-group">
				<label>Breed</label>
				<input name="breed" value={formData.breed} onChange={onChange} />
				{errors.breed && <p className="error-text">{errors.breed}</p>}
			</div>

			<div className="form-group">
				<label>Sex</label>
				<select name="petSex" value={formData.petSex} onChange={onChange}>
					<option value="">Select</option>
					<option value="MALE">Male</option>
					<option value="FEMALE">Female</option>
					<option value="UNKNOWN">Unknown</option>
				</select>
				{errors.petSex && <p className="error-text">{errors.petSex}</p>}
			</div>

			<div className="form-group">
				<label>Spayed / Neutered</label>
				<select name="spayedNeutered" value={formData.spayedNeutered} onChange={onChange}>
					<option value="">Select</option>
					<option value="YES">Yes</option>
					<option value="NO">No</option>
					<option value="UNKNOWN">Unknown</option>
				</select>
				{errors.spayedNeutered && <p className="error-text">{errors.spayedNeutered}</p>}
			</div>

			<div className="form-group">
				<label>Age</label>

				{/* kept as a text input because the form state stores it as a string */}
				<input name="petAge" value={formData.petAge} onChange={onChange} />

				{errors.petAge && <p className="error-text">{errors.petAge}</p>}
			</div>
		</div>
	);
}