import { Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import "../styles/publicLayout.css";
import NavButton from "../components/NavButton";
import { getCurrentUser, type AuthUser } from "../api/auth";

export default function PublicLayout() {
    /*
        currentUser stores the logged-in user if a valid session exists.
    */
    const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
    const location = useLocation();

    useEffect(() => {
        /*
            alive prevents state updates if this effect gets cleaned up
            before the current-user request finishes.
        */
        let alive = true;

        (async () => {
            try {
                /*
                    Check who is currently logged in so the navbar can
                    render the correct links for this page load.
                */
                const me = await getCurrentUser();
                if (!alive) return;

                setCurrentUser(me);
            } catch {
                /*
                    If the request fails, treat the visitor as logged out.
                */
                if (!alive) return;
                setCurrentUser(null);
            }
        })();

        return () => {
            alive = false;
        };
    }, [location.pathname]);

    /*
        These booleans make the navbar conditions easier to read.
    */
    const isLoggedIn = !!currentUser;
    const isAdmin = !!currentUser?.isAdmin;
    const isStaff = !!currentUser?.isStaff;

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

                        {/* Only admins should see the admin-only navigation link. */}
                        {isAdmin ? (
                            <NavButton to="/admin/analytics" className="nav-btn">
                                Admin Area
                            </NavButton>
                        ) : null}

                        {/* Staff users get the staff dashboard link. */}
                        {isStaff ? (
                            <NavButton to="/staff/dashboard" className="nav-btn">
                                Staff Dashboard
                            </NavButton>
                        ) : null}

                        {/* Logged-in users see appointment/profile links. Guests see login/register. */}
                        {isLoggedIn ? (
                            <>
                                <NavButton to="/reservation" className="nav-btn">
                                    Create Appointment
                                </NavButton>
                                <NavButton to="/userprofile" className="nav-btn">
                                    My Profile
                                </NavButton>
                            </>
                        ) : (
                            <>
                                <NavButton to="/login" className="nav-btn">
                                    Login
                                </NavButton>
                                <NavButton to="/register" className="nav-btn nav-btn--cta">
                                    Register
                                </NavButton>
                            </>
                        )}
                    </div>
                </nav>
            </header>

            <Outlet />
        </>
    );
}