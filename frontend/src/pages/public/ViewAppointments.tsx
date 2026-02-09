// other imports
import {useState, useEffect, useMemo} from "react";

// types
import type {Appointment} from "../../types/appointment";

// api funcs
import {getAppointments} from "../../api/appointments";
import {deleteAppointment} from "../../api/appointments";

// styles and images
import trashIcon from "../../assets/trashcan1.png";
import "../../styles/appointments.css";

//constants

// Error message that luis had, I'm adding it just in case
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}






export default function Appointments() {
  // tracks whether data from db is being loaded
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState("");

  // appointments state to store appointments gotten from db
  const [appointments, setAppointments] = useState<Appointment[]>([]);

  // Runs after page load, incase something fales, kinda like a try catch from python or java
  useEffect(() => {
    let cancelled = false;

    // function that loads appointments from db and updates state made above
    async function load() {
      setLoading(true);
      setPageError("");

      // try catch block to catch errors from db
      // also checks if appointments were cancelled before updating appointments state
      try {
        const date = await getAppointments();
        if (!cancelled) setAppointments(date);
      } 
      catch (err) {
        if (!cancelled) setPageError(errMsg(err));
      } 
      finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Filter appointments before current date
  const visibleAppointments = useMemo(() => {
    const now = new Date();

    return [...appointments].filter((appt) => {
      const apptDate = new Date(appt.datetime);
      return apptDate >= now;
    });
  }, [appointments]);

  // Read func name duh
  async function deleteAppt(appointmentID: number) {
    try {
      await deleteAppointment(appointmentID);

      const date = await getAppointments();
      setAppointments(date);
    }
    catch (err) {
      setPageError(errMsg(err)); 
  }
}

return (
  <div className="centered">
    <h1>Appointments</h1>
    <p className="subtitle">View all appointments here</p>

    <div className="box">
      <table className="appointments-table">
        <thead>
          <tr>
            <th>🗓️ Date</th>
            <th>Appointment ID</th>
            <th>Appointment Type</th>
            <th>📧 User Email</th>
          </tr>
        </thead>

        <tbody>
          {visibleAppointments.map((a) => {
            const dateObj = new Date((a as any).datetime);

            return (
              <tr key={(a as any).appointmentID}>
                <td>{dateObj.toLocaleString()}</td>
                <td>{(a as any).appointmentID}</td>
                <td>{(a as any).appointmentType}</td>
                <td>{(a as any).userEmail}</td>
                <td>
                  <button
                    className="btn danger appt-trash"
                    type="button"
                    aria-label="Delete appointment"
                    title="Delete"
                    onClick={() => deleteAppt((a as any).appointmentID)}
                  >
                    <img src={trashIcon} alt="" className="trash-icon" />
                  </button>
                </td>
              </tr>
            );
          })}

          {/* Show this when no upcoming appointments */}
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