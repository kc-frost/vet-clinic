// ViewAllUsers.tsx
// Staff page that displays all registered users
// along with their reservation statistics.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAllUsers, type UserSummary } from "../../api/users";
import "../../styles/viewUsers.css";

export default function ViewAllUsers() {
  const navigate = useNavigate();

  // state storing all retrieved users
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadUsers() {
      try {
        setLoading(true);
        setPageError("");

        const data = await getAllUsers();
        if (!cancelled) {
          setUsers(data);
        }
      } catch (err) {
        if (!cancelled) {
          setPageError(err instanceof Error ? err.message : "Failed to load users");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadUsers();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="usersPage">
      <div className="usersHeader">
        <button
          type="button"
          className="pageHomeBtn"
          onClick={() => navigate("/")}
        >
          ← Home
        </button>

        <h1>View All Users</h1>
      </div>

      {pageError ? <p className="usersError">{pageError}</p> : null}
      {loading ? <p className="usersLoading">Loading...</p> : null}

      <div className="usersShell">
        <table className="usersTable">
          <thead>
            <tr>
              <th>User ID</th>
              <th>Email</th>
              <th>Days Registered</th>
              <th>Total Reservations</th>
              <th>Past Reservations</th>
              <th>Upcoming Reservations</th>
            </tr>
          </thead>

          <tbody>
            {users.map((u) => (
              <tr key={u.userID}>
                <td>{u.userID}</td>
                <td>{u.email}</td>
                <td>{u.days_registered}</td>
                <td>{u.total_reservations}</td>
                <td>{u.past_reservations}</td>
                <td>{u.upcoming_reservations}</td>
              </tr>
            ))}

            {!loading && users.length === 0 ? (
              <tr>
                <td colSpan={6}>No users found.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}