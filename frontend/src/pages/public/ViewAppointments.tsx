import { useState, useEffect, useMemo } from "react";

// import testImage from "../../assets/trashcan1.png";
import type { Appointment } from "../../types/appointment";

import trashIcon from "../../assets/trashcan1.png";


// styles
import "../../styles/appointments.css";

export default function Appointments() {
  return (
    <div className="centered">
      <div className="box">
        <table>
          <tr>
            <th> 🗓️ Date & Time </th>
            <th> Appointment ID</th>
            <th> Appointment Type</th>
            <th> 📧 User Email </th>
            <th> Action </th>
          </tr>
          <tr>
            <td> 2026-01-01 </td>
            <td> #81238182093 </td>
            <td> Routine Checkup </td>
            <td> asd@gmail.com </td>
            <td> <button className="btn danger appt-trash" type="button" aria-label="Delete appointment" title="Delete" onClick={() => {}} > <img src={trashIcon} alt="" className="trash-icon"/> </button> </td>
            {/* <td> 
              <div className="square">
                <img src={trashIcon} alt="hello"/>
                <p>
                  Delete
                </p>
              </div>
            </td> */}
          </tr>
          <tr>  
            <td> 2026-01-02 </td>
            <td> #943858345 </td>
            <td> Specialized Treatment </td>
            <td> uusdjqks@gmail.com </td>
            <td> <button className="btn danger appt-trash" type="button" aria-label="Delete appointment" title="Delete" onClick={() => {}} > <img src={trashIcon} alt="" className="trash-icon" /> </button> </td>
          </tr>
        </table>
      </div>
    </div>
  );
}