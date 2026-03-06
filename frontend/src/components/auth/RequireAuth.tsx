// RequireAuth.tsx
// React component used to protect routes that require
// a logged in user.

import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { getCurrentUser, type AuthUser } from "../../api/auth";

export default function RequireAuth() {
  // Stores the currently authenticated user
  const [user, setUser] = useState<AuthUser | null>(null);
  // Tracks whether the authentication check is still loading
  const [loading, setLoading] = useState(true);
  // Indicates whether the user is allowed to access the route
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    // Function that checks if the user is logged in
    async function checkAuth() {
      try {
        // Request the currently logged in user from the backend
        const me = await getCurrentUser();
        // If a user exists, authorize access
        setUser(me);
        setAuthorized(true);
      } catch {
        // If request fails the user is not authorized
        setAuthorized(false);
      } finally {
        // Authentication check finished
        setLoading(false);
      }
    }

    checkAuth();
  }, []);
  // While checking authentication do not render anything
  if (loading) return <div>Loading...</div>;
  // Redirect unauthenticated users to login page
  if (!authorized) {
    return <Navigate to="/register" replace />;
  }
  // If authenticated render the protected route
  return <Outlet context={user} />;
}