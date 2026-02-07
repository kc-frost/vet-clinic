import { useState, useEffect, useMemo } from "react";

import type { Appointment } from "../../types/appointment";


// styles
import "../../styles/appointments.css";

export default function Appointments() {
  return (
    <div className="centered">
      <h1>
        Appointments
      </h1>
      <p className="subtitle">
        View all appointments here
      </p>
      <div className="box">
        <table>
          <tr>
            <th> 🗓️ Date </th>
            <th> Appointment ID</th>
            <th> Appointment Type</th>
            <th> 📧 User Email </th>
          </tr>
          <tr>
            <td> 2026-01-01 </td>
            <td> #81238182093 </td>
            <td> Routine Checkup </td>
            <td> asd@gmail.com </td>
          </tr>
          <tr>
            <td> 2026-01-02 </td>
            <td> #943858345 </td>
            <td> Specialized Treatment </td>
            <td> uusdjqks@gmail.com </td>
          </tr>
        </table>
      </div>
    </div>
  );
}