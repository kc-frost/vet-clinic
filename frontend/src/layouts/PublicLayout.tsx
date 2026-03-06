import { Outlet } from "react-router-dom";
import "../styles/publicLayout.css";
import NavButton from "../components/NavButton";

// public layout used for the main site header and outlet pages
export default function PublicLayout() {
  return (
    <>
      <header className="public-header">
        <nav className="public-nav">
          <NavButton to="/" className="nav-brand">
            Vet Clinic
          </NavButton>

          <div className="nav-right">
            <button type="button" className="nav-btn">About</button>
            <button type="button" className="nav-btn">Services</button>
            <button type="button" className="nav-btn">Resources</button>
            <button type="button" className="nav-btn">Contact</button>

            <NavButton to="/staff/appointments" className="nav-btn">View Appointments</NavButton>
            <NavButton to="/reservation" className="nav-btn">Create Appointment</NavButton>
            <NavButton to="/login" className="nav-btn">Login</NavButton>
            <NavButton to="/register" className="nav-btn nav-btn--cta">Register</NavButton>
            <NavButton to="/userprofile" className="nav-btn">My Profile</NavButton>
          </div>
        </nav>
      </header>

      <Outlet />
    </>
  );
}