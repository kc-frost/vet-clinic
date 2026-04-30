import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ViewAllUsers from "../pages/staff/ViewAllUsers";

import PublicLayout from "../layouts/PublicLayout";
import AdminLayout from "../layouts/AdminLayout";

import Home from "../pages/public/Home";
import Login from "../pages/public/Login";
import Register from "../pages/public/Register";

import Inventory from "../pages/staff/Inventory";
import StaffDashboard from "../pages/staff/StaffDashboard";
import AppointmentSummary from "../pages/staff/AppointmentSummary";
import Reservation from "../pages/public/Reservation";
import ViewAppointments from "../pages/public/ViewAppointments";
import UserProfile from "../pages/public/UserProfile";
import AppointmentSummaryView from "../pages/public/AppointmentSummaryView";

import RequireAuth from "../components/auth/RequireAuth";
import RequireAdmin from "../components/auth/RequireAdmin";
import RequireStaff from "../components/auth/RequireStaff";

import AdminAnalytics from "../pages/admin/AdminAnalytics";
import AdminIssues from "../pages/admin/AdminIssues";

export default function AppRouter() {
	return (
		<BrowserRouter>
			<Routes>
				{/* Public layout wraps the normal public-facing pages. */}
				<Route element={<PublicLayout />}>
					<Route path="/" element={<Home />} />
					<Route path="/login" element={<Login />} />
					<Route path="/register" element={<Register />} />

					{/* These pages require any logged-in user. */}
					<Route element={<RequireAuth />}>
						<Route path="/reservation" element={<Reservation />} />
						<Route path="/userprofile" element={<UserProfile />} />
						<Route path="/user/appointments/:appointmentID/summary" element={<AppointmentSummaryView />} />
					</Route>

					{/* Staff-only routes inside the public layout area. */}
					<Route element={<RequireStaff />}>
						<Route path="/staff/dashboard" element={<StaffDashboard />} />
						<Route path="/staff/appointments/:appointmentID/summary" element={<AppointmentSummary />} />
					</Route>
				</Route>

				{/* Admin-only staff management area. */}
				<Route element={<RequireAdmin />}>
					<Route path="/admin" element={<AdminLayout />}>
						{/* Visiting /staff should immediately go to /admin/analytics. */}
						<Route index element={<Navigate to="analytics" replace />} />
						<Route path="analytics" element={<AdminAnalytics />} />
						<Route path="inventory" element={<Inventory />} />
						<Route path="users" element={<ViewAllUsers />} />
						<Route path="appointments" element={<ViewAppointments />} />
						<Route path="issues" element={<AdminIssues />} />
					</Route>
				</Route>

				{/* Catch-all fallback for unknown routes. */}
				<Route path="*" element={<Navigate to="/" replace />} />
			</Routes>
		</BrowserRouter>
	);
}