import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import "../../styles/userProfile.css";

import { getCurrentUser, type AuthUser } from "../../api/auth";
import { api } from "../../api/client";
import { getAvailability, getPetsForUser, updatePetProfile } from "../../api/reservations";
import { getMyAppointments, cancelMyAppointment, rescheduleMyAppointment } from "../../api/appointments";
import SlotCalendar from "../../components/calendar/SlotCalendar";

import type { PetProfile, ReasonKey } from "../../types/reservation";
import type { Appointment } from "../../types/appointment";

/*
	Development bypass switch

	true means the page uses local fake data so the UI can be worked on
	without needing backend auth or live API routes

	false means normal real mode using the backend
*/
const DEV_BYPASS_AUTH = false;

/*
	Allowed 2 letter state codes for the user info form
*/
const US_STATE_CODES = [
	"AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
	"HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
	"MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
	"NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
	"SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

/*
	Profile shape returned by the backend profile route

	This is the full profile object the page receives from the API
*/
type UserProfileData = {
	userID: number;
	email: string;
	userBio: string;
	legalFirstName: string;
	legalLastName: string;
	phone: string;
	addressLine1: string;
	city: string;
	state: string;
	zipCode: string;
	profileImagePath: string;
	userType: string;
};

/*
	Only the editable user info fields shown in the info card

	This keeps the editable draft separate from the full profile object
*/
type UserInfoDraft = {
	legalFirstName: string;
	legalLastName: string;
	phone: string;
	addressLine1: string;
	city: string;
	state: string;
	zipCode: string;
};

/*
	Validation errors for the editable user info fields

	The keys match UserInfoDraft, but each error is optional
*/
type UserInfoErrors = Partial<Record<keyof UserInfoDraft, string>>;

/*
	Simplified reservation shape used by this page

	The backend appointment object has more database style fields

	This shape keeps the fields the profile page actually needs for
	rendering, canceling, rescheduling, and linking to summaries
*/
type Reservation = {
	id: number;
	petID?: number | null;
	petName: string;
	reasonKey: string;
	roomNumber: number | null;
	startTime: string;
	endTime: string | null;
	appointmentDateRaw: string;
	startTimeRaw: string;
	summaryIsFinalized: boolean;
	canModify: boolean;
};

/*
	Pet profile shape used by this page

	It extends the shared PetProfile type with userID because this page
	may receive user linked pet records from the backend
*/
type Pet = PetProfile & {
	userID?: number;
};

/*
	Validation errors for each editable pet card

	Each pet can have its own set of field errors
*/
type PetErrors = Partial<Record<
	| "petName"
	| "petType"
	| "breed"
	| "petSex"
	| "spayedNeutered"
	| "age"
	| "currentMedications"
	| "knownAllergies"
	| "pastInjuriesConditions"
	| "vaccinationsUpToDate"
	| "heartwormPreventionCurrent",
	string
>>;

/*
	Local development sample authenticated user

	Used only when DEV_BYPASS_AUTH is true
*/
const DEV_USER: AuthUser = {
	userID: 1,
	email: "dev.user@email.com",
	userType: "CUSTOMER",
	isAdmin: false,
	isStaff: false,
};

/*
	Local development sample profile

	Used only when DEV_BYPASS_AUTH is true
*/
const DEV_PROFILE: UserProfileData = {
	userID: 1,
	email: "dev.user@email.com",
	userBio: "This is a local test bio for Sprint 3.",
	legalFirstName: "Dev",
	legalLastName: "User",
	phone: "512-555-1234",
	addressLine1: "123 Demo Street",
	city: "Austin",
	state: "TX",
	zipCode: "78701",
	profileImagePath: "",
	userType: "CUSTOMER",
};

/*
	Base dates used to build local sample appointments
*/
const now = new Date();

const yesterday = new Date(now);
yesterday.setDate(now.getDate() - 1);
yesterday.setHours(10, 0, 0, 0);

const todayAppt = new Date(now);
todayAppt.setHours(14, 0, 0, 0);

const tomorrow = new Date(now);
tomorrow.setDate(now.getDate() + 1);
tomorrow.setHours(9, 30, 0, 0);

function toMysqlDateTime(d: Date) {
	/*
		Convert a JavaScript Date into MySQL style datetime text
	*/
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function toDateOnly(d: Date) {
	/*
		Convert a Date into YYYY MM DD text for slot dates
	*/
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isBlank(v: string) {
	/*
		Treat empty text and whitespace only text as blank
	*/
	return !v || v.trim() === "";
}

function isPhone(v: string) {
	/*
		Basic phone validation used by the profile form
	*/
	return /^\+?\d[\d\s().-]{7,}$/.test(v.trim());
}

function isZip(v: string) {
	/*
		Allow either 5 digit ZIP or ZIP plus 4 format
	*/
	return /^\d{5}(-\d{4})?$/.test(v.trim());
}

function is2LetterState(v: string) {
	/*
		Require a 2 letter state code
	*/
	return /^[A-Za-z]{2}$/.test(v.trim());
}

function normalizeUserInfo(profile: UserProfileData): UserInfoDraft {
	/*
		Copy only the editable profile fields into the user info draft

		The form edits this draft instead of editing the full profile object directly
	*/
	return {
		legalFirstName: profile.legalFirstName || "",
		legalLastName: profile.legalLastName || "",
		phone: profile.phone || "",
		addressLine1: profile.addressLine1 || "",
		city: profile.city || "",
		state: profile.state || "",
		zipCode: profile.zipCode || "",
	};
}

function normalizePetForDraft(pet: Pet) {
	/*
		Copy a pet record into the editable draft shape used by the pet form

		The age is converted to text because input fields store typed values as strings
	*/
	return {
		petName: pet.petName || "",
		petType: pet.petType || "",
		breed: pet.breed || "",
		petSex: pet.petSex || "",
		spayedNeutered: pet.spayedNeutered || "",
		age: pet.age === null || pet.age === undefined ? "" : String(pet.age),
		currentMedications: pet.currentMedications || "",
		knownAllergies: pet.knownAllergies || "",
		pastInjuriesConditions: pet.pastInjuriesConditions || "",
		vaccinationsUpToDate: pet.vaccinationsUpToDate || "",
		heartwormPreventionCurrent: pet.heartwormPreventionCurrent || "",
	};
}

function shallowEqual(a: Record<string, any>, b: Record<string, any>) {
	/*
		Compare two simple objects by checking their direct fields

		This is used to tell if a draft has changed from the saved version
	*/
	const keys = Object.keys(a);
	if (keys.length !== Object.keys(b).length) return false;

	for (const k of keys) {
		if ((a as any)[k] !== (b as any)[k]) return false;
	}

	return true;
}

/*
	Local development sample appointments

	Used only when DEV_BYPASS_AUTH is true
*/
const DEV_APPOINTMENTS: Appointment[] = [
	{
		appointmentID: 101,
		userID: 1,
		roomNumber: 2,
		petID: 1,
		reasonKey: "WELLNESS_EXAM",
		date: toMysqlDateTime(yesterday),
		durationMinutes: 30,
	},
	{
		appointmentID: 102,
		userID: 1,
		roomNumber: 4,
		petID: 1,
		reasonKey: "VACCINATION",
		date: toMysqlDateTime(todayAppt),
		durationMinutes: 45,
	},
	{
		appointmentID: 103,
		userID: 1,
		roomNumber: 1,
		petID: 2,
		reasonKey: "FOLLOW_UP",
		date: toMysqlDateTime(tomorrow),
		durationMinutes: 20,
	},
];

/*
	Local development sample pets

	Used only when DEV_BYPASS_AUTH is true
*/
const DEV_PETS: Pet[] = [
	{
		petID: 1,
		userID: 1,
		petName: "Buddy",
		petType: "DOG",
		breed: "Golden Retriever",
		petSex: "MALE",
		spayedNeutered: "YES",
		age: 4,
		weight: 65,
		height: 2,
		behavior: "Friendly",
		currentMedications: "None",
		knownAllergies: "Chicken",
		pastInjuriesConditions: "Sprained leg in 2024",
		vaccinationsUpToDate: "Yes",
		heartwormPreventionCurrent: "Yes",
	},
	{
		petID: 2,
		userID: 1,
		petName: "Luna",
		petType: "CAT",
		breed: "Tabby",
		petSex: "FEMALE",
		spayedNeutered: "YES",
		age: 2,
		weight: 10,
		height: 1,
		behavior: "Calm",
		currentMedications: "None",
		knownAllergies: "None",
		pastInjuriesConditions: "None",
		vaccinationsUpToDate: "Yes",
		heartwormPreventionCurrent: "No",
	},
];

function startOfDay(d: Date) {
	/*
		Get the first millisecond of the same day
	*/
	const x = new Date(d);
	x.setHours(0, 0, 0, 0);
	return x;
}

function endOfDay(d: Date) {
	/*
		Get the last millisecond of the same day
	*/
	const x = new Date(d);
	x.setHours(23, 59, 59, 999);
	return x;
}

function mysqlDateTimeToIso(mysqlDt: string) {
	/*
		Convert MySQL datetime text into ISO text that JavaScript Date
		parses more reliably

		The backend may send something like 2026 04 30 14:00:00 with spaces,
		so this makes it easier for the frontend to work with
	*/
	const s = String(mysqlDt || "");
	if (!s) return new Date(NaN).toISOString();
	if (/^\d{4}-\d{2}-\d{2} /.test(s)) return new Date(s.replace(" ", "T")).toISOString();
	return new Date(s).toISOString();
}

function addMinutes(iso: string, mins: number) {
	/*
		Add appointment duration to the start time so the UI can show an end time
	*/
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return null;
	d.setMinutes(d.getMinutes() + mins);
	return d.toISOString();
}

function mysqlDateOnly(mysqlDt: string) {
	/*
		Pull only the date portion from a MySQL datetime string
	*/
	const s = String(mysqlDt || "");
	const datePart = s.split(" ")[0] || "";
	return datePart;
}

function mysqlTimeOnly(mysqlDt: string) {
	/*
		Pull HH:MM time text from a MySQL datetime string
	*/
	const s = String(mysqlDt || "");
	const timePart = s.split(" ")[1] || "";
	return timePart.slice(0, 5);
}

function formatReasonLabel(reasonKey: string) {
	/*
		Turn backend reason keys like WELLNESS_EXAM into Wellness Exam
	*/
	return String(reasonKey || "")
		.toLowerCase()
		.split("_")
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function formatCardDate(value: string) {
	/*
		Format appointment date text for the reservation cards
	*/
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleDateString("en-US", { year: "numeric", month: "numeric", day: "numeric" });
}

function formatCardTime(value: string) {
	/*
		Format appointment time text for the reservation cards
	*/
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

async function fetchProfile(userID: number) {
	/*
		Load the current user's profile record
	*/
	return api<UserProfileData>(`/profile?userID=${userID}`, { method: "GET" });
}

async function updateProfile(userID: number, payload: Partial<UserProfileData>) {
	/*
		Update editable profile fields or biography
	*/
	return api<UserProfileData>(`/profile?userID=${userID}`, {
		method: "PUT",
		body: payload,
	});
}

async function uploadProfileImage(userID: number, file: File) {
	/*
		Upload one profile picture file for the current user
	*/
	const formData = new FormData();
	formData.append("profileImage", file);

	const response = await fetch(`/api/profile/photo?userID=${userID}`, {
		method: "POST",
		body: formData,
		credentials: "include",
	});

	const data = await response.json();

	if (!response.ok) {
		throw new Error(data?.error || "failed to upload profile picture");
	}

	return data.profile as UserProfileData;
}

function mapAppointmentsToReservations(rows: Appointment[]) {
	/*
		Convert raw appointment rows into the smaller reservation shape this page renders

		The backend gives appointment style fields like appointmentID, date, and durationMinutes
		The profile page wants card friendly fields like id, startTime, endTime, and canModify
	*/
	const nowMs = Date.now();

	return rows.map((a) => {
		/*
			Turn the backend start date into an ISO start time, then calculate the end time
		*/
		const startIso = mysqlDateTimeToIso(a.date);
		const endIso = addMinutes(startIso, Number(a.durationMinutes || 0));
		const startMs = new Date(startIso).getTime();

		return {
			id: Number(a.appointmentID),
			petID: a.petID ?? null,
			petName: a.petName || "Unknown Pet",
			reasonKey: a.reasonKey,
			roomNumber: a.roomNumber ?? null,
			startTime: startIso,
			endTime: endIso,
			appointmentDateRaw: mysqlDateOnly(a.date),
			startTimeRaw: mysqlTimeOnly(a.date),
			summaryIsFinalized: Boolean(a.summaryIsFinalized),
			canModify: startMs >= nowMs,
		};
	});
}

/*
	User profile page

	This page shows the user's profile info, profile picture, biography,
	appointments, and pet profiles

	It also lets the user cancel or reschedule upcoming appointments
*/
export default function UserProfile() {
	/*
		Authenticated user loaded from the backend
	*/
	const [authUser, setAuthUser] = useState<AuthUser | null>(null);

	/*
		Saved profile is the backend version

		Profile draft is the editable form version
	*/
	const [profile, setProfile] = useState<UserProfileData | null>(null);
	const [profileDraft, setProfileDraft] = useState<UserInfoDraft>({
		legalFirstName: "",
		legalLastName: "",
		phone: "",
		addressLine1: "",
		city: "",
		state: "",
		zipCode: "",
	});
	const [profileErrors, setProfileErrors] = useState<UserInfoErrors>({});
	const [savingProfileInfo, setSavingProfileInfo] = useState(false);

	/*
		Reservations are the mapped appointment cards shown in past, today, and future
	*/
	const [reservations, setReservations] = useState<Reservation[]>([]);

	/*
		Biography has its own draft because it saves separately from the main info card
	*/
	const [bioDraft, setBioDraft] = useState("");

	/*
		Pets is the saved backend data

		Pet drafts are the editable form values for each pet, keyed by petID
	*/
	const [pets, setPets] = useState<Pet[]>([]);
	const [petDrafts, setPetDrafts] = useState<Record<number, ReturnType<typeof normalizePetForDraft>>>({});
	const [petErrors, setPetErrors] = useState<Record<number, PetErrors>>({});
	const [savingPetId, setSavingPetId] = useState<number | null>(null);

	/*
		Page level loading and error state
	*/
	const [loading, setLoading] = useState(true);
	const [savingBio, setSavingBio] = useState(false);
	const [error, setError] = useState<string | null>(null);

	/*
		Profile picture editor state

		The selected file is the real file object
		The preview URL is only for showing the image before upload
	*/
	const [pictureEditOpen, setPictureEditOpen] = useState(false);
	const [selectedPictureFile, setSelectedPictureFile] = useState<File | null>(null);
	const [picturePreviewUrl, setPicturePreviewUrl] = useState("");
	const [pictureError, setPictureError] = useState("");
	const [savingPicture, setSavingPicture] = useState(false);

	/*
		Reschedule state

		When rescheduleTarget is set, the calendar panel appears and the user
		can pick a new slot for that appointment
	*/
	const [rescheduleTarget, setRescheduleTarget] = useState<Reservation | null>(null);
	const [rescheduleSlots, setRescheduleSlots] = useState<any[]>([]);
	const [rescheduleSlotsLoading, setRescheduleSlotsLoading] = useState(false);
	const [rescheduleSlotsError, setRescheduleSlotsError] = useState("");
	const [rescheduleSelectedSlotId, setRescheduleSelectedSlotId] = useState("");
	const [rescheduleDate, setRescheduleDate] = useState("");
	const [rescheduleStartTime, setRescheduleStartTime] = useState("");
	const [rescheduleBusy, setRescheduleBusy] = useState(false);
	const [actionMessage, setActionMessage] = useState<string>("");

	/*
		fileInputRef lets the custom Choose Image button open the hidden file input

		rescheduleSectionRef lets the page scroll down to the reschedule calendar
	*/
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const rescheduleSectionRef = useRef<HTMLDivElement | null>(null);

	async function loadAllProfileData() {
		/*
			Load all page data in one place so initial load and refresh after action
			can reuse the same logic
		*/
		if (DEV_BYPASS_AUTH) {
			setAuthUser(DEV_USER);
			setProfile(DEV_PROFILE);
			setProfileDraft(normalizeUserInfo(DEV_PROFILE));
			setBioDraft(DEV_PROFILE.userBio || "");
			setReservations(mapAppointmentsToReservations(DEV_APPOINTMENTS));
			setPets(DEV_PETS);

			/*
				Build editable pet drafts from the local sample pet data
			*/
			const nextPetDrafts: Record<number, ReturnType<typeof normalizePetForDraft>> = {};
			for (const pet of DEV_PETS) {
				nextPetDrafts[pet.petID] = normalizePetForDraft(pet);
			}
			setPetDrafts(nextPetDrafts);
			return;
		}

		/*
			Load the current logged in user first because profile and pets need the userID
		*/
		const me = await getCurrentUser();
		setAuthUser(me);

		/*
			Load the saved profile, then copy its editable fields into the form draft
		*/
		const p = await fetchProfile(me.userID);
		setProfile(p);
		setProfileDraft(normalizeUserInfo(p));
		setBioDraft(p.userBio || "");

		/*
			Load raw backend appointments, convert them to reservation cards, then store them
		*/
		const appts = await getMyAppointments();
		setReservations(mapAppointmentsToReservations(appts));

		/*
			Load saved pets, then build one editable draft object for each pet
		*/
		const savedPets = await getPetsForUser(me.userID);
		setPets(savedPets);

		const nextPetDrafts: Record<number, ReturnType<typeof normalizePetForDraft>> = {};
		for (const pet of savedPets) {
			nextPetDrafts[pet.petID] = normalizePetForDraft(pet as Pet);
		}
		setPetDrafts(nextPetDrafts);
	}

	useEffect(() => {
		/*
			Initial page load

			Dev mode uses local sample data
			Real mode loads auth, profile, appointments, and pets
		*/
		(async () => {
			try {
				setError(null);
				await loadAllProfileData();
			} catch (e) {
				const msg = e instanceof Error ? e.message : "Unknown error";
				setError(msg);
			} finally {
				setLoading(false);
			}
		})();
	}, []);

	useEffect(() => {
		/*
			Clean up any preview object URL when it changes or when the component unmounts

			Object URLs are browser memory, so they should be released when not needed
		*/
		return () => {
			if (picturePreviewUrl) {
				URL.revokeObjectURL(picturePreviewUrl);
			}
		};
	}, [picturePreviewUrl]);

	useEffect(() => {
		/*
			When reschedule mode opens, scroll the calendar section into view
		*/
		if (!rescheduleTarget) return;

		const id = window.setTimeout(() => {
			rescheduleSectionRef.current?.scrollIntoView({
				behavior: "smooth",
				block: "start",
			});
		}, 80);

		return () => window.clearTimeout(id);
	}, [rescheduleTarget?.id]);

	const { past, today, future } = useMemo(() => {
		/*
			Split reservations into past, today, and future buckets for the three columns

			This recalculates only when reservations changes
		*/
		const now = new Date();
		const start = startOfDay(now).getTime();
		const end = endOfDay(now).getTime();

		const past: Reservation[] = [];
		const today: Reservation[] = [];
		const future: Reservation[] = [];

		for (const r of reservations) {
			const t = new Date(r.startTime).getTime();

			if (t < start) past.push(r);
			else if (t > end) future.push(r);
			else today.push(r);
		}

		/*
			Past shows newest first

			Today and future show soonest first
		*/
		past.sort((a, b) => +new Date(b.startTime) - +new Date(a.startTime));
		today.sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime));
		future.sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime));

		return { past, today, future };
	}, [reservations]);

	const userInfoDirty = useMemo(() => {
		/*
			Check whether the editable user info card has unsaved changes
		*/
		if (!profile) return false;
		return !shallowEqual(profileDraft, normalizeUserInfo(profile));
	}, [profile, profileDraft]);

	const [pictureVersion, setPictureVersion] = useState(0);

	const currentProfileImageSrc = useMemo(() => {
		/*
			Show the preview image first if one is selected

			If there is no preview, show the saved profile image

			If there is no saved profile image, show the default image

			The version query makes the browser reload the saved image after upload
		*/
		if (picturePreviewUrl) return picturePreviewUrl;
		if (profile?.profileImagePath) return `${profile.profileImagePath}?v=${pictureVersion}`;
		return "/default-profile.svg";
	}, [picturePreviewUrl, profile?.profileImagePath, pictureVersion]);

	async function onSaveBio() {
		/*
			Save only the biography text
		*/
		if (!authUser || !profile) return;

		try {
			setSavingBio(true);
			setError(null);

			if (DEV_BYPASS_AUTH) {
				const updated = { ...profile, userBio: bioDraft };
				setProfile(updated);
				setBioDraft(updated.userBio || "");
				return;
			}

			const updated = await updateProfile(authUser.userID, { userBio: bioDraft });
			setProfile(updated);
			setBioDraft(updated.userBio || "");
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to save bio");
		} finally {
			setSavingBio(false);
		}
	}

	function onProfileDraftChange(field: keyof UserInfoDraft, value: string) {
		/*
			Update one user info draft field and clear that field's old error
		*/
		setProfileDraft((prev) => ({ ...prev, [field]: value }));
		setProfileErrors((prev) => ({ ...prev, [field]: "" }));
	}

	function validateUserInfoDraft() {
		/*
			Validate the editable user info fields before saving

			A field is required only if the original saved profile already had that field
			or if the user typed something into that field
		*/
		if (!profile) return false;

		const original = normalizeUserInfo(profile);
		const nextErrors: UserInfoErrors = {};

		if (!isBlank(profileDraft.legalFirstName) || !isBlank(original.legalFirstName)) {
			if (isBlank(profileDraft.legalFirstName)) nextErrors.legalFirstName = "required";
		}

		if (!isBlank(profileDraft.legalLastName) || !isBlank(original.legalLastName)) {
			if (isBlank(profileDraft.legalLastName)) nextErrors.legalLastName = "required";
		}

		if (!isBlank(profileDraft.phone) || !isBlank(original.phone)) {
			if (isBlank(profileDraft.phone)) nextErrors.phone = "required";
			else if (!isPhone(profileDraft.phone)) nextErrors.phone = "invalid phone";
		}

		if (!isBlank(profileDraft.addressLine1) || !isBlank(original.addressLine1)) {
			if (isBlank(profileDraft.addressLine1)) nextErrors.addressLine1 = "required";
		}

		if (!isBlank(profileDraft.city) || !isBlank(original.city)) {
			if (isBlank(profileDraft.city)) nextErrors.city = "required";
		}

		if (!isBlank(profileDraft.state) || !isBlank(original.state)) {
			if (isBlank(profileDraft.state)) nextErrors.state = "required";
			else if (!is2LetterState(profileDraft.state)) nextErrors.state = "use 2 letter state";
		}

		if (!isBlank(profileDraft.zipCode) || !isBlank(original.zipCode)) {
			if (isBlank(profileDraft.zipCode)) nextErrors.zipCode = "required";
			else if (!isZip(profileDraft.zipCode)) nextErrors.zipCode = "invalid zip";
		}

		setProfileErrors(nextErrors);
		return Object.keys(nextErrors).length === 0;
	}

	async function onSaveUserInfo() {
		/*
			Save the editable user info card if there are valid changes
		*/
		if (!authUser || !profile) return;
		if (!userInfoDirty) return;

		const isValid = validateUserInfoDraft();
		if (!isValid) return;

		try {
			setSavingProfileInfo(true);
			setActionMessage("");

			if (DEV_BYPASS_AUTH) {
				const updated = {
					...profile,
					...profileDraft,
				};
				setProfile(updated);
				setProfileDraft(normalizeUserInfo(updated));
				setActionMessage("user info saved");
				return;
			}

			const updated = await updateProfile(authUser.userID, profileDraft);
			setProfile(updated);
			setProfileDraft(normalizeUserInfo(updated));
			setActionMessage("user info saved");
		} catch (e) {
			setActionMessage(e instanceof Error ? e.message : "failed to save user info");
		} finally {
			setSavingProfileInfo(false);
		}
	}

	function onOpenPictureEdit() {
		/*
			Open the picture edit area and clear any old picture error
		*/
		setPictureEditOpen(true);
		setPictureError("");
	}

	function clearPictureSelection() {
		/*
			Clear the selected image file, preview image, and file input value
		*/
		if (picturePreviewUrl) {
			URL.revokeObjectURL(picturePreviewUrl);
		}

		setSelectedPictureFile(null);
		setPicturePreviewUrl("");
		setPictureError("");

		if (fileInputRef.current) {
			fileInputRef.current.value = "";
		}
	}

	function onPictureFileChange(e: React.ChangeEvent<HTMLInputElement>) {
		/*
			Validate the selected image and create a local preview
		*/
		const file = e.target.files?.[0] || null;

		if (picturePreviewUrl) {
			URL.revokeObjectURL(picturePreviewUrl);
		}

		setSelectedPictureFile(null);
		setPicturePreviewUrl("");
		setPictureError("");

		if (!file) return;

		const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
		if (!allowedTypes.has(file.type)) {
			setPictureError("only JPG, PNG, and WEBP images are allowed");
			return;
		}

		if (file.size > 2 * 1024 * 1024) {
			setPictureError("image must be 2MB or smaller");
			return;
		}

		const nextPreviewUrl = URL.createObjectURL(file);
		setSelectedPictureFile(file);
		setPicturePreviewUrl(nextPreviewUrl);
	}

	async function onConfirmPicture() {
		/*
			Upload the selected image and update the profile picture
		*/
		if (!authUser || !selectedPictureFile || !profile) return;

		try {
			setSavingPicture(true);
			setPictureError("");
			setActionMessage("");

			if (DEV_BYPASS_AUTH) {
				const updated = {
					...profile,
					profileImagePath: picturePreviewUrl,
				};
				setProfile(updated);
				setPictureEditOpen(false);
				setSelectedPictureFile(null);
				setActionMessage("profile picture updated");
				return;
			}

			const updatedProfile = await uploadProfileImage(authUser.userID, selectedPictureFile);
			setProfile(updatedProfile);
			setPictureVersion(Date.now());
			setPictureEditOpen(false);
			clearPictureSelection();
			setActionMessage("profile picture updated");
		} catch (e) {
			setPictureError(e instanceof Error ? e.message : "failed to upload profile picture");
		} finally {
			setSavingPicture(false);
		}
	}

	function onPetDraftChange(petID: number, field: string, value: string) {
		/*
			Update one pet draft field and clear that field's old error
		*/
		setPetDrafts((prev) => ({
			...prev,
			[petID]: {
				...prev[petID],
				[field]: value,
			},
		}));

		setPetErrors((prev) => ({
			...prev,
			[petID]: {
				...(prev[petID] || {}),
				[field]: "",
			},
		}));
	}

	function petDraftIsDirty(pet: Pet) {
		/*
			Check whether one pet card has unsaved changes
		*/
		const original = normalizePetForDraft(pet);
		const draft = petDrafts[pet.petID] || original;
		return !shallowEqual(original, draft);
	}

	function validatePetDraft(pet: Pet) {
		/*
			Validate one pet draft before saving it

			The same optional required logic is used here as the user info form
		*/
		const original = normalizePetForDraft(pet);
		const draft = petDrafts[pet.petID] || original;
		const nextErrors: PetErrors = {};

		function requireIfNeeded(field: keyof typeof draft, message = "required") {
			/*
				Only require the field if the saved pet already had it or the user started typing it
			*/
			if (!isBlank(draft[field]) || !isBlank(original[field])) {
				if (isBlank(draft[field])) {
					(nextErrors as any)[field] = message;
				}
			}
		}

		requireIfNeeded("petName");
		requireIfNeeded("petType");
		requireIfNeeded("breed");
		requireIfNeeded("petSex");
		requireIfNeeded("spayedNeutered");

		if (!isBlank(draft.age) || !isBlank(original.age)) {
			if (isBlank(draft.age)) nextErrors.age = "required";
			else {
				const n = Number(draft.age);
				if (!Number.isFinite(n) || n < 0) nextErrors.age = "invalid";
			}
		}

		requireIfNeeded("currentMedications");
		requireIfNeeded("knownAllergies");
		requireIfNeeded("pastInjuriesConditions");
		requireIfNeeded("vaccinationsUpToDate");
		requireIfNeeded("heartwormPreventionCurrent");

		setPetErrors((prev) => ({
			...prev,
			[pet.petID]: nextErrors,
		}));

		return Object.keys(nextErrors).length === 0;
	}

	async function onSavePet(pet: Pet) {
		/*
			Save one edited pet profile card
		*/
		if (!authUser) return;
		if (!petDraftIsDirty(pet)) return;

		const isValid = validatePetDraft(pet);
		if (!isValid) return;

		const draft = petDrafts[pet.petID];

		try {
			setSavingPetId(pet.petID);
			setActionMessage("");

			if (DEV_BYPASS_AUTH) {
				setPets((prev) =>
					prev.map((p) =>
						p.petID === pet.petID
							? {
								...p,
								...draft,
								age: draft.age === "" ? null : Number(draft.age),
							}
							: p
					)
				);
				setActionMessage("pet profile saved");
				return;
			}

			const updated = await updatePetProfile(authUser.userID, pet.petID, {
				...draft,
				age: draft.age === "" ? null : Number(draft.age),
			} as any);

			/*
				Update the saved pet list with the backend response
			*/
			setPets((prev) =>
				prev.map((p) => (p.petID === pet.petID ? ({ ...p, ...updated } as Pet) : p))
			);

			/*
				Reset this pet's draft to match the saved backend version
			*/
			setPetDrafts((prev) => ({
				...prev,
				[pet.petID]: normalizePetForDraft(updated as Pet),
			}));

			setActionMessage("pet profile saved");
		} catch (e) {
			setActionMessage(e instanceof Error ? e.message : "failed to save pet profile");
		} finally {
			setSavingPetId(null);
		}
	}

	async function beginReschedule(reservation: Reservation) {
		/*
			Load available slots for the selected reservation so the reschedule calendar can open
		*/
		if (!authUser) return;

		try {
			setActionMessage("");
			setRescheduleTarget(reservation);
			setRescheduleSlots([]);
			setRescheduleSlotsError("");
			setRescheduleSlotsLoading(true);
			setRescheduleSelectedSlotId("");
			setRescheduleDate("");
			setRescheduleStartTime("");

			if (DEV_BYPASS_AUTH) {
				const fakeSlots = [
					{
						slotId: `slot_${toDateOnly(tomorrow)}_0900_0920`,
						date: toDateOnly(tomorrow),
						startTime: "09:00",
						endTime: "09:20",
					},
					{
						slotId: `slot_${toDateOnly(tomorrow)}_0930_0950`,
						date: toDateOnly(tomorrow),
						startTime: "09:30",
						endTime: "09:50",
					},
				];
				setRescheduleSlots(fakeSlots);
				return;
			}

			/*
				Ask the availability route for slots for the same appointment reason and pet

				ignoreAppointmentID keeps the appointment from blocking its own reschedule slots
			*/
			const resp = await getAvailability({
				reasonKey: reservation.reasonKey as ReasonKey,
				userID: authUser.userID,
				petID: reservation.petID ?? null,
				ignoreAppointmentID: reservation.id,
				days: 90,
			});

			setRescheduleSlots(resp.slots || []);
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Failed to load reschedule slots";
			setRescheduleSlots([]);
			setRescheduleSlotsError(msg);
		} finally {
			setRescheduleSlotsLoading(false);
		}
	}

	function onRescheduleDateBrowse(nextDate: string) {
		/*
			If the user browses to another date, clear the old selected slot
		*/
		setRescheduleSelectedSlotId("");
		setRescheduleDate(nextDate);
		setRescheduleStartTime("");
	}

	function onRescheduleSlotSelect(value: { date: string; startTime: string; slotId?: string }) {
		/*
			Store the slot the user picked in the calendar
		*/
		setRescheduleSelectedSlotId(value.slotId || "");
		setRescheduleDate(value.date);
		setRescheduleStartTime(value.startTime);
	}

	function cancelReschedule() {
		/*
			Close the reschedule panel and clear its temporary state
		*/
		setRescheduleTarget(null);
		setRescheduleSlots([]);
		setRescheduleSlotsError("");
		setRescheduleSelectedSlotId("");
		setRescheduleDate("");
		setRescheduleStartTime("");
	}

	async function onCancelAppointment(reservation: Reservation) {
		/*
			Cancel one appointment, then refresh the profile data
		*/
		try {
			setActionMessage("");

			if (DEV_BYPASS_AUTH) {
				setReservations((prev) => prev.filter((r) => r.id !== reservation.id));
				setActionMessage("appointment canceled");
				if (rescheduleTarget?.id === reservation.id) {
					cancelReschedule();
				}
				return;
			}

			await cancelMyAppointment(reservation.id);
			await loadAllProfileData();

			if (rescheduleTarget?.id === reservation.id) {
				cancelReschedule();
			}

			setActionMessage("appointment canceled");
		} catch (e) {
			setActionMessage(e instanceof Error ? e.message : "failed to cancel appointment");
		}
	}

	async function confirmReschedule() {
		/*
			Confirm the reschedule using the selected new date and time
		*/
		if (!rescheduleTarget) return;
		if (!rescheduleDate || !rescheduleStartTime) {
			setActionMessage("choose a new date and time first");
			return;
		}

		try {
			setActionMessage("");
			setRescheduleBusy(true);

			if (DEV_BYPASS_AUTH) {
				setActionMessage("appointment rescheduled");
				cancelReschedule();
				return;
			}

			await rescheduleMyAppointment(rescheduleTarget.id, {
				appointmentDate: rescheduleDate,
				startTime: rescheduleStartTime,
			});

			await loadAllProfileData();
			cancelReschedule();
			setActionMessage("appointment rescheduled");
		} catch (e) {
			setActionMessage(e instanceof Error ? e.message : "failed to reschedule appointment");
		} finally {
			setRescheduleBusy(false);
		}
	}

	if (loading) return <div className="profilePage">Loading profile...</div>;

	if (error) {
		return <div className="profilePage errorBox">Error: {error}</div>;
	}

	if (!authUser || !profile) {
		return <div className="profilePage errorBox">No user loaded.</div>;
	}

	return (
		<div className="profilePage">
			<h1 className="profileTitle">My Profile</h1>

			{actionMessage ? <div className="profileActionMessage">{actionMessage}</div> : null}

			<div className="topRow">
				<section className="card">
					<h2>User Info</h2>

					<div className="profileStaticInfo">
						<p><b>User ID:</b> {profile.userID}</p>
						<p><b>Email:</b> {profile.email}</p>
						<p><b>User Type:</b> {profile.userType || "CUSTOMER"}</p>
					</div>

					<div className="infoGrid">
						<div className="fieldRow">
							<label>First Name</label>
							<input
								className="fieldInput"
								value={profileDraft.legalFirstName}
								onChange={(e) => onProfileDraftChange("legalFirstName", e.target.value)}
							/>
							{profileErrors.legalFirstName ? <p className="fieldError">{profileErrors.legalFirstName}</p> : null}
						</div>

						<div className="fieldRow">
							<label>Last Name</label>
							<input
								className="fieldInput"
								value={profileDraft.legalLastName}
								onChange={(e) => onProfileDraftChange("legalLastName", e.target.value)}
							/>
							{profileErrors.legalLastName ? <p className="fieldError">{profileErrors.legalLastName}</p> : null}
						</div>

						<div className="fieldRow">
							<label>Phone</label>
							<input
								className="fieldInput"
								value={profileDraft.phone}
								onChange={(e) => onProfileDraftChange("phone", e.target.value)}
							/>
							{profileErrors.phone ? <p className="fieldError">{profileErrors.phone}</p> : null}
						</div>

						<div className="fieldRow fieldRowWide">
							<label>Address</label>
							<input
								className="fieldInput"
								value={profileDraft.addressLine1}
								onChange={(e) => onProfileDraftChange("addressLine1", e.target.value)}
							/>
							{profileErrors.addressLine1 ? <p className="fieldError">{profileErrors.addressLine1}</p> : null}
						</div>

						<div className="fieldRow">
							<label>City</label>
							<input
								className="fieldInput"
								value={profileDraft.city}
								onChange={(e) => onProfileDraftChange("city", e.target.value)}
							/>
							{profileErrors.city ? <p className="fieldError">{profileErrors.city}</p> : null}
						</div>

						<div className="fieldRow">
							<label>State Code</label>
							<select
								className="fieldInput"
								value={profileDraft.state}
								onChange={(e) => onProfileDraftChange("state", e.target.value)}
							>
								<option value="">Select</option>
								{US_STATE_CODES.map((code) => (
									<option key={code} value={code}>{code}</option>
								))}
							</select>
							{profileErrors.state ? <p className="fieldError">{profileErrors.state}</p> : null}
						</div>

						<div className="fieldRow">
							<label>ZIP Code</label>
							<input
								className="fieldInput"
								value={profileDraft.zipCode}
								onChange={(e) => onProfileDraftChange("zipCode", e.target.value)}
							/>
							{profileErrors.zipCode ? <p className="fieldError">{profileErrors.zipCode}</p> : null}
						</div>
					</div>

					<div className="sectionActions">
						<button
							type="button"
							className="primaryBtn"
							onClick={onSaveUserInfo}
							disabled={savingProfileInfo || !userInfoDirty}
						>
							{savingProfileInfo ? "Saving..." : "Save User Info"}
						</button>
					</div>
				</section>

				<section className="card">
					<h2>Profile Picture</h2>

					<div className="profilePictureArea">
						<img className="profileImg" src={currentProfileImageSrc} alt="profile" />

						<input
							ref={fileInputRef}
							className="hiddenFileInput"
							type="file"
							accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
							onChange={onPictureFileChange}
						/>

						<div className="profilePictureActions">
							<button
								type="button"
								className="primaryBtn"
								onClick={onOpenPictureEdit}
								disabled={savingPicture}
							>
								Edit Picture
							</button>

							{pictureEditOpen ? (
								<button
									type="button"
									className="primaryBtn secondaryBtn"
									onClick={() => fileInputRef.current?.click()}
									disabled={savingPicture}
								>
									Choose Image
								</button>
							) : null}

							{pictureEditOpen && selectedPictureFile && picturePreviewUrl ? (
								<button
									type="button"
									className="primaryBtn successBtnAlt"
									onClick={onConfirmPicture}
									disabled={savingPicture}
								>
									{savingPicture ? "Saving..." : "Confirm Picture"}
								</button>
							) : null}
						</div>

						{pictureEditOpen ? (
							<p className="profilePictureHint">
								Choose a JPG, PNG, or WEBP image up to 2MB
							</p>
						) : null}

						{selectedPictureFile ? (
							<p className="profilePictureHint">
								Selected file: {selectedPictureFile.name}
							</p>
						) : null}

						{pictureError ? <p className="fieldError">{pictureError}</p> : null}

						{pictureEditOpen && selectedPictureFile ? (
							<button
								type="button"
								className="textBtn"
								onClick={clearPictureSelection}
								disabled={savingPicture}
							>
								Clear Selected Image
							</button>
						) : null}
					</div>
				</section>
			</div>

			<section className="card">
				<h2>Biography</h2>
				<textarea
					className="bioInput"
					value={bioDraft}
					onChange={(e) => setBioDraft(e.target.value)}
					rows={4}
					placeholder="Write a short bio..."
				/>
				<button className="primaryBtn" onClick={onSaveBio} disabled={savingBio}>
					{savingBio ? "Saving..." : "Save Bio"}
				</button>
			</section>

			<div className="reservationsRow">
				<ReservationBox
					title="Past Reservations"
					items={past}
					onCancel={onCancelAppointment}
					onReschedule={beginReschedule}
				/>
				<ReservationBox
					title="Today"
					items={today}
					onCancel={onCancelAppointment}
					onReschedule={beginReschedule}
				/>
				<ReservationBox
					title="Future Reservations"
					items={future}
					onCancel={onCancelAppointment}
					onReschedule={beginReschedule}
				/>
			</div>

			{rescheduleTarget ? (
				<section className="card rescheduleSection" ref={rescheduleSectionRef}>
					<h2>Choose a new date and time</h2>
					<p className="hint">
						Rescheduling appointment #{rescheduleTarget.id}. The rest of the appointment stays the same. Only the date and time will change.
					</p>

					<div className="rescheduleCalendarWrap">
						<SlotCalendar
							slots={rescheduleSlots}
							value={
								rescheduleDate && rescheduleStartTime
									? {
										date: rescheduleDate,
										startTime: rescheduleStartTime,
										slotId: rescheduleSelectedSlotId || undefined,
									}
									: null
							}
							onSelectSlot={onRescheduleSlotSelect}
							onBrowseDateChange={onRescheduleDateBrowse}
							isLoading={rescheduleSlotsLoading}
							errorText={rescheduleSlotsError}
						/>
					</div>

					<div className="rescheduleButtons">
						<button
							type="button"
							className="dangerBtn"
							onClick={cancelReschedule}
							disabled={rescheduleBusy}
						>
							Cancel Rescheduling
						</button>

						<button
							type="button"
							className="successBtn"
							onClick={confirmReschedule}
							disabled={rescheduleBusy || !rescheduleDate || !rescheduleStartTime}
						>
							{rescheduleBusy ? "Rescheduling..." : "Reschedule Appointment"}
						</button>
					</div>
				</section>
			) : null}

			<section className="card petSection">
				<h2>Pet Profiles</h2>

				<div className="petProfilesRow">
					{pets.length === 0 ? (
						<p className="hint">No Pets Registerd.</p>
					) : (
						pets.map((pet) => {
							const draft = petDrafts[pet.petID] || normalizePetForDraft(pet);
							const petFieldErrors = petErrors[pet.petID] || {};
							const isDirty = petDraftIsDirty(pet);

							return (
								<div key={pet.petID} className="petBox">
									<h3>{pet.petName}</h3>

									<div className="fieldRow">
										<label>Pet Name</label>
										<input
											className="fieldInput"
											value={draft.petName}
											onChange={(e) => onPetDraftChange(pet.petID, "petName", e.target.value)}
										/>
										{petFieldErrors.petName ? <p className="fieldError">{petFieldErrors.petName}</p> : null}
									</div>

									<div className="fieldRow">
										<label>Type</label>
										<select
											className="fieldInput"
											value={draft.petType}
											onChange={(e) => onPetDraftChange(pet.petID, "petType", e.target.value)}
										>
											<option value="">Select</option>
											<option value="DOG">DOG</option>
											<option value="CAT">CAT</option>
											<option value="OTHER">OTHER</option>
										</select>
										{petFieldErrors.petType ? <p className="fieldError">{petFieldErrors.petType}</p> : null}
									</div>

									<div className="fieldRow">
										<label>Breed</label>
										<input
											className="fieldInput"
											value={draft.breed}
											onChange={(e) => onPetDraftChange(pet.petID, "breed", e.target.value)}
										/>
										{petFieldErrors.breed ? <p className="fieldError">{petFieldErrors.breed}</p> : null}
									</div>

									<div className="fieldRow">
										<label>Sex</label>
										<select
											className="fieldInput"
											value={draft.petSex}
											onChange={(e) => onPetDraftChange(pet.petID, "petSex", e.target.value)}
										>
											<option value="">Select</option>
											<option value="MALE">MALE</option>
											<option value="FEMALE">FEMALE</option>
											<option value="UNKNOWN">UNKNOWN</option>
										</select>
										{petFieldErrors.petSex ? <p className="fieldError">{petFieldErrors.petSex}</p> : null}
									</div>

									<div className="fieldRow">
										<label>Spayed / Neutered</label>
										<select
											className="fieldInput"
											value={draft.spayedNeutered}
											onChange={(e) => onPetDraftChange(pet.petID, "spayedNeutered", e.target.value)}
										>
											<option value="">Select</option>
											<option value="YES">YES</option>
											<option value="NO">NO</option>
											<option value="UNKNOWN">UNKNOWN</option>
										</select>
										{petFieldErrors.spayedNeutered ? <p className="fieldError">{petFieldErrors.spayedNeutered}</p> : null}
									</div>

									<div className="fieldRow">
										<label>Age</label>
										<input
											className="fieldInput"
											value={draft.age}
											onChange={(e) => onPetDraftChange(pet.petID, "age", e.target.value)}
										/>
										{petFieldErrors.age ? <p className="fieldError">{petFieldErrors.age}</p> : null}
									</div>

									<hr />

									<div className="fieldRow">
										<label>Medications</label>
										<textarea
											className="fieldInput fieldTextarea"
											value={draft.currentMedications}
											onChange={(e) => onPetDraftChange(pet.petID, "currentMedications", e.target.value)}
										/>
										{petFieldErrors.currentMedications ? <p className="fieldError">{petFieldErrors.currentMedications}</p> : null}
									</div>

									<div className="fieldRow">
										<label>Allergies</label>
										<textarea
											className="fieldInput fieldTextarea"
											value={draft.knownAllergies}
											onChange={(e) => onPetDraftChange(pet.petID, "knownAllergies", e.target.value)}
										/>
										{petFieldErrors.knownAllergies ? <p className="fieldError">{petFieldErrors.knownAllergies}</p> : null}
									</div>

									<div className="fieldRow">
										<label>Past Conditions</label>
										<textarea
											className="fieldInput fieldTextarea"
											value={draft.pastInjuriesConditions}
											onChange={(e) => onPetDraftChange(pet.petID, "pastInjuriesConditions", e.target.value)}
										/>
										{petFieldErrors.pastInjuriesConditions ? <p className="fieldError">{petFieldErrors.pastInjuriesConditions}</p> : null}
									</div>

									<div className="fieldRow">
										<label>Vaccinations</label>
										<select
											className="fieldInput"
											value={draft.vaccinationsUpToDate}
											onChange={(e) => onPetDraftChange(pet.petID, "vaccinationsUpToDate", e.target.value)}
										>
											<option value="">Select</option>
											<option value="Yes">Yes</option>
											<option value="No">No</option>
											<option value="Unsure">Unsure</option>
										</select>
										{petFieldErrors.vaccinationsUpToDate ? <p className="fieldError">{petFieldErrors.vaccinationsUpToDate}</p> : null}
									</div>

									<div className="fieldRow">
										<label>Heartworm Prevention</label>
										<select
											className="fieldInput"
											value={draft.heartwormPreventionCurrent}
											onChange={(e) => onPetDraftChange(pet.petID, "heartwormPreventionCurrent", e.target.value)}
										>
											<option value="">Select</option>
											<option value="Yes">Yes</option>
											<option value="No">No</option>
											<option value="Unsure">Unsure</option>
											<option value="NotApplicable">NotApplicable</option>
										</select>
										{petFieldErrors.heartwormPreventionCurrent ? <p className="fieldError">{petFieldErrors.heartwormPreventionCurrent}</p> : null}
									</div>

									<div className="sectionActions">
										<button
											type="button"
											className="primaryBtn"
											onClick={() => onSavePet(pet)}
											disabled={savingPetId === pet.petID || !isDirty}
										>
											{savingPetId === pet.petID ? "Saving..." : "Save Pet Profile"}
										</button>
									</div>
								</div>
							);
						})
					)}
				</div>
			</section>
		</div>
	);
}

function ReservationBox({
	title,
	items,
	onCancel,
	onReschedule,
}: {
	title: string;
	items: Reservation[];
	onCancel: (reservation: Reservation) => void;
	onReschedule: (reservation: Reservation) => void;
}) {
	/*
		Reusable appointment card section used for the past, today, and future columns
	*/
	const nowMs = Date.now();

	return (
		<section className="card">
			<h2>{title}</h2>
			{items.length === 0 ? (
				<p className="hint">No reservations.</p>
			) : (
				<div className="userAppointmentList">
					{items.map((reservation) => {
						/*
							Compare the appointment start and end times to the current time

							This decides whether the card is ongoing, ended, or still upcoming
						*/
						const startMs = new Date(reservation.startTime).getTime();
						const endMs = reservation.endTime ? new Date(reservation.endTime).getTime() : startMs;
						const isOngoing = nowMs >= startMs && nowMs < endMs;
						const canShowRating = nowMs >= endMs;
						const canCancelOrReschedule = nowMs < startMs;

						return (
							<div key={reservation.id} className={`userAppointmentCard${isOngoing ? " userAppointmentCardOngoing" : ""}`}>
								<div className="userAppointmentCardHeader">
									<div>
										<h3>{formatReasonLabel(reservation.reasonKey)}</h3>
										<p className="userAppointmentMetaLine">For: {reservation.petName || "Unknown Pet"}</p>
									</div>
									<div className="userAppointmentStatusWrap">
										{isOngoing ? <span className="userAppointmentBadge userAppointmentBadgeOngoing">ONGOING</span> : null}
									</div>
								</div>

								<div className="userAppointmentMetaGrid">
									<div className="userAppointmentMetaItem">
										<span className="userAppointmentMetaLabel">Date</span>
										<span className="userAppointmentMetaValue">{formatCardDate(reservation.startTime)}</span>
									</div>
									<div className="userAppointmentMetaItem">
										<span className="userAppointmentMetaLabel">Start Time</span>
										<span className="userAppointmentMetaValue">{formatCardTime(reservation.startTime)}</span>
									</div>
									<div className="userAppointmentMetaItem">
										<span className="userAppointmentMetaLabel">End Time</span>
										<span className="userAppointmentMetaValue">{reservation.endTime ? formatCardTime(reservation.endTime) : "N/A"}</span>
									</div>
									<div className="userAppointmentMetaItem">
										<span className="userAppointmentMetaLabel">Room</span>
										<span className="userAppointmentMetaValue">{reservation.roomNumber ? `Room ${reservation.roomNumber}` : "N/A"}</span>
									</div>
								</div>

								<div className="userAppointmentActionRow">
									{reservation.summaryIsFinalized ? (
										<Link className="miniPrimaryBtn userAppointmentLinkBtn" to={`/user/appointments/${reservation.id}/summary`}>View Summary</Link>
									) : null}

									{canCancelOrReschedule ? (
										<>
											<button type="button" className="miniDangerBtn" onClick={() => onCancel(reservation)}>Cancel</button>
											<button type="button" className="miniPrimaryBtn" onClick={() => onReschedule(reservation)}>Reschedule</button>
										</>
									) : null}
								</div>

								{isOngoing ? (
									<p className="userAppointmentHint">This appointment is still ongoing, so rating is not available yet</p>
								) : null}

								{canShowRating ? <div className="userAppointmentRatingSpacer" /> : null}
							</div>
						);
					})}
				</div>
			)}
		</section>
	);
}