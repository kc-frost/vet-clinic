export const REASON_RULES = {
	WELLNESS_EXAM: {
		reasonKey: "WELLNESS_EXAM",
		durationMinutes: 45,
		requiredStaff: [{ roleKey: "GP_VET", qty: 1 }],
		roomType: "EXAM",
		nonConsumables: [],
		consumables: [{ itemKey: "EXAM_SUPPLY_KIT", qty: 1 }],
	},

	RABIES_VACCINATION: {
		reasonKey: "RABIES_VACCINATION",
		durationMinutes: 15,
		requiredStaff: [{ roleKey: "GP_VET", qty: 1 }],
		roomType: "EXAM",
		nonConsumables: [],
		consumables: [
			{ itemKey: "RABIES_VACCINE_DOSE", qty: 1 },
			{ itemKey: "SYRINGE_3ML", qty: 1 },
			{ itemKey: "ALCOHOL_WIPE", qty: 1 },
			{ itemKey: "GAUZE_PAD", qty: 1 },
		],
	},

	BORDETELLA_VACCINATION: {
		reasonKey: "BORDETELLA_VACCINATION",
		durationMinutes: 15,
		requiredStaff: [{ roleKey: "GP_VET", qty: 1 }],
		roomType: "EXAM",
		nonConsumables: [],
		consumables: [
			{ itemKey: "BORDETELLA_VACCINE_DOSE", qty: 1 },
			{ itemKey: "SYRINGE_3ML", qty: 1 },
			{ itemKey: "ALCOHOL_WIPE", qty: 1 },
			{ itemKey: "GAUZE_PAD", qty: 1 },
		],
	},

	DENTAL_CLEANING: {
		reasonKey: "DENTAL_CLEANING",
		durationMinutes: 75,
		requiredStaff: [
			{ roleKey: "DENTIST", qty: 1 },
			{ roleKey: "SURGEON_ASSISTANT", qty: 1 },
		],
		roomType: "SURGERY",
		nonConsumables: ["ANESTHESIA_MACHINE", "DENTAL_SCALER_UNIT"],
		consumables: [
			{ itemKey: "DENTAL_CLEANING_KIT", qty: 1 },
			{ itemKey: "DENTAL_POLISH_PASTE_DOSE", qty: 1 },
			{ itemKey: "CARPROFEN_DOSE", qty: 1 },
		],
	},

	DENTAL_EXTRACTION: {
		reasonKey: "DENTAL_EXTRACTION",
		durationMinutes: 90,
		requiredStaff: [
			{ roleKey: "DENTIST", qty: 1 },
			{ roleKey: "SURGEON_ASSISTANT", qty: 1 },
		],
		roomType: "SURGERY",
		nonConsumables: ["ANESTHESIA_MACHINE", "ORAL_SURGICAL_INSTRUMENT_SET"],
		consumables: [
			{ itemKey: "DENTAL_EXTRACTION_PACK", qty: 1 },
			{ itemKey: "SUTURE_KIT", qty: 1 },
			{ itemKey: "AMOXICILLIN_DOSE", qty: 1 },
			{ itemKey: "CARPROFEN_DOSE", qty: 1 },
		],
	},

	XRAY_EVALUATION: {
		reasonKey: "XRAY_EVALUATION",
		durationMinutes: 45,
		requiredStaff: [
			{ roleKey: "GP_VET", qty: 1 },
			{ roleKey: "XRAY_TECH", qty: 1 },
		],
		roomType: "IMAGING",
		nonConsumables: ["XRAY_MACHINE"],
		consumables: [{ itemKey: "POSITIONING_WEDGE", qty: 1 }],
	},

	CAST_CHANGE: {
		reasonKey: "CAST_CHANGE",
		durationMinutes: 30,
		requiredStaff: [
			{ roleKey: "GP_VET", qty: 1 },
			{ roleKey: "XRAY_TECH", qty: 1 },
		],
		roomType: "EXAM",
		nonConsumables: [],
		consumables: [{ itemKey: "CAST_CHANGE_SUPPLY_KIT", qty: 1 }],
	},

	BASIC_GROOMING: {
		reasonKey: "BASIC_GROOMING",
		durationMinutes: 60,
		requiredStaff: [{ roleKey: "GROOMER", qty: 1 }],
		roomType: "GROOMING",
		nonConsumables: [],
		consumables: [
			{ itemKey: "TROPICLEAN_SHAMPOO_DOSE", qty: 1 },
			{ itemKey: "EAR_CLEANING_SOLUTION_DOSE", qty: 1 },
			{ itemKey: "NAIL_GRINDER_DISPOSABLE_HEAD", qty: 1 },
			{ itemKey: "PET_WIPE_PACK", qty: 1 },
		],
	},

	FLEA_BATH_GROOMING: {
		reasonKey: "FLEA_BATH_GROOMING",
		durationMinutes: 60,
		requiredStaff: [{ roleKey: "GROOMER", qty: 1 }],
		roomType: "GROOMING",
		nonConsumables: [],
		consumables: [
			{ itemKey: "FLEA_TREATMENT_SHAMPOO_DOSE", qty: 1 },
			{ itemKey: "EAR_CLEANING_SOLUTION_DOSE", qty: 1 },
			{ itemKey: "NAIL_GRINDER_DISPOSABLE_HEAD", qty: 1 },
			{ itemKey: "PET_WIPE_PACK", qty: 1 },
		],
	},
	
	GROOMING_DYE: {
		reasonKey: "GROOMING_DYE",
		durationMinutes: 75,
		requiredStaff: [{ roleKey: "GROOMER", qty: 1 }],
		roomType: "GROOMING",
		nonConsumables: [],
		consumables: [
			{ itemKey: "TROPICLEAN_SHAMPOO_DOSE", qty: 1 },
			{ itemKey: "EAR_CLEANING_SOLUTION_DOSE", qty: 1 },
			{ itemKey: "NAIL_GRINDER_DISPOSABLE_HEAD", qty: 1 },
			{ itemKey: "PET_WIPE_PACK", qty: 1 },
			{ itemKey: "PET_SAFE_DYE_DOSE", qty: 1 },
		],
	},
	

	EMERGENCY_TRAUMA: {
		reasonKey: "EMERGENCY_TRAUMA",
		durationMinutes: 120,
		requiredStaff: [
			{ roleKey: "SURGEON", qty: 1 },
			{ roleKey: "SURGEON_ASSISTANT", qty: 1 },
		],
		roomType: "SURGERY",
		nonConsumables: ["ANESTHESIA_MACHINE"],
		consumables: [
			{ itemKey: "STERILE_BANDAGE_PACK", qty: 2 },
			{ itemKey: "AMOXICILLIN_DOSE", qty: 1 },
			{ itemKey: "CARPROFEN_DOSE", qty: 1 },
			{ itemKey: "SUTURE_KIT", qty: 1 },
			{ itemKey: "SALINE_FLUSH", qty: 1 },
		],
	},

	ULTRASOUND: {
		reasonKey: "ULTRASOUND",
		durationMinutes: 45,
		requiredStaff: [
			{ roleKey: "GP_VET", qty: 1 },
			{ roleKey: "ULTRASOUND_TECH", qty: 1 },
		],
		roomType: "IMAGING",
		nonConsumables: ["ULTRASOUND_MACHINE"],
		consumables: [],
	},
};

