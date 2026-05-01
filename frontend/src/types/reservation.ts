export type ReasonKey =
	| "WELLNESS_EXAM"
	| "RABIES_VACCINATION"
	| "BORDETELLA_VACCINATION"
	| "DENTAL_CLEANING"
	| "DENTAL_EXTRACTION"
	| "XRAY_EVALUATION"
	| "CAST_CHANGE"
	| "BASIC_GROOMING"
	| "FLEA_BATH_GROOMING"
	| "EMERGENCY_TRAUMA"
	| "ULTRASOUND";

export type ReasonOption = {
	value: ReasonKey;
	label: string;
	description: string;
};

export const REASON_OPTIONS: ReasonOption[] = [
	{
		value: "WELLNESS_EXAM",
		label: "Wellness Exam",
		description: "General checkup and routine exam.",
	},
	{
		value: "RABIES_VACCINATION",
		label: "Rabies Vaccination",
		description: "Rabies vaccine appointment.",
	},
	{
		value: "BORDETELLA_VACCINATION",
		label: "Bordetella Vaccination",
		description: "Bordetella vaccine appointment.",
	},
	{
		value: "DENTAL_CLEANING",
		label: "Dental Cleaning",
		description: "Routine dental cleaning appointment.",
	},
	{
		value: "DENTAL_EXTRACTION",
		label: "Dental Extraction",
		description: "Dental extraction procedure.",
	},
	{
		value: "XRAY_EVALUATION",
		label: "X-Ray Evaluation",
		description: "Imaging evaluation appointment.",
	},
	{
		value: "CAST_CHANGE",
		label: "Cast Change",
		description: "Cast replacement or cast adjustment appointment.",
	},
	{
		value: "BASIC_GROOMING",
		label: "Basic Grooming",
		description: "Regular grooming session.",
	},
	{
		value: "FLEA_BATH_GROOMING",
		label: "Flea Bath Grooming",
		description: "Grooming session with flea treatment bath.",
	},
	{
		value: "EMERGENCY_TRAUMA",
		label: "Emergency / Trauma",
		description: "Urgent care for injuries and emergencies.",
	},
	{
		value: "ULTRASOUND",
		label: "Ultrasound",
		description: "Ultrasound imaging and diagnostics.",
	},
];

export type CurrentUser = {
	userID: number;
	email: string;
	isAdmin: boolean;
};

export type UserProfile = {
	userID: number;
	email: string;
	legalFirstName: string;
	legalLastName: string;
	phone: string;
	addressLine1: string;
	city: string;
	state: string;
	zipCode: string;
};

export type PetProfile = {
	petID: number;
	petName: string;
	petType: string;
	breed: string;
	petSex: string;
	spayedNeutered: string;
	age: number | null;
	weight: number | null;
	height: number | null;
	behavior: string;
	currentMedications: string;
	medicationHistory: string;
	knownAllergies: string;
	currentConditions: string;
	pastInjuriesConditions: string;
	vaccinationsUpToDate: string;
	heartwormPreventionCurrent: string;
};

export type AvailableSlot = {
	slotId: string;
	date: string;
	startTime: string;
	endTime: string;
	startDateTime: string;
	endDateTime: string;
	staffID: number;
	roomNumber: number;
};

export type AvailabilityResponse = {
	ok: boolean;
	reasonKey: ReasonKey;
	durationMinutes: number;
	timezone: string;
	range: {
		startDate: string;
		days: number;
	};
	slots: AvailableSlot[];
};

export type CreateReservationPayload = {
	userID: number;
	reasonKey: ReasonKey;
	appointmentDate: string;
	startTime: string;
	enablePetProfiles: boolean;
	petID: number | null;
	formData: ReservationFormData;
};

export type CreateReservationResponse = {
	ok: boolean;
	appointmentId: number;
	reasonKey: ReasonKey;
	date: string;
	durationMinutes: number;
	assignedStaff: {
		staffID: number;
		assignedRoleKey: string;
	}[];
	roomNumber: number;
	petID?: number | null;
};

export type ReservationFormData = {
	// owner/contact snapshot fields
	legalFirstName: string;
	legalLastName: string;
	email: string;
	phone: string;
	addressLine1: string;
	city: string;
	state: string;
	zipCode: string;

	// pet snapshot fields
	petName: string;
	petType: string;
	breed: string;
	petSex: string;
	spayedNeutered: string;
	petAge: string;

	// appointment details
	reasonKey: ReasonKey | "";
	appointmentDate: string;
	startTime: string;
	reasonDetails: string;

	// medical/safety snapshot fields
	currentMedications: string;
	medicationHistory: string;
	knownAllergies: string;
	currentConditions: string;
	pastInjuriesConditions: string;
	vaccinationsUpToDate: string;
	heartwormPreventionCurrent: string;

	// insurance, optional
	insuranceProvider: string;
	insuranceMemberId: string;

	// final consent
	consentToFormInfo: boolean;
};

export type ReservationFormErrors = Partial<Record<keyof ReservationFormData, string>>;

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
	petType: "",
	breed: "",
	petSex: "",
	spayedNeutered: "",
	petAge: "",

	reasonKey: "",
	appointmentDate: "",
	startTime: "",
	reasonDetails: "",

	currentMedications: "",
	medicationHistory: "",
	knownAllergies: "",
	currentConditions: "",
	pastInjuriesConditions: "",
	vaccinationsUpToDate: "",
	heartwormPreventionCurrent: "",

	insuranceProvider: "",
	insuranceMemberId: "",
	consentToFormInfo: false,
};