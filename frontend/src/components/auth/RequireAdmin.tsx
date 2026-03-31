import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { getCurrentUser, type AuthUser } from "../../api/auth";

export default function RequireAdmin() {
	/*
		user stores the authenticated user object returned by /auth/me.
		If this stays null after loading, we treat the visitor as not logged in.
	*/
	const [user, setUser] = useState<AuthUser | null>(null);

	/*
		loading keeps this guard from redirecting too early before the
		auth check request has finished.
	*/
	const [loading, setLoading] = useState(true);

	/*
		authorized stores whether the logged-in user passed the admin check.
		This lets the component separately track login state and permission state.
	*/
	const [authorized, setAuthorized] = useState(false);

	useEffect(() => {
		async function checkAdmin() {
			try {
				/*
					Ask the backend who is currently logged in based on the
					existing session cookie.
				*/
				const me = await getCurrentUser();

				/*
					Save the returned user object so this route guard knows
					the visitor is authenticated.
				*/
				setUser(me);

				/*
					Only admins should be allowed through this guard.
				*/
				setAuthorized(me.isAdmin);
			} catch {
				/*
					If the request fails, treat the visitor as not authorized.
					This usually means they are not logged in or the session expired.
				*/
				setAuthorized(false);
			} finally {
				/*
					The auth check is done whether it succeeded or failed,
					so stop showing the loading state.
				*/
				setLoading(false);
			}
		}

		/*
			Run the admin check once when this route guard first mounts.
		*/
		checkAdmin();
	}, []);

	/*
		While the current-user request is still in flight, render a small
		loading state instead of redirecting too early.
	*/
	if (loading) return <div>Loading...</div>;

	/*
		If no authenticated user object was loaded, send the visitor
		to the login page.
	*/
	if (!user) {
		return <Navigate to="/login" replace />;
	}

	/*
		If the user is logged in but is not an admin, block access and
		send them back to the public home page.
	*/
	if (!authorized) {
		return <Navigate to="/" replace />;
	}

	/*
		The user is authenticated and is an admin, so render the nested
		protected admin route content.

		Pass the user through Outlet context so child admin pages can
		read the authenticated admin info if needed.
	*/
	return <Outlet context={user} />;
}