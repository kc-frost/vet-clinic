// other imports
import { useState, useEffect, useMemo } from "react";

// types
import type { Appointment } from "../../types/appointment";

// api funcs
import { getAppointments, deleteAppointment } from "../../api/appointments";

// styles and images
import trashIcon from "../../assets/trashcan1.png";
import "../../styles/appointments.css";

// Error message helper
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

// Safe parser for MySQL DATETIME strings like "2026-02-14 14:30:00"
function parseMySqlDateTime(s: string) {
  // Converts "YYYY-MM-DD HH:MM:SS" -> "YYYY-MM-DDTHH:MM:SS"
  return new Date(s.replace(" ", "T"));
}

export default function Appointments() {
  // tracks whether data from db is being loaded
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState("");

  // appointments state to store appointments gotten from db
  const [appointments, setAppointments] = useState<Appointment[]>([]);

  // Runs after page load
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setPageError("");

      try {
        const data = await getAppointments();
        if (!cancelled) setAppointments(data);
      } catch (err) {
        if (!cancelled) setPageError(errMsg(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Filter appointments before current date and sort descending
  const visibleAppointments = useMemo(() => {
    const now = new Date();
    return [...appointments]
      .filter((appt) => {
        // convert date from sql to typescript format to compare
        const apptDate = parseMySqlDateTime(appt.date);
        return apptDate.getTime() >= now.getTime();
      })
      .sort(
        (a, b) =>
          parseMySqlDateTime(a.date).getTime() -
          parseMySqlDateTime(b.date).getTime() 
      );
  }, [appointments]);

  // Deletes appointment when you click the trash can, then reloads page
  async function deleteAppt(appointmentID: number) {
    try {
      await deleteAppointment(appointmentID);
      const data = await getAppointments();
      setAppointments(data);
    } catch (err) {
      setPageError(errMsg(err));
    }
  }

  return (
    <div className="centered">
      <h1>View All Appointments</h1>

      {/*Show error message, also a loading message for when data is loading. */}
      {pageError && <p className="error">{pageError}</p>}
      {loading && <p>Loading...</p>}

      <div className="appointments-box">
        <table className="appointments-table">
          <thead>
            <tr>
              <th>🗓️ Date</th>
              <th>#️⃣Appointment ID</th>
              <th>📝Appointment Type</th>
              <th>📧 User Email</th>
              <th>🔧Action</th>
            </tr>
          </thead>

          <tbody>
            {visibleAppointments.map((a) => {
              const dateObj = parseMySqlDateTime(a.date);
              // Grab appointment data, place in a row
              return (
                <tr key={a.appointmentID}>
                  <td>{dateObj.toLocaleString()}</td>
                  <td>{a.appointmentID}</td>
                  <td>{a.reason}</td>
                  <td>{a.userID}</td>
                  <td>
                    {/* delete button */}
                  <button onClick={() => deleteAppt(a.appointmentID)} className="btn danger appt-trash" aria-label="Delete appointment" title="Delete">
                    <img src={trashIcon} alt="" className="trash-icon" />
                    <p> Delete </p>
                  </button>
                  </td>
                </tr>
              );
            })}

            {/* If no appointments, show this. */}
            {!loading && visibleAppointments.length === 0 && (
              <tr>
                <td colSpan={5}>No upcoming appointments.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
