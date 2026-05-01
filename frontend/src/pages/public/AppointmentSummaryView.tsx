import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getCustomerAppointmentSummary } from "../../api/appointmentSummary";
import type { CustomerAppointmentSummaryResponse } from "../../types/appointmentSummary";
import "../../styles/appointmentSummaryView.css";
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

function formatReasonLabel(reasonKey: string) {
	// Turns backend reason keys like WELLNESS_EXAM into a readable label
	return String(reasonKey || "").toLowerCase().split("_").filter(Boolean)
	    .map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatDate(value: string | null) {
	// No date means there is nothing useful to display
	if (!value) return "";

	const date = new Date(value);

	// If js can't read the date, show the original value instead of breaking the page
	if (Number.isNaN(date.getTime())) return value;

	return date.toLocaleDateString("en-US", { year: "numeric", month: "numeric", day: "numeric" });
}

function formatTime(value: string | null) {
	// No time means there is nothing useful to display
	if (!value) return "";

	const date = new Date(value);

	// If js cant read the time, show the original value instead of breaking the page
	if (Number.isNaN(date.getTime())) return value;

	return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function DetailItem({ label, value }: { label: string; value: string | number | null }) {
	// Reusable row for small appointment or pet profile details
	return (
		<div className="appointmentSummaryViewDetailItem">
			<span className="appointmentSummaryViewDetailLabel">{label}</span>
			<span className="appointmentSummaryViewDetailValue">{value || "N/A"}</span>
		</div>
	);
}

const GROOMING_DYE_STYLE_IMAGES: Record<string, string> = {
	STYLE_1: style1,
	STYLE_2: style2,
	STYLE_3: style3,
	STYLE_4: style4,
	STYLE_5: style5,
	STYLE_6: style6,
	STYLE_7: style7,
	STYLE_8: style8,
	STYLE_9: style9,
	STYLE_10: style10,
};

function isGroomingReason(reasonKey: string) {
	return ["BASIC_GROOMING", "FLEA_BATH_GROOMING", "GROOMING_DYE"].includes(String(reasonKey || "").toUpperCase());
}

function getGroomingImagePath(summaryData: CustomerAppointmentSummaryResponse) {
	const referencePhotoPath = summaryData.appointment.groomingReferencePhotoPath;
	if (referencePhotoPath) return referencePhotoPath;

	const styleKey = String(summaryData.appointment.groomingDyeStyleKey || "").toUpperCase();
	return GROOMING_DYE_STYLE_IMAGES[styleKey] || "";
}

function formatStyleKey(styleKey: string) {
	return String(styleKey || "").replaceAll("_", " ");
}

function SummaryField({ label, value }: { label: string; value: string }) {
	// Reusable display block for finalized summary text
	return (
		<div className="appointmentSummaryViewField">
			<h3>{label}</h3>
			<p>{value || "N/A"}</p>
		</div>
	);
}

export default function AppointmentSummaryView() {
	const { appointmentID: appointmentIDParam } = useParams();

	// Converts the route param from text into a number before using it with the API
	const appointmentID = Number(appointmentIDParam);

	// Tracks whether the page is still waiting for the backend
	const [loading, setLoading] = useState(true);

	// Stores a page level error message if loading fails
	const [pageError, setPageError] = useState("");

	// Stores the customer facing appointment summary response after it loads
	const [summaryData, setSummaryData] = useState<CustomerAppointmentSummaryResponse | null>(null);

	useEffect(() => {
		// Stop early if the route does not contain a valid appointment id
		if (!Number.isInteger(appointmentID) || appointmentID < 1) {
			setLoading(false);
			setPageError("Invalid appointment id");
			return;
		}

		// Prevents an old request from updating this page after user leaves page
		let cancelled = false;

		async function loadSummary() {
			try {
				// Reset the page into a clean loading state before calling the backend
				setLoading(true);
				setPageError("");

				const result = await getCustomerAppointmentSummary(appointmentID);

				// Only update the page if this effect is still active, so if user is still on page
				if (!cancelled) setSummaryData(result);
			} catch (error) {
				// Only show the error if this effect is still active
				if (!cancelled) setPageError(error instanceof Error ? error.message : "Failed to load appointment summary");
			} finally {
				// Only stop the loading screen if this effect is still active
				if (!cancelled) setLoading(false);
			}
		}

		loadSummary();

		return () => {
			// Marks this request as old so its result gets ignored if it finishes late
			cancelled = true;
		};
	}, [appointmentID]);

	const appointmentEnd = useMemo(() => {
		// Keeps the end time value safe if the summary has not loaded yet
		if (!summaryData?.state.endAt) return null;

		return summaryData.state.endAt;
	}, [summaryData]);

	if (loading) return <div className="appointmentSummaryViewPage"><p>Loading...</p></div>;

	if (pageError && !summaryData) {
		return (
			<div className="appointmentSummaryViewPage">
				<div className="appointmentSummaryViewError">{pageError}</div>
				<Link className="appointmentSummaryViewBackBtn" to="/userprofile">Back to My Profile</Link>
			</div>
		);
	}
    // if still no summary data, render nothing
	if (!summaryData) return null;

	const groomingAppointment = isGroomingReason(summaryData.appointment.reasonKey);
	const groomingImagePath = getGroomingImagePath(summaryData);

	return (
		<div className="appointmentSummaryViewPage">
			<div className="appointmentSummaryViewTopBar">
				<Link className="appointmentSummaryViewBackBtn" to="/userprofile">Back to My Profile</Link>
			</div>

			<section className="appointmentSummaryViewCard">
				<h1>{formatReasonLabel(summaryData.appointment.reasonKey)}</h1>
				<div className="appointmentSummaryViewDetailsGrid">
					<DetailItem label="For" value={summaryData.appointment.petName} />
					<DetailItem label="Date" value={formatDate(summaryData.appointment.date)} />
					<DetailItem label="Start Time" value={formatTime(summaryData.state.startAt)} />
					<DetailItem label="End Time" value={formatTime(appointmentEnd)} />
					<DetailItem label="Room" value={summaryData.appointment.roomNumber ? `Room ${summaryData.appointment.roomNumber}` : "N/A"} />
				</div>
			</section>

			<section className="appointmentSummaryViewCard">
				<h2>Mini Pet Profile</h2>
				<div className="appointmentSummaryViewDetailsGrid">
					<DetailItem label="Pet Name" value={summaryData.miniPetProfile.petName} />
					<DetailItem label="Type" value={summaryData.miniPetProfile.petType} />
					<DetailItem label="Breed" value={summaryData.miniPetProfile.breed} />
					<DetailItem label="Sex" value={summaryData.miniPetProfile.petSex} />
					<DetailItem label="Spayed / Neutered" value={summaryData.miniPetProfile.spayedNeutered} />
					<DetailItem label="Age" value={summaryData.miniPetProfile.age === null ? null : String(summaryData.miniPetProfile.age)} />
					<DetailItem label="Current Medications" value={summaryData.miniPetProfile.currentMedications} />
					<DetailItem label="Medication History" value={summaryData.miniPetProfile.medicationHistory} />
					<DetailItem label="Allergies" value={summaryData.miniPetProfile.allergies} />
					<DetailItem label="Current Conditions" value={summaryData.miniPetProfile.currentConditions} />
					<DetailItem label="Past Conditions" value={summaryData.miniPetProfile.pastConditions} />
					<DetailItem label="Vaccinations" value={summaryData.miniPetProfile.vaccinationsUpToDate} />
					<DetailItem label="Heartworm Prevention" value={summaryData.miniPetProfile.heartwormPreventionCurrent} />
				</div>
			</section>

			{groomingAppointment ? (
				<section className="appointmentSummaryViewCard">
					<h2>Grooming Details</h2>

					{summaryData.appointment.groomingDyeStyleKey ? (
						<div className="appointmentSummaryViewInfoBox">
							<strong>Requested Style:</strong> {formatStyleKey(summaryData.appointment.groomingDyeStyleKey)}
						</div>
					) : null}

					{groomingImagePath ? (
						<div className="appointmentSummaryViewImageWrap">
							<span className="appointmentSummaryViewDetailLabel">
								{summaryData.appointment.groomingReferencePhotoPath ? "Reference Photo" : "Selected Preset Style"}
							</span>
							<img className="appointmentSummaryViewImage" src={groomingImagePath} alt="Grooming style reference" />
						</div>
					) : null}

					{summaryData.appointment.groomingStyleNotes ? (
						<div className="appointmentSummaryViewInfoBox">
							<strong>Customer Style Notes:</strong> {summaryData.appointment.groomingStyleNotes}
						</div>
					) : null}
				</section>
			) : null}

			<section className="appointmentSummaryViewCard">
				<h2>Appointment Summary</h2>
				<div className="appointmentSummaryViewFieldsGrid">
					<SummaryField label="Symptoms" value={summaryData.summary.symptoms} />
					<SummaryField label="Diagnosis" value={summaryData.summary.diagnosis} />
					<SummaryField label="Medication Prescribed" value={summaryData.summary.medicationPrescribed} />
					<SummaryField label="Treatment Performed" value={summaryData.summary.treatmentPerformed} />
					<SummaryField label="Notes" value={summaryData.summary.notes} />
				</div>
			</section>
		</div>
	);
}