import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { Appointment } from "../../types/appointment";
import { getAppointments, deleteAppointment } from "../../api/appointments";
import trashIcon from "../../assets/trashcan1.png";
import "../../styles/appointments.css";

//turn unknown thrown values into a readable message
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

//convert mysql datetime text into a js Date object
function parseMySqlDateTime(s: string) {
  return new Date(s.replace(" ", "T"));
}

//make reason keys like wellness_exam display nicely as Wellness Exam
function formatReason(reasonKey: string) {
  return reasonKey
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

//format a datetime for display without seconds
function formatDateTimeNoSeconds(value: string) {
  const d = parseMySqlDateTime(value);

  return d.toLocaleString([], {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ViewAppointments() {
  const navigate = useNavigate();

  //tracks whether the page is currently loading appointments
  const [loading, setLoading] = useState(false);

  //stores any fetch or delete error that should be shown on the page
  const [pageError, setPageError] = useState("");

  //stores the appointments returned from the backend
  const [appointments, setAppointments] = useState<Appointment[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setPageError("");

      try {
        const data = await getAppointments();
        if (!cancelled) {
          setAppointments(data);
        }
      } catch (err) {
        if (!cancelled) {
          setPageError(errMsg(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  //sort appointments by their starting datetime and hide appointments already in the past
  const visibleAppointments = useMemo(() => {
    const now = Date.now();

    return [...appointments]
      .filter((a) => parseMySqlDateTime(a.date).getTime() >= now)
      .sort(
        (a, b) =>
          parseMySqlDateTime(a.date).getTime() -
          parseMySqlDateTime(b.date).getTime()
      );
  }, [appointments]);

  //deletes one appointment then refreshes the table
  async function deleteAppt(appointmentID: number) {
    try {
      setPageError("");
      await deleteAppointment(appointmentID);

      const data = await getAppointments();
      setAppointments(data);
    } catch (err) {
      setPageError(errMsg(err));
    }
  }

  return (
    <div className="appointmentsPage">
      <div className="appointmentsHeader">
        <button
          type="button"
          className="pageHomeBtn"
          onClick={() => navigate("/")}
        >
          ← Home
        </button>

        <h1>View All Appointments</h1>
      </div>

      {pageError && <p className="appointmentsError">{pageError}</p>}
      {loading && <p className="appointmentsLoading">Loading...</p>}

      <div className="appointmentsShell">
        <table className="appointments-table">
          <thead>
            <tr>
              <th>Start</th>
              <th>End</th>
              <th>Appt. ID</th>
              <th>Type</th>
              <th>User Email</th>
              <th>Staff</th>
              <th>Room</th>
              <th>Equipment Used</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {visibleAppointments.map((a) => {
              const endObj = a.endDateTime
                ? a.endDateTime
                : new Date(
                    parseMySqlDateTime(a.date).getTime() +
                      Number(a.durationMinutes || 0) * 60000
                  ).toISOString();

              return (
                <tr key={a.appointmentID}>
                  <td>{formatDateTimeNoSeconds(a.date)}</td>
                  <td>{formatDateTimeNoSeconds(String(endObj).replace("T", " "))}</td>
                  <td>{a.appointmentID}</td>
                  <td>{formatReason(a.reasonKey)}</td>
                  <td>{a.userEmail || "—"}</td>
                  <td className="staffCell">
                    <div>{a.staffID ?? "—"}</div>
                    <div className="cellSubText">{a.staffName || "—"}</div>
                  </td>
                  <td className="roomCell">
                    <div>{a.roomNumber ?? "—"}</div>
                    <div className="cellSubText">{a.roomType || "—"}</div>
                  </td>
                  <td className="equipmentCell">{a.equipmentUsed || "—"}</td>
                  <td>
                    <button
                      onClick={() => deleteAppt(a.appointmentID)}
                      className="btn danger appt-trash"
                      aria-label="Delete appointment"
                      title="Delete"
                    >
                      <img src={trashIcon} alt="" className="trash-icon" />
                      <p>Delete</p>
                    </button>
                  </td>
                </tr>
              );
            })}

            {!loading && visibleAppointments.length === 0 && (
              <tr>
                <td colSpan={9}>No appointments found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}