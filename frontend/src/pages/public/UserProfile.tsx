import { useEffect, useMemo, useState } from "react";
import "../../styles/userProfile.css";

import { getCurrentUser, type AuthUser } from "../../api/auth";
import { api } from "../../api/client";
import { getPetsForUser } from "../../api/reservations";
import { getMyAppointments } from "../../api/appointments";
import type { PetProfile } from "../../types/reservation";
import type { Appointment } from "../../types/appointment";

// dev bypass toggle
// true means ui can be worked on without backend or session
// false means real mode using live api routes
const DEV_BYPASS_AUTH = false;

// profile shape returned from the profile endpoint
type UserProfileData = {
  userID: number;
  email: string;
  userBio: string;
};

// simplified reservation shape used just by this page ui
type Reservation = {
  id: number;
  startTime: string;
  endTime?: string | null;
  itemName?: string | null;
};

// pet profile shape used on the page
type Pet = PetProfile & {
  userID?: number;
};

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

// fetches the current user's profile record
async function fetchProfile(userID: number) {
  return api<UserProfileData>(`/profile?userID=${userID}`, { method: "GET" });
}

// updates the current user's biography
async function updateProfileBio(userID: number, userBio: string) {
  return api<UserProfileData>(`/profile?userID=${userID}`, {
    method: "PUT",
    body: { userBio },
  });
}

// converts raw appointment rows into the smaller reservation shape
function mapAppointmentsToReservations(rows: Appointment[]) {
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

// user profile page
// shows user info editable bio appointment history and pet profiles
export default function UserProfile() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);

  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [bioDraft, setBioDraft] = useState("");

  const [pets, setPets] = useState<Pet[]>([]);

  const [loading, setLoading] = useState(true);
  const [savingBio, setSavingBio] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // initial page load
  // dev mode uses local data
  // real mode loads auth user profile that user's appointments and pets
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

        const me = await getCurrentUser();
        setAuthUser(me);

        const p = await fetchProfile(me.userID);
        setProfile(p);
        setBioDraft(p.userBio || "");

        // this now calls the user owned appointments route
        // so it no longer depends on the admin all appointments endpoint
        const appts = await getMyAppointments();
        setReservations(mapAppointmentsToReservations(appts));

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

    // sort so boxes read nicely
    past.sort((a, b) => +new Date(b.startTime) - +new Date(a.startTime));
    today.sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime));
    future.sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime));

    return { past, today, future };
  }, [reservations]);

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
          ) : (
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

// small reusable reservation box used by the profile page
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