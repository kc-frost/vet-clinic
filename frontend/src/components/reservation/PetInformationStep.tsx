import type {
	ReservationFormData,
	ReservationFormErrors,
} from "../../types/reservation";

type PetInformationStepProps = {
	formData: ReservationFormData;
	errors: ReservationFormErrors;
	onFieldChange: <K extends keyof ReservationFormData>(
		field: K,
		value: ReservationFormData[K]
	) => void;
};

export default function PetInformationStep({formData, errors, onFieldChange}: PetInformationStepProps) {
	return (
		<div>
			<h2>Pet Information</h2>
			<p>Please provide your pet’s details.</p>

			<div className="form-row">
				<label htmlFor="petName">Pet Name *</label>
				<input
					id="petName"
					type="text"
					value={formData.petName}
					onChange={(e) => onFieldChange("petName", e.target.value)}
				/>
				{errors.petName ? <p className="field-error">{errors.petName}</p> : null}
			</div>

			<div className="form-grid two-col">
				<div className="form-row">
					<label htmlFor="petType">Pet Type *</label>
					<select
						id="petType"
						value={formData.petType}
						onChange={(e) =>
							onFieldChange("petType", e.target.value as ReservationFormData["petType"])
						}
					>
						<option value="Dog">Dog</option>
						<option value="Cat">Cat</option>
						<option value="Other">Other</option>
					</select>
					{errors.petType ? <p className="field-error">{errors.petType}</p> : null}
				</div>

				<div className="form-row">
					<label htmlFor="breed">Breed *</label>
					<input
						id="breed"
						type="text"
						value={formData.breed}
						onChange={(e) => onFieldChange("breed", e.target.value)}
						placeholder="If unknown, type 'Unknown'"
					/>
					{errors.breed ? <p className="field-error">{errors.breed}</p> : null}
				</div>
			</div>

			<div className="form-grid two-col">
				<div className="form-row">
					<label htmlFor="petSex">Sex *</label>
					<select
						id="petSex"
						value={formData.petSex}
						onChange={(e) =>
							onFieldChange("petSex", e.target.value as ReservationFormData["petSex"])
						}
					>
						<option value="Male">Male</option>
						<option value="Female">Female</option>
						<option value="Unknown">Unknown</option>
					</select>
					{errors.petSex ? <p className="field-error">{errors.petSex}</p> : null}
				</div>

				<div className="form-row">
					<label htmlFor="spayedNeutered">Spayed / Neutered *</label>
					<select
						id="spayedNeutered"
						value={formData.spayedNeutered}
						onChange={(e) =>
							onFieldChange(
								"spayedNeutered",
								e.target.value as ReservationFormData["spayedNeutered"]
							)
						}
					>
						<option value="Yes">Yes</option>
						<option value="No">No</option>
						<option value="Unknown">Unknown</option>
					</select>
					{errors.spayedNeutered ? (
						<p className="field-error">{errors.spayedNeutered}</p>
					) : null}
				</div>
			</div>

			<div className="form-row">
				<label htmlFor="petAge">Pet Age (years) *</label>
				<input
					id="petAge"
					type="number"
					min={0}
					max={80}
					step={1}
					value={formData.petAge}
					onChange={(e) => {
						const raw = e.target.value;
						onFieldChange("petAge", raw === "" ? "" : Number(raw));
					}}
					placeholder="Best guess if unknown"
				/>
				{errors.petAge ? <p className="field-error">{errors.petAge}</p> : null}
			</div>
		</div>
	);
}
