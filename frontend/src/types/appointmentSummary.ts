// Save status text used by the staff summary page while autosave runs
export type SummarySaveStatus = "idle" | "saving" | "saved" | "error";

export type AppointmentSummaryAppointment = {
	appointmentID: number;
	reasonKey: string;
	date: string | null;
	durationMinutes: number;
	roomNumber: number | null;
	isCanceled: boolean;
	underReview: boolean;
	petID: number | null;
	petName: string;
	reasonDetails: string;
	groomingDyeStyleKey: string;
	groomingReferencePhotoPath: string;
	groomingStyleNotes: string;
	followUpAppointmentID: number | null;
};

export type AppointmentSummaryOwner = {
	userID: number;
	legalFirstName: string;
	legalLastName: string;
	email: string;
};

// These are the appointment-specific summary fields staff writes
export type AppointmentSummaryFields = {
	symptoms: string;
	diagnosis: string;
	medicationPrescribed: string;
	treatmentPerformed: string;
	notes: string;
	isFinalized: boolean;
	finalizedByStaffID: number | null;
	finalizedByStaffName: string | null;
	finalizedAt: string | null;
};

// This is the read-only pet profile context shown to staff
export type MiniPetProfile = {
	petName: string;
	petType: string;
	breed: string;
	petSex: string;
	spayedNeutered: string;
	age: number | null;
	currentMedications: string;
	medicationHistory: string;
	allergies: string;
	currentConditions: string;
	pastConditions: string;
	vaccinationsUpToDate: string;
	heartwormPreventionCurrent: string;
};

// These are the staged pet profile updates staff can edit before finalizing
export type DraftPetProfile = {
	allergies: string;
	currentMedications: string;
	medicationHistory: string;
	currentConditions: string;
	pastConditions: string;
	vaccinationsUpToDate: string;
	heartwormPreventionCurrent: string;
};

export type AppointmentSummaryState = {
	isEditableNow: boolean;
	shouldAutoFinalize: boolean;
	isOngoing: boolean;
	canFinalizeNow: boolean;
	editStartsAt: string;
	editEndsAt: string;
	startAt: string;
	endAt: string;
};

export type StaffAppointmentSummaryResponse = {
	appointment: AppointmentSummaryAppointment;
	owner: AppointmentSummaryOwner;
	summary: AppointmentSummaryFields;
	miniPetProfile: MiniPetProfile;
	draftPetProfile: DraftPetProfile;
	state: AppointmentSummaryState;
};

export type AppointmentSummaryDraftPayload = {
	symptoms: string;
	diagnosis: string;
	medicationPrescribed: string;
	treatmentPerformed: string;
	notes: string;
	draftPetProfile: DraftPetProfile;
};

export type FollowUpPrefillResponse = {
	sourceAppointmentID: number;
	owner: {
		userID: number;
		legalFirstName: string;
		legalLastName: string;
		email: string;
	};
	pet: {
		petID: number | null;
		petName: string;
		petType: string;
		breed: string;
		petSex: string;
		spayedNeutered: string;
		petAge: number | null;
		currentMedications: string;
		medicationHistory: string;
		knownAllergies: string;
		currentConditions: string;
		pastInjuriesConditions: string;
		vaccinationsUpToDate: string;
		heartwormPreventionCurrent: string;
	};
	suggestedReasonKey: string;
};

export type CustomerAppointmentSummaryResponse = StaffAppointmentSummaryResponse;

export type CreateFollowUpPayload = {
	reasonKey: string;
	appointmentDate: string;
	startTime: string;
};

export type CreateFollowUpResponse = {
	ok: boolean;
	appointmentId: number;
	reasonKey: string;
	date: string;
	durationMinutes: number;
	roomNumber: number;
	petID: number | null;
	followUpAppointmentID: number;
};