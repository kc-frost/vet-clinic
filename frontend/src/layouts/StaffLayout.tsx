import { Outlet } from "react-router-dom";
import { Link } from "react-router-dom";

export default function StaffLayout() {
  return (
    <>
      <Link to="/staff/users">View All Users</Link>
      <Outlet />
    </>
  );
}