import React, { useEffect, useMemo, useState } from "react";
import "../../styles/userProfile.css";

/** Types (match backend later) */
type User = {
  id: number;
  email: string;
  username: string;
  bio: string | null;
  profileImageUrl?: string | null;
};

type Reservation = {
  id: number;
  startTime: string; // ISO string
  endTime?: string | null;
  itemName?: string | null;
  status?: string | null;
};

/** Date helpers */
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

/** ---------- API layer (swap endpoints later, UI stays the same) ---------- */
const API_BASE = import.meta?.env?.VITE_API_BASE_URL ?? ""; // e.g. "http://localhost:3001"

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    credentials: "include", // keeps cookie/session working
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GET ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PUT ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

/**
 * These are the ONLY things you change later:
 * - Replace "/api/me" with your real endpoint
 * - Replace "/api/reservations/me" with your real endpoint
 * - Replace "/api/me/bio" with your real endpoint
 */
async function fetchMe(): Promise<User> {
  return apiGet<User>("/api/me");
}
async function fetchMyReservations(): Promise<Reservation[]> {
  return apiGet<Reservation[]>("/api/reservations/me");
}
async function updateMyBio(bio: string): Promise<User> {
  return apiPut<User>("/api/me/bio", { bio });
}

/** ---------- Temporary mock fallback so UI builds now ---------- */
const USE_MOCK_DATA = true; // flip to false when backend endpoints are ready

const mockUser: User = {
  id: 1,
  email: "test@email.com",
  username: "TestUser",
  bio: "This is a test bio. Edit me!",
  profileImageUrl: null,
};

const mockReservations: Reservation[] = [
  // past
  { id: 101, startTime: new Date(Date.now() - 86400000 * 2).toISOString(), itemName: "Exam Room A" },
  // today
  { id: 102, startTime: new Date().toISOString(), itemName: "Grooming Station" },
  // future
  { id: 103, startTime: new Date(Date.now() + 86400000 * 3).toISOString(), itemName: "X-Ray Machine" },
];

/** ---------- Component ---------- */
export default function UserProfile() {
  const [user, setUser] = useState<User | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [bioDraft, setBioDraft] = useState("");

  const [loading, setLoading] = useState(true);
  const [savingBio, setSavingBio] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load initial data
  useEffect(() => {
    (async () => {
      try {
        setError(null);

        if (USE_MOCK_DATA) {
          setUser(mockUser);
          setReservations(mockReservations);
          setBioDraft(mockUser.bio ?? "");
          return;
        }

        const me = await fetchMe();
        const myRes = await fetchMyReservations();

        setUser(me);
        setReservations(myRes);
        setBioDraft(me.bio ?? "");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Split reservations into 3 buckets
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

    // Sort for nicer UI
    past.sort((a, b) => +new Date(b.startTime) - +new Date(a.startTime));
    today.sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime));
    future.sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime));

    return { past, today, future };
  }, [reservations]);

  async function onSaveBio() {
    if (!user) return;

    try {
      setSavingBio(true);
      setError(null);

      if (USE_MOCK_DATA) {
        // local-only update for now
        setUser({ ...user, bio: bioDraft });
        return;
      }

      const updated = await updateMyBio(bioDraft);
      setUser(updated);
      setBioDraft(updated.bio ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save bio");
    } finally {
      setSavingBio(false);
    }
  }

  if (loading) return <div className="profilePage">Loading profile…</div>;
  if (error) return <div className="profilePage errorBox">Error: {error}</div>;
  if (!user) return <div className="profilePage errorBox">No user loaded.</div>;

  return (
    <div className="profilePage">
      <h1 className="profileTitle">My Profile</h1>

      <div className="topRow">
        <section className="card">
          <h2>User Identification</h2>
          <p><b>ID:</b> {user.id}</p>
          <p><b>Username:</b> {user.username}</p>
          <p><b>Email:</b> {user.email}</p>
        </section>

        <section className="card">
          <h2>Profile Picture</h2>
          <img
            className="profileImg"
            src={user.profileImageUrl || "https://via.placeholder.com/220"}
            alt="profile"
          />
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
          placeholder="Write a short bio about yourself…"
        />
        <button className="primaryBtn" onClick={onSaveBio} disabled={savingBio}>
          {savingBio ? "Saving…" : "Save Bio"}
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