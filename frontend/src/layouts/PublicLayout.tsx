import { Outlet } from "react-router-dom";
import "../styles/publicLayout.css";
import NavButton from "../components/NavButton";

export default function PublicLayout() {
  return (
    <>
      <header className="public-header">
        <nav className="public-nav">
          <NavButton to="/" className="nav-brand">
            WEBSITENAME
          </NavButton>

          <div className="nav-right">
            {/* Dummy buttons for now */}
            <button type="button" className="nav-btn">About</button>
            <button type="button" className="nav-btn">Services</button>
            <button type="button" className="nav-btn">Resources</button>
            <button type="button" className="nav-btn">Contact</button>

            {/* Real nav buttons */}
            <NavButton to="/login" className="nav-btn">Login</NavButton>
            <NavButton to="/register" className="nav-btn nav-btn--cta">Register</NavButton>
          </div>
        </nav>
      </header>

      <Outlet />
    </>
  );
}
