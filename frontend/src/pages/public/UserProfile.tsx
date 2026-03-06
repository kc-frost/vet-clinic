import { useEffect, useMemo, useState } from "react";
import "../../styles/userProfile.css";

import { getCurrentUser, type AuthUser } from "../../api/auth";
import { api } from "../../api/client";

// dev bypass toggle
// true = UI can be worked on without backend/session running
// false = real mode, reads /api/auth/me + /api/profile + /api/appointments
const DEV_BYPASS_AUTH = true;

// dev bypass data
const DEV_USER: AuthUser = {
  userID: 1,
  email: "dev.user@email.com",
  isAdmin: false,
};

const DEV_PROFILE = {
  userID: 1,
  email: "dev.user@email.com",
  userBio: "dev bio placeholder",
};

const DEV_APPOINTMENTS = [
  {
    appointmentID: 101,
    userID: 1,
    staffID: 1,
    roomNumber: 101,
    reasonKey: "WELLNESS_EXAM",
    date: "2026-03-03 10:00:00",
    durationMinutes: 45,
  },
  {
    appointmentID: 102,
    userID: 1,
    staffID: 2,
    roomNumber: 201,
    reasonKey: "GROOMING",
    date: "2026-03-05 13:00:00",
    durationMinutes: 60,
  },
  {
    appointmentID: 103,
    userID: 1,
    staffID: 1,
    roomNumber: 301,
    reasonKey: "ULTRASOUND",
    date: "2026-03-08 09:15:00",
    durationMinutes: 45,
  },
];

type UserProfileData = {
  userID: number;
  email: string;
  userBio: string;
};

type AppointmentRow = {
  appointmentID: number;
  userID: number;
  staffID: number;
  roomNumber: number;
  reasonKey: string;
  date: string; // mysql datetime string
  durationMinutes: number;
};

type Reservation = {
  id: number;
  startTime: string;
  endTime?: string | null;
  itemName?: string | null;
};

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function mysqlDateTimeToIso(mysqlDt: string) {
  // mysql tends to send "YYYY-MM-DD HH:mm:ss", so convert it to something Date() reliably parses
  const s = String(mysqlDt || "");
  if (!s) return new Date(NaN).toISOString();
  if (/^\d{4}-\d{2}-\d{2} /.test(s)) return new Date(s.replace(" ", "T")).toISOString();
  return new Date(s).toISOString();
}

function addMinutes(iso: string, mins: number) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  d.setMinutes(d.getMinutes() + mins);
  return d.toISOString();
}

async function fetchProfile(userID: number) {
  return api<UserProfileData>(`/profile?userID=${userID}`, { method: "GET" });
}

async function updateProfileBio(userID: number, userBio: string) {
  return api<UserProfileData>(`/profile?userID=${userID}`, {
    method: "PUT",
    body: { userBio },
  });
}

async function fetchAppointments() {
  return api<AppointmentRow[]>("/appointments", { method: "GET" });
}

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

export default function UserProfile() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);

  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [bioDraft, setBioDraft] = useState("");

  const [loading, setLoading] = useState(true);
  const [savingBio, setSavingBio] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setError(null);

        // dev bypass mode
        // this avoids /api/auth/me while sessions/proxy are still being wired
        if (DEV_BYPASS_AUTH) {
          setAuthUser(DEV_USER);
          setProfile(DEV_PROFILE);
          setBioDraft(DEV_PROFILE.userBio || "");

          const devRows = DEV_APPOINTMENTS as AppointmentRow[];
          setReservations(mapAppointmentsToReservations(devRows));

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
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        setError(msg);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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

  async function onSaveBio() {
    if (!authUser || !profile) return;

    try {
      setSavingBio(true);
      setError(null);

      // in dev bypass, save is local-only so UI work can continue
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
    </div>
  );
}

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