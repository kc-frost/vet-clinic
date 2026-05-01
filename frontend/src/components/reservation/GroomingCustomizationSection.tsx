import type { ChangeEvent } from "react";

import style1 from "../../assets/groomingStyles/style1.jpg";
import style2 from "../../assets/groomingStyles/style2.webp";
import style3 from "../../assets/groomingStyles/style3.webp";
import style4 from "../../assets/groomingStyles/style4.webp";
import style5 from "../../assets/groomingStyles/style5.webp";
import style6 from "../../assets/groomingStyles/style6.webp";
import style7 from "../../assets/groomingStyles/style7.webp";
import style8 from "../../assets/groomingStyles/style8.jpg";
import style9 from "../../assets/groomingStyles/style9.jpg";
import style10 from "../../assets/groomingStyles/style10.jpg";

type GroomingCustomizationValue = {
	groomingDyeStyleKey: string;
	groomingReferencePhotoName: string;
	groomingReferencePhotoFile: File | null;
	groomingStyleNotes: string;
};

type Props = {
	value: GroomingCustomizationValue;
	onChange: (updates: Partial<GroomingCustomizationValue>) => void;
};

const STYLE_OPTIONS = [
	{ key: "STYLE_1", label: "Style 1", image: style1 },
	{ key: "STYLE_2", label: "Style 2", image: style2 },
	{ key: "STYLE_3", label: "Style 3", image: style3 },
	{ key: "STYLE_4", label: "Style 4", image: style4 },
	{ key: "STYLE_5", label: "Style 5", image: style5 },
	{ key: "STYLE_6", label: "Style 6", image: style6 },
	{ key: "STYLE_7", label: "Style 7", image: style7 },
	{ key: "STYLE_8", label: "Style 8", image: style8 },
	{ key: "STYLE_9", label: "Style 9", image: style9 },
	{ key: "STYLE_10", label: "Style 10", image: style10 },
];

export default function GroomingCustomizationSection({ value, onChange }: Props) {
	function selectStyle(styleKey: string) {
		onChange({
			groomingDyeStyleKey: styleKey,
			groomingReferencePhotoName: "",
			groomingReferencePhotoFile: null,
		});
	}

	function handleSurpriseMe() {
		const randomStyle = STYLE_OPTIONS[Math.floor(Math.random() * STYLE_OPTIONS.length)];
		onChange({
			groomingDyeStyleKey: randomStyle.key,
			groomingReferencePhotoName: "",
			groomingReferencePhotoFile: null,
		});
	}

	function handleReferencePhotoChange(e: ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0] || null;
	
		onChange({
			groomingReferencePhotoName: file ? file.name : "",
			groomingReferencePhotoFile: file,
			groomingDyeStyleKey: "",
		});
	}

	return (
		<div className="grooming-section">
			<div className="grooming-section-header">
				<h3>Grooming Dye Customization</h3>
				<p>Choose a preset dye style or upload your own reference photo, and add style notes for the groomer.</p>
			</div>

			<div className="grooming-style-grid">
				{STYLE_OPTIONS.map((style) => (
					<button
						key={style.key}
						type="button"
						className={`grooming-style-card ${
							value.groomingDyeStyleKey === style.key ? "selected" : ""
						}`}
						onClick={() => selectStyle(style.key)}
					>
						<img src={style.image} alt={style.label} />
						<span>{style.label}</span>
					</button>
				))}
			</div>

			<div className="grooming-actions">
				<button type="button" className="surprise-button" onClick={handleSurpriseMe}>
					Surprise Me
				</button>
			</div>

			<div className="form-row">
				<label>Reference photo (optional)</label>
				<input type="file" accept="image/*" onChange={handleReferencePhotoChange} />
				{value.groomingReferencePhotoName ? (
					<p>Selected file: {value.groomingReferencePhotoName}</p>
				) : null}
			</div>

			<div className="form-row">
				<label>Style notes (optional)</label>
				<textarea
					value={value.groomingStyleNotes}
					onChange={(e) => onChange({ groomingStyleNotes: e.target.value })}
					rows={4}
					placeholder="Example: pastel colors, avoid dye near face, match the reference photo..."
				/>
			</div>
		</div>
	);
}