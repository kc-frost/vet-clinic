export type ReasonKey =
	| "wellness_exam"
	| "vaccination"
	| "fracture"
	| "surgery_consult";

export type ReasonOption = {
	label: string;
	key: ReasonKey;
};

export const REASON_OPTIONS: ReasonOption[] = [
	{ label: "Wellness Exam", key: "wellness_exam" },
	{ label: "Vaccination", key: "vaccination" },
	{ label: "Fracture Concern", key: "fracture" },
	{ label: "Surgery Consult", key: "surgery_consult" },
];


export type PetType = "Dog" | "Cat" | "Other";
export type PetSex = "Male" | "Female" | "Unknown";
export type YesNoUnknown = "Yes" | "No" | "Unknown";
export type HeartwormStatus = "Yes" | "No" | "Unsure" | "Not Applicable";

export type ReservationFormData = {
	// Owner/ContactInfo
	legalFirstName: string;
	legalLastName: string;
	email: string;
	phone: string;
	addressLine1: string;
	city: string;
	state: string; // 2 letter state code selected from dropdown, like TX
	zipCode: string; // 12345 or 12345-6789

	// Pet Information
	petName: string;
	petType: PetType;
	breed: string;
	petSex: PetSex;
	spayedNeutered: YesNoUnknown;
	petAge: number | ""; // use "" for controlled input empty state

	// Appointment Details
	reasonForVisit: ReasonKey | "";
	reasonDetails: string;
	appointmentDate: string; // YYYY-MM-DD
	appointmentTimeSlot: string; // could be interpreted as slotId or "HH:mm-HH:mm"

	// Medical / Safety
	currentMedications: string;
	knownAllergies: string;
	pastInjuriesConditions: string;
	vaccinationsUpToDate: "Yes" | "No" | "Unsure" | "";
	heartwormPreventionCurrent: HeartwormStatus | "";

	// Insurance (optional)
	insuranceProvider: string;
	insuranceMemberId: string;

	// Final consent
	consentToFormInfo: boolean;
};

// Field-level errors keyed by form field name
export type ReservationFormErrors = Partial<
	Record<keyof ReservationFormData, string>
>;

// Availability contracts
export type AvailabilityQuery = {
	reasonKey: ReasonKey;
	startDate: string; // YYYY-MM-DD
	endDate: string; // YYYY-MM-DD
};

export type AvailableSlot = {
	slotId: string; // preferred backend id for submission
	date: string; // YYYY-MM-DD
	startTime: string; // HH:mm
	endTime: string; // HH:mm
	displayLabel: string; // ex, "11:00 AM - 12:00 PM"
};

export type AvailabilityResponse = {
	reasonKey: ReasonKey;
	slots: AvailableSlot[];
};

// Initial/default form state
export const INITIAL_RESERVATION_FORM: ReservationFormData = {
	legalFirstName: "",
	legalLastName: "",
	email: "",
	phone: "",
	addressLine1: "",
	city: "",
	state: "",
	zipCode: "",

	petName: "",
	petType: "Dog",
	breed: "",
	petSex: "Unknown",
	spayedNeutered: "Unknown",
	petAge: "",

	reasonForVisit: "",
	reasonDetails: "",
	appointmentDate: "",
	appointmentTimeSlot: "",

	currentMedications: "",
	knownAllergies: "",
	pastInjuriesConditions: "",
	vaccinationsUpToDate: "",
	heartwormPreventionCurrent: "",

	insuranceProvider: "",
	insuranceMemberId: "",

	consentToFormInfo: false,
};
