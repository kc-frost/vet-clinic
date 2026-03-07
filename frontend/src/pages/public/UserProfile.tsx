import { useEffect, useMemo, useRef, useState } from "react";
import "../../styles/userProfile.css";

import { getCurrentUser, type AuthUser } from "../../api/auth";
import { api } from "../../api/client";
import { getAvailability, getPetsForUser, updatePetProfile } from "../../api/reservations";
import { getMyAppointments, cancelMyAppointment, rescheduleMyAppointment } from "../../api/appointments";
import SlotCalendar from "../../components/calendar/SlotCalendar";

import type { PetProfile, ReasonKey } from "../../types/reservation";
import type { Appointment } from "../../types/appointment";

// dev bypass toggle
// true means ui can be worked on without backend or session
// false means real mode using live api routes
const DEV_BYPASS_AUTH = false;

const US_STATE_CODES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

// profile shape returned from the profile endpoint
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
  isAdmin: boolean;
};

// only the editable user fields that live in the info card
type UserInfoDraft = {
  legalFirstName: string;
  legalLastName: string;
  phone: string;
  addressLine1: string;
  city: string;
  state: string;
  zipCode: string;
};

// user info validation errors
type UserInfoErrors = Partial<Record<keyof UserInfoDraft, string>>;

// simplified reservation shape used by this page
// now includes raw fields we need for cancel and reschedule
type Reservation = {
  id: number;
  startTime: string;
  endTime?: string | null;
  itemName?: string | null;
  reasonKey: string;
  appointmentDateRaw: string;
  startTimeRaw: string;
  canModify: boolean;
};

// pet profile shape used on the page
type Pet = PetProfile & {
  userID?: number;
};

// per-pet validation errors for editable mini pet cards
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

// development sample user
const DEV_USER: AuthUser = {
  userID: 1,
  email: "dev.user@email.com",
  isAdmin: false,
};

// development sample profile
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
  isAdmin: false,
};

const now = new Date();

const yesterday = new Date(now);
yesterday.setDate(now.getDate() - 1);
yesterday.setHours(10, 0, 0, 0);

const todayAppt = new Date(now);
todayAppt.setHours(14, 0, 0, 0);

const tomorrow = new Date(now);
tomorrow.setDate(now.getDate() + 1);
tomorrow.setHours(9, 30, 0, 0);

