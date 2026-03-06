// RequireAdmin.tsx
// React component used to protect routes that require
// administrator privileges.

import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { getCurrentUser, type AuthUser } from "../../api/auth";

export default function RequireAdmin() {
  // Holds the currently authenticated user
  const [user, setUser] = useState<AuthUser | null>(null);
  // Indicates whether the authentication check is still running
  const [loading, setLoading] = useState(true);
  // Tracks whether the user is authorized to access the route
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    // Function that checks if the logged in user is an admin
    async function checkAdmin() {
      try {
        // Request the currently logged in user from the backend
        const me = await getCurrentUser();
        setUser(me);
        // Verify the user has admin privileges
        setAuthorized(me.isAdmin);
      } catch {
        // If an error occurs, the user is not authorized
        setAuthorized(false);
      } finally {
        // Authentication check is complete
        setLoading(false);
      }
    }

    checkAdmin();
  }, []);
  // While loading, render nothing
  if (loading) return <div>Loading...</div>;

  if (!user) {
    return <Navigate to="/register" replace />;
  }
  // If the user is not authorized redirect to login
  if (!authorized) {
    return <Navigate to="/" replace />;
  }
  // If authorized, render the protected route
  return <Outlet context={user} />;
}