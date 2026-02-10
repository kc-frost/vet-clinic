import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import PublicLayout from "../layouts/PublicLayout";
import StaffLayout from "../layouts/StaffLayout";

import Home from "../pages/public/Home";
import Login from "../pages/public/Login";
import Register from "../pages/public/Register";

import Inventory from "../pages/staff/Inventory";

import ViewAppointments from "../pages/public/ViewAppointments";


export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public site routes w/  public header/footer */}
        <Route element={<PublicLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/viewappointments" element={<ViewAppointments />} />
        </Route>

        {/* Staff routes, separate layout w/ no public header/footer) */}
        <Route path="/staff" element={<StaffLayout />}>
          {/* If user goes to /staff, send them to /staff/inventory */}
          <Route index element={<Navigate to="inventory" replace />} />
          <Route path="inventory" element={<Inventory />} />
        </Route>

        {/* Catches any unknown URL redirected home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