// converts a js date into mysql style datetime text
function toMysqlDateTime(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// turns a Date into yyyy-mm-dd
function toDateOnly(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isBlank(v: string) {
  return !v || v.trim() === "";
}

function isPhone(v: string) {
  return /^\+?\d[\d\s().-]{7,}$/.test(v.trim());
}

function isZip(v: string) {
  return /^\d{5}(-\d{4})?$/.test(v.trim());
}

function is2LetterState(v: string) {
  return /^[A-Za-z]{2}$/.test(v.trim());
}

function normalizeUserInfo(profile: UserProfileData): UserInfoDraft {
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
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;

  for (const k of keys) {
    if ((a as any)[k] !== (b as any)[k]) return false;
  }

  return true;
}

// development sample appointments
const DEV_APPOINTMENTS: Appointment[] = [
  {
    appointmentID: 101,
    userID: 1,
    staffID: 1,
    roomNumber: 2,
    petID: 1,
    reasonKey: "WELLNESS_EXAM",
    date: toMysqlDateTime(yesterday),
    durationMinutes: 30,
  },
  {
    appointmentID: 102,
    userID: 1,
    staffID: 2,
    roomNumber: 4,
    petID: 1,
    reasonKey: "VACCINATION",
    date: toMysqlDateTime(todayAppt),
    durationMinutes: 45,
  },
  {
    appointmentID: 103,
    userID: 1,
    staffID: 3,
    roomNumber: 1,
    petID: 2,
    reasonKey: "FOLLOW_UP",
    date: toMysqlDateTime(tomorrow),
    durationMinutes: 20,
  },
];

// development sample pets
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

// returns the start of the given day
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// returns the end of the given day
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

// converts mysql datetime text into something js Date parses more reliably
function mysqlDateTimeToIso(mysqlDt: string) {
  const s = String(mysqlDt || "");
  if (!s) return new Date(NaN).toISOString();
  if (/^\d{4}-\d{2}-\d{2} /.test(s)) return new Date(s.replace(" ", "T")).toISOString();
  return new Date(s).toISOString();
}

// adds minutes to an iso date string
function addMinutes(iso: string, mins: number) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  d.setMinutes(d.getMinutes() + mins);
  return d.toISOString();
}

// turns mysql datetime into date only text
function mysqlDateOnly(mysqlDt: string) {
  const s = String(mysqlDt || "");
  const datePart = s.split(" ")[0] || "";
  return datePart;
}

// turns mysql datetime into hh:mm text
function mysqlTimeOnly(mysqlDt: string) {
  const s = String(mysqlDt || "");
  const timePart = s.split(" ")[1] || "";
  return timePart.slice(0, 5);
}

// fetches the current user's profile record
async function fetchProfile(userID: number) {
  return api<UserProfileData>(`/profile?userID=${userID}`, { method: "GET" });
}

// updates the biography or editable user fields
async function updateProfile(userID: number, payload: Partial<UserProfileData>) {
  return api<UserProfileData>(`/profile?userID=${userID}`, {
    method: "PUT",
    body: payload,
  });
}

// converts raw appointment rows into the smaller reservation shape
function mapAppointmentsToReservations(rows: Appointment[]) {
  const nowMs = Date.now();

  return rows.map((a) => {
    const startIso = mysqlDateTimeToIso(a.date);
    const endIso = addMinutes(startIso, Number(a.durationMinutes || 0));
    const itemName = `${a.reasonKey || "APPOINTMENT"} (Room ${a.roomNumber})`;
    const startMs = new Date(startIso).getTime();

    return {
      id: Number(a.appointmentID),
      startTime: startIso,
      endTime: endIso,
      itemName,
      reasonKey: a.reasonKey,
      appointmentDateRaw: mysqlDateOnly(a.date),
      startTimeRaw: mysqlTimeOnly(a.date),
      canModify: startMs >= nowMs,
    };
  });
}

// user profile page
// shows user info editable bio appointment history pet profiles
// and lets the user cancel or reschedule upcoming appointments
export default function UserProfile() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);

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

  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [bioDraft, setBioDraft] = useState("");

  const [pets, setPets] = useState<Pet[]>([]);
  const [petDrafts, setPetDrafts] = useState<Record<number, ReturnType<typeof normalizePetForDraft>>>({});
  const [petErrors, setPetErrors] = useState<Record<number, PetErrors>>({});
  const [savingPetId, setSavingPetId] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [savingBio, setSavingBio] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // active reschedule state
  // when a reservation is chosen for reschedule, the calendar panel appears at the bottom
  const [rescheduleTarget, setRescheduleTarget] = useState<Reservation | null>(null);
  const [rescheduleSlots, setRescheduleSlots] = useState<any[]>([]);
  const [rescheduleSlotsLoading, setRescheduleSlotsLoading] = useState(false);
  const [rescheduleSlotsError, setRescheduleSlotsError] = useState("");
  const [rescheduleSelectedSlotId, setRescheduleSelectedSlotId] = useState("");
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleStartTime, setRescheduleStartTime] = useState("");
  const [rescheduleBusy, setRescheduleBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string>("");

  const rescheduleSectionRef = useRef<HTMLDivElement | null>(null);

  async function loadAllProfileData() {
    if (DEV_BYPASS_AUTH) {
      setAuthUser(DEV_USER);
      setProfile(DEV_PROFILE);
      setProfileDraft(normalizeUserInfo(DEV_PROFILE));
      setBioDraft(DEV_PROFILE.userBio || "");
      setReservations(mapAppointmentsToReservations(DEV_APPOINTMENTS));
      setPets(DEV_PETS);

      const nextPetDrafts: Record<number, ReturnType<typeof normalizePetForDraft>> = {};
      for (const pet of DEV_PETS) {
        nextPetDrafts[pet.petID] = normalizePetForDraft(pet);
      }
      setPetDrafts(nextPetDrafts);
      return;
    }

    const me = await getCurrentUser();
    setAuthUser(me);

    const p = await fetchProfile(me.userID);
    setProfile(p);
    setProfileDraft(normalizeUserInfo(p));
    setBioDraft(p.userBio || "");

    const appts = await getMyAppointments();
    setReservations(mapAppointmentsToReservations(appts));

    const savedPets = await getPetsForUser(me.userID);
    setPets(savedPets);

    const nextPetDrafts: Record<number, ReturnType<typeof normalizePetForDraft>> = {};
    for (const pet of savedPets) {
      nextPetDrafts[pet.petID] = normalizePetForDraft(pet as Pet);
    }
    setPetDrafts(nextPetDrafts);
  }

  // initial page load
  // dev mode uses local data
  // real mode loads auth user profile that user's appointments and pets
  useEffect(() => {
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

  // when rescheduleTarget becomes active, scroll the new calendar panel into view
  useEffect(() => {
    if (!rescheduleTarget) return;

    const id = window.setTimeout(() => {
      rescheduleSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 80);

    return () => window.clearTimeout(id);
  }, [rescheduleTarget?.id]);

  // split reservations into past today and future buckets
  const { past, today, future } = useMemo(() => {
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

    past.sort((a, b) => +new Date(b.startTime) - +new Date(a.startTime));
    today.sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime));
    future.sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime));

    return { past, today, future };
  }, [reservations]);

  // determines whether the editable user info card has pending changes
  const userInfoDirty = useMemo(() => {
    if (!profile) return false;
    return !shallowEqual(profileDraft, normalizeUserInfo(profile));
  }, [profile, profileDraft]);

  // saves the biography text
  async function onSaveBio() {
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
    setProfileDraft((prev) => ({ ...prev, [field]: value }));
    setProfileErrors((prev) => ({ ...prev, [field]: "" }));
  }

  function validateUserInfoDraft() {
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

  function onPetDraftChange(petID: number, field: string, value: string) {
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
    const original = normalizePetForDraft(pet);
    const draft = petDrafts[pet.petID] || original;
    return !shallowEqual(original, draft);
  }

  function validatePetDraft(pet: Pet) {
    const original = normalizePetForDraft(pet);
    const draft = petDrafts[pet.petID] || original;
    const nextErrors: PetErrors = {};

    function requireIfNeeded(field: keyof typeof draft, message = "required") {
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

      setPets((prev) =>
        prev.map((p) => (p.petID === pet.petID ? ({ ...p, ...updated } as Pet) : p))
      );

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

  // loads available slots for the selected appointment reason
  // this is used only for reschedule mode
  async function beginReschedule(reservation: Reservation) {
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

      const resp = await getAvailability({
        reasonKey: reservation.reasonKey as ReasonKey,
        userID: authUser.userID,
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

  // if user clicks a new date while rescheduling, old selected time is no longer valid
  function onRescheduleDateBrowse(nextDate: string) {
    setRescheduleSelectedSlotId("");
    setRescheduleDate(nextDate);
    setRescheduleStartTime("");
  }

  // store the newly chosen date/time for the reschedule flow
  function onRescheduleSlotSelect(value: { date: string; startTime: string; slotId?: string }) {
    setRescheduleSelectedSlotId(value.slotId || "");
    setRescheduleDate(value.date);
    setRescheduleStartTime(value.startTime);
  }

  // close the reschedule panel and forget any in-progress selection
  function cancelReschedule() {
    setRescheduleTarget(null);
    setRescheduleSlots([]);
    setRescheduleSlotsError("");
    setRescheduleSelectedSlotId("");
    setRescheduleDate("");
    setRescheduleStartTime("");
  }

  // cancel one upcoming appointment and refresh the page data
  async function onCancelAppointment(reservation: Reservation) {
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

  // confirms the reschedule
  // backend handles this as delete old appointment plus create new one
  async function confirmReschedule() {
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
            <p><b>Is Admin:</b> {profile.isAdmin ? "Yes" : "No"}</p>
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
          <img className="profileImg" src="/default-profile.svg" alt="default profile" />
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

// small reusable reservation box used by the profile page
// today and future reservations show cancel and reschedule actions when allowed
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
  return (
    <section className="card">
      <h2>{title}</h2>
      {items.length === 0 ? (
        <p className="hint">No reservations.</p>
      ) : (
        <ul className="resList">
          {items.map((r) => (
            <li key={r.id} className="resItem">
              <div className="resName"><b>{r.itemName ?? "Reservation"}</b></div>
              <div className="resTime">{new Date(r.startTime).toLocaleString()}</div>

              {r.canModify ? (
                <div className="reservationActionRow">
                  <button
                    type="button"
                    className="miniDangerBtn"
                    onClick={() => onCancel(r)}
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    className="miniPrimaryBtn"
                    onClick={() => onReschedule(r)}
                  >
                    Reschedule
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}