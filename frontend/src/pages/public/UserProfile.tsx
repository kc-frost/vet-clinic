import { useEffect, useMemo, useState } from "react";
import "../../styles/userProfile.css";

import { getCurrentUser, type AuthUser } from "../../api/auth";
import { api } from "../../api/client";
import { getPetsForUser } from "../../api/reservations";
import type { PetProfile } from "../../types/reservation";

// dev bypass toggle
// true = UI can be worked on without backend/session running
// false = real mode, reads /api/auth/me + /api/profile + /api/appointments
const DEV_BYPASS_AUTH = false;

// Basic profile data returned from the profile endpoint
type UserProfileData = {
  userID: number;
  email: string;
  userBio: string;
};
//Appointment row shape returned from the backend 
type AppointmentRow = {
  appointmentID: number;
  userID: number;
  staffID: number;
  roomNumber: number;
  reasonKey: string;
  date: string; // mysql datetime string
  durationMinutes: number;
};
// Simplified reservation shape used only by the UI
type Reservation = {
  id: number;
  startTime: string;
  endTime?: string | null;
  itemName?: string | null;
};
// Pet profile shape used on the page
type Pet = PetProfile & {
    userID?: number;
  };

// Development sample data
// This lets the UI be tested without needing auth/session/backend running
const DEV_USER: AuthUser = {
    userID: 1,
    email: "dev.user@email.com",
    isAdmin: false,
  };
  
  const DEV_PROFILE: UserProfileData = {
    userID: 1,
    email: "dev.user@email.com",
    userBio: "This is a local test bio for Sprint 3.",
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


/**
 * Converts a JS Date into a MySQL-style datetime string.
 * Example: 2026-03-06 14:30:00
 */
function toMysqlDateTime(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const DEV_APPOINTMENTS: AppointmentRow[] = [
  {
    appointmentID: 101,
    userID: 1,
    staffID: 1,
    roomNumber: 2,
    reasonKey: "WELLNESS_EXAM",
    date: toMysqlDateTime(yesterday),
    durationMinutes: 30,
  },
  {
    appointmentID: 102,
    userID: 1,
    staffID: 2,
    roomNumber: 4,
    reasonKey: "VACCINATION",
    date: toMysqlDateTime(todayAppt),
    durationMinutes: 45,
  },
  {
    appointmentID: 103,
    userID: 1,
    staffID: 3,
    roomNumber: 1,
    reasonKey: "FOLLOW_UP",
    date: toMysqlDateTime(tomorrow),
    durationMinutes: 20,
  },
];

const DEV_PETS: Pet[] = [
    {
      petID: 1,
      userID: 1,
      petName: "Buddy",
      petType: "Dog",
      breed: "Golden Retriever",
      petSex: "Male",
      spayedNeutered: "Yes",
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
      petType: "Cat",
      breed: "Tabby",
      petSex: "Female",
      spayedNeutered: "Yes",
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


  // DATE HELPERS:
//Returns the very beginning of the given day (00:00:00.000)   
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
// Returns the very end of the given day (23:59:59.999)
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/**
 * Converts a MySQL datetime string into ISO format so JS Date can
 * parse it more reliably.
 *
 * Example:
 * "2026-03-06 14:00:00" -> "2026-03-06T14:00:00.000Z" (depending on timezone parsing)
 */
function mysqlDateTimeToIso(mysqlDt: string) {
  // mysql tends to send "YYYY-MM-DD HH:mm:ss", so convert it to something Date() reliably parses
  const s = String(mysqlDt || "");
  if (!s) return new Date(NaN).toISOString();
  if (/^\d{4}-\d{2}-\d{2} /.test(s)) return new Date(s.replace(" ", "T")).toISOString();
  return new Date(s).toISOString();
}
//Adds a number of minutes to an ISO date string
function addMinutes(iso: string, mins: number) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  d.setMinutes(d.getMinutes() + mins);
  return d.toISOString();
}
//  API helpers
// Small wrapper functions used by this page to read/update data.

// Fetches the current user's profile record 
async function fetchProfile(userID: number) {
  return api<UserProfileData>(`/profile?userID=${userID}`, { method: "GET" });
}
// Updates the current user's biography
async function updateProfileBio(userID: number, userBio: string) {
  return api<UserProfileData>(`/profile?userID=${userID}`, {
    method: "PUT",
    body: { userBio },
  });
}

// Fetches all appointments from the backend
async function fetchAppointments() {
  return api<AppointmentRow[]>("/appointments", { method: "GET" });
}
/**
 * Converts raw appointment rows into the simpler reservation format
 * used by this page's reservation boxes.
 */
function mapAppointmentsToReservations(rows: AppointmentRow[]) {
  return rows.map((a) => {
    const startIso = mysqlDateTimeToIso(a.date);
    const endIso = addMinutes(startIso, Number(a.durationMinutes || 0));
    const itemName = `${a.reasonKey || "APPOINTMENT"} (Room ${a.roomNumber})`;

    return {
      id: Number(a.appointmentID),
      startTime: startIso,
      endTime: endIso,
      itemName,
    };
  });
}

/*

 UserProfile page
-------------------------
 Shows:
 - user identification
 - profile picture placeholder
 - editable biography
 - reservation history split into past/today/future
 - saved pet profiles

*/
export default function UserProfile() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);

  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [bioDraft, setBioDraft] = useState("");

  const [pets, setPets] = useState<Pet[]>([]);

  const [loading, setLoading] = useState(true);
  const [savingBio, setSavingBio] = useState(false);
  const [error, setError] = useState<string | null>(null);

    /*
   Initial page load
  -------------------------------
   In dev mode, use sample data.
   In real mode:
   1. fetch current logged-in user
   2. fetch profile
   3. fetch appointments and keep only this user's appointments
   4. fetch pet profiles
  */
  useEffect(() => {
    (async () => {
      try {
        setError(null);

        if (DEV_BYPASS_AUTH) {
            setAuthUser(DEV_USER);
            setProfile(DEV_PROFILE);
            setBioDraft(DEV_PROFILE.userBio || "");
            setReservations(mapAppointmentsToReservations(DEV_APPOINTMENTS));
            setPets(DEV_PETS);
            return;
          }

        // real mode
        const me = await getCurrentUser();
        setAuthUser(me);

        const p = await fetchProfile(me.userID);
        setProfile(p);
        setBioDraft(p.userBio || "");

        const appts = await fetchAppointments();
        const mine = appts.filter((a) => Number(a.userID) === Number(me.userID));
        setReservations(mapAppointmentsToReservations(mine));

        const savedPets = await getPetsForUser(me.userID);
        setPets(savedPets);

      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        setError(msg);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Split reservations into past / today / future
  // This is memoized so it only recalculates when reservations change.

  const { past, today, future } = useMemo(() => {
    // split reservations by whether they happened before today, during today, or after today
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

    // sort each list so the UI reads nicely
    past.sort((a, b) => +new Date(b.startTime) - +new Date(a.startTime));
    today.sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime));
    future.sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime));

    return { past, today, future };
  }, [reservations]);


  // Save biography
  // In dev mode, update local state only
  // In real mode, send a PUT request to the backend
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

      const updated = await updateProfileBio(authUser.userID, bioDraft);
      setProfile(updated);
      setBioDraft(updated.userBio || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save bio");
    } finally {
      setSavingBio(false);
    }
  }

  if (loading) return <div className="profilePage">Loading profile...</div>;

  if (error) {
    return <div className="profilePage errorBox">Error: {error}</div>;
  }

  if (!authUser || !profile) {
    return <div className="profilePage errorBox">No user loaded.</div>;
  }
  // Main UI
  return (
    <div className="profilePage">
      <h1 className="profileTitle">My Profile</h1>

      <div className="topRow">
        <section className="card">
          <h2>User Identification</h2>
          <p><b>User ID:</b> {profile.userID}</p>
          <p><b>Email:</b> {profile.email}</p>
        </section>

        <section className="card">
          <h2>Profile Picture</h2>
          <img className="profileImg" src={"https://via.placeholder.com/220"} alt="profile" />
          <div className="hint">(Static for now)</div>
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
        <ReservationBox title="Past Reservations" items={past} />
        <ReservationBox title="Today" items={today} />
        <ReservationBox title="Future Reservations" items={future} />
      </div>

      <section className="card petSection">
        <h2>Pet Profiles</h2>

        <div className="petProfilesRow">
            {pets.length === 0 ? (
                <p className="hint">No Pets Registerd.</p>
            ): (
                pets.map((pet) => (
                    <div key={pet.petID} className="petBox">
                        <h3>{pet.petName}</h3>

                        <p><b>Type:</b> {pet.petType ?? "N/A"}</p>
                        <p><b>Breed:</b> {pet.breed ?? "N/A"}</p>
                        <p><b>Sex:</b> {pet.petSex ?? "N/A"}</p>
                        <p><b>Age:</b> {pet.age ?? "N/A"}</p>


                        <hr />

                        <p><b>Medications:</b> {pet.currentMedications ?? "None listed"}</p>
                        <p><b>Allergies:</b> {pet.knownAllergies ?? "None listed"}</p>
                        <p><b>Past Conditions:</b> {pet.pastInjuriesConditions ?? "None listed"}</p>
                        <p><b>Vaccinations:</b> {pet.vaccinationsUpToDate ?? "Unknown"}</p>
                        <p><b>Heartworm Prevention:</b> {pet.heartwormPreventionCurrent ?? "Unknown"}</p>



                    </div>
                ))
            )}

        </div>
      </section>

    </div>
  );
}

/*
 ReservationBox
--------------------
 Small reusable component that renders one reservation group:
 - Past Reservations
 - Today
 - Future Reservations

*/

function ReservationBox({ title, items }: { title: string; items: Reservation[] }) {
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
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}