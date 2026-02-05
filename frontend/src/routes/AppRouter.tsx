import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import PublicLayout from "../layouts/PublicLayout";
import StaffLayout from "../layouts/StaffLayout";

import Home from "../pages/public/Home";
import Login from "../pages/public/Login";
import Register from "../pages/public/Register";

import Inventory from "../pages/staff/Inventory";



export default function AppRouter() {
  return (
    <BrowserRouter>
  <Routes>
    {/* Public site routes w/ public header/footer */}
    <Route path="/" element={<PublicLayout />}>
      <Route index element={<Home />} />
      <Route path="login" element={<Login />} />
      <Route path="register" element={<Register />} />
      <Route path="appointments" element={<Appointments />} />
    </Route>

    {/* Staff routes */}
    <Route path="/staff" element={<StaffLayout />}>
      <Route index element={<Navigate to="inventory" replace />} />
      <Route path="inventory" element={<Inventory />} />
    </Route>

    {/* Catches any unknown URL redirected home */}
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
</BrowserRouter>
  );
}