const REASON_ALIASES = {
	wellness_exam: "WELLNESS_EXAM",
	rabies_vaccination: "RABIES_VACCINATION",
	bordetella_vaccination: "BORDETELLA_VACCINATION",
	dental_cleaning: "DENTAL_CLEANING",
	dental_extraction: "DENTAL_EXTRACTION",
	xray_evaluation: "XRAY_EVALUATION",
	cast_change: "CAST_CHANGE",
	basic_grooming: "BASIC_GROOMING",
	flea_bath_grooming: "FLEA_BATH_GROOMING",
	grooming_dye: "GROOMING_DYE",
	emergency: "EMERGENCY_TRAUMA",
	emergency_trauma: "EMERGENCY_TRAUMA",
	ultrasound: "ULTRASOUND",

};

export function normalizeReasonKey(rawReasonKey) {
	if (!rawReasonKey) return "";

	const trimmedReasonKey = String(rawReasonKey).trim();
	if (!trimmedReasonKey) return "";

	const upperReasonKey = trimmedReasonKey.toUpperCase();
	if (REASON_RULES[upperReasonKey]) return upperReasonKey;

	const lowerReasonKey = trimmedReasonKey.toLowerCase();
	if (REASON_ALIASES[lowerReasonKey]) return REASON_ALIASES[lowerReasonKey];

	return upperReasonKey;
}

export function getRule(rawReasonKey) {
	const normalizedReasonKey = normalizeReasonKey(rawReasonKey);
	return REASON_RULES[normalizedReasonKey] || null;
}
