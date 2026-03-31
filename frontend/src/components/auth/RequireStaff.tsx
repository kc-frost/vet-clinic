import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { getCurrentUser, type AuthUser } from "../../api/auth";

export default function RequireStaff() {
	/*
		user stores the current authenticated user returned by /auth/me.
	*/
	const [user, setUser] = useState<AuthUser | null>(null);

	/*
		loading prevents redirect logic from running before the
		staff check finishes.
	*/
	const [loading, setLoading] = useState(true);

	/*
		authorized tracks whether the logged-in user is actually staff.
	*/
	const [authorized, setAuthorized] = useState(false);

	useEffect(() => {
		async function checkStaff() {
			try {
				/*
					Ask the backend who is currently logged in, then
					check whether that user has the staff role.
				*/
				const me = await getCurrentUser();

				setUser(me);
				setAuthorized(me.isStaff);
			} catch {
				/*
					If the request fails, treat the visitor as not authorized.
				*/
				setAuthorized(false);
			} finally {
				setLoading(false);
			}
		}

		checkStaff();
	}, []);

	if (loading) return <div>Loading...</div>;

	/*
		If nobody is logged in, send the visitor to the login page.
	*/
	if (!user) {
		return <Navigate to="/login" replace />;
	}

	/*
		If the user is logged in but is not staff, block access
		and send them back to the home page.
	*/
	if (!authorized) {
		return <Navigate to="/" replace />;
	}

	/*
		The user passed the staff check, so render the protected
		staff route and pass the user through Outlet context.
	*/
	return <Outlet context={user} />;
}