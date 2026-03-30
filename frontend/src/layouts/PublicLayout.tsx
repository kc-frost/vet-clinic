import { Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import "../styles/publicLayout.css";
import NavButton from "../components/NavButton";
import { getCurrentUser, type AuthUser } from "../api/auth";
import NotificationBell from "../components/NotificationBell";

// public layout used for the main site header and outlet pages
// admin-only nav buttons are rendered only when the logged in user has admin access
export default function PublicLayout() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const location = useLocation();

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const me = await getCurrentUser();
        if (!alive) return;
        setCurrentUser(me);
      } catch {
        if (!alive) return;
        setCurrentUser(null);
      }
    })();

    return () => {
      alive = false;
    };
  }, [location.pathname]);

  const isAdmin = !!currentUser?.isAdmin;

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
            <button type="button" className="nav-btn">Contact</button>

            {isAdmin ? (
              <>
                <NavButton to="/staff/inventory" className="nav-btn">Inventory</NavButton>
                <NavButton to="/staff/users" className="nav-btn">View Users</NavButton>
                <NavButton to="/staff/appointments" className="nav-btn">View Appointments</NavButton>
              </>
            ) : null}

            <NavButton to="/reservation" className="nav-btn">Create Appointment</NavButton>
            <NavButton to="/login" className="nav-btn">Login</NavButton>
            <NavButton to="/register" className="nav-btn nav-btn--cta">Register</NavButton>
            <NavButton to="/userprofile" className="nav-btn">My Profile</NavButton>
            {currentUser ? <NotificationBell /> : null}
          </div>
        </nav>
      </header>

      <Outlet />
    </>
  );
}