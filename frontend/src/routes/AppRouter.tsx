// AppRouter.tsx
// main routing configuration for the frontend application
// defines public routes protected routes and admin routes

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ViewAllUsers from "../pages/staff/ViewAllUsers";

import PublicLayout from "../layouts/PublicLayout";
import StaffLayout from "../layouts/StaffLayout";

import Home from "../pages/public/Home";
import Login from "../pages/public/Login";
import Register from "../pages/public/Register";

import Inventory from "../pages/staff/Inventory";
import Reservation from "../pages/public/Reservation";
import ViewAppointments from "../pages/public/ViewAppointments";
import UserProfile from "../pages/public/UserProfile";

import RequireAuth from "../components/auth/RequireAuth";
import RequireAdmin from "../components/auth/RequireAdmin";

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>

        {/* public routes */}
        <Route element={<PublicLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* logged in user routes */}
          <Route element={<RequireAuth />}>
            <Route path="/reservation" element={<Reservation />} />
            <Route path="/userprofile" element={<UserProfile />} />
          </Route>
        </Route>

        {/* admin routes */}
        <Route element={<RequireAdmin />}>
          <Route path="/staff" element={<StaffLayout />}>
            <Route index element={<Navigate to="inventory" replace />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="users" element={<ViewAllUsers />} />
            <Route path="appointments" element={<ViewAppointments />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}