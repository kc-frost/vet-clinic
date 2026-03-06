import { useState, useEffect, useMemo } from "react";
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

export default function ViewAppointments() {
  //tracks whether the page is currently loading appointments
  const [loading, setLoading] = useState(false);

  //stores any fetch or delete error that should be shown on the page
  const [pageError, setPageError] = useState("");

  //stores the appointments returned from the backend
  const [appointments, setAppointments] = useState<Appointment[]>([]);

  useEffect(() => {
    //prevents state updates if component unmounts before request finishes
    let cancelled = false;

    //loads all appointments from the admin appointments endpoint
    async function load() {
      setLoading(true);
      setPageError("");

      try {
        const data = await getAppointments();

        //only update state if component is still mounted
        if (!cancelled) {
          setAppointments(data);
        }
      } catch (err) {
        //show readable fetch error on page
        if (!cancelled) {
          setPageError(errMsg(err));
        }
      } finally {
        //stop loading if component is still mounted
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    //cleanup in case user leaves page mid request
    return () => {
      cancelled = true;
    };
  }, []);

  //sort appointments by their starting datetime so they display in chronological order
  const visibleAppointments = useMemo(() => {
    return [...appointments].sort(
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
    <div className="centered">
      <h1>View All Appointments</h1>

      {/* show fetch or delete error if one happened */}
      {pageError && <p className="error">{pageError}</p>}

      {/* simple loading text while appointments are being fetched */}
      {loading && <p>Loading...</p>}

      <div className="appointments-box">
        <table className="appointments-table">
          <thead>
            <tr>
              <th>Start</th>
              <th>End</th>
              <th>Appointment ID</th>
              <th>Type</th>
              <th>User Email</th>
              <th>Equipment Used</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {visibleAppointments.map((a) => {
              //parse start datetime from the appointment row
              const startObj = parseMySqlDateTime(a.date);

              //use backend provided end datetime when available
              //otherwise compute it from start plus duration as a fallback
              const endObj = a.endDateTime
                ? parseMySqlDateTime(a.endDateTime)
                : new Date(startObj.getTime() + Number(a.durationMinutes || 0) * 60000);

              return (
                <tr key={a.appointmentID}>
                  {/* appointment start date and time */}
                  <td>{startObj.toLocaleString()}</td>

                  {/* appointment computed or returned end date and time */}
                  <td>{endObj.toLocaleString()}</td>

                  {/* appointment primary key */}
                  <td>{a.appointmentID}</td>

                  {/* display friendly appointment type from reason key */}
                  <td>{formatReason(a.reasonKey)}</td>

                  {/* email of the user that owns the appointment */}
                  <td>{a.userEmail || "—"}</td>

                  {/* consumables or equipment associated with the appointment */}
                  <td>{a.equipmentUsed || "—"}</td>

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

            {/* empty state when there are no appointments */}
            {!loading && visibleAppointments.length === 0 && (
              <tr>
                <td colSpan={7}>No appointments found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}