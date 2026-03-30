    export type ReasonKey =
        | "WELLNESS_EXAM"
        | "VACCINATION"
        | "DENTAL_CLEANING"
        | "FRACTURE"
        | "GROOMING"
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
            value: "VACCINATION",
            label: "Vaccination",
            description: "Routine vaccines and boosters.",
        },
        {
            value: "DENTAL_CLEANING",
            label: "Dental Cleaning",
            description: "Professional cleaning and dental care.",
        },
        {
            value: "FRACTURE",
            label: "Fracture / X-Ray",
            description: "Injury evaluation, imaging, and treatment planning.",
        },
        {
            value: "ULTRASOUND",
            label: "Ultrasound",
            description: "Ultrasound imaging and diagnostics.",
        },
        {
            value: "GROOMING",
            label: "Grooming",
            description: "Bathing, trimming, and grooming services.",
        },
        {
            value: "EMERGENCY_TRAUMA",
            label: "Emergency / Trauma",
            description: "Urgent care for injuries and emergencies.",
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
        knownAllergies: string;
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
        knownAllergies: string;
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
        knownAllergies: "",
        pastInjuriesConditions: "",
        vaccinationsUpToDate: "",
        heartwormPreventionCurrent: "",

        insuranceProvider: "",
        insuranceMemberId: "",
        consentToFormInfo: false,
    };
