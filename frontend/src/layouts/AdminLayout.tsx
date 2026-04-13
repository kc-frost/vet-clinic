import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import "../styles/adminLayout.css";

function AdminNavLink({
	to,
	children,
}: {
	to: string;
	children: ReactNode;
}) {
	return (
		<NavLink
			to={to}
			className={({ isActive }) =>
				`adminNavLink${isActive ? " adminNavLinkActive" : ""}`
			}
		>
			{children}
		</NavLink>
	);
}

export default function AdminLayout() {
	return (
		<div className="adminArea">
			<header className="adminHeader">
				<div className="adminHeaderInner">
					<div className="adminBrand">Admin Area</div>

					<nav className="adminNav">
						<AdminNavLink to="/">Home</AdminNavLink>
						<AdminNavLink to="/admin/analytics">View Analytics</AdminNavLink>
						<AdminNavLink to="/admin/users">View All Users</AdminNavLink>
						<AdminNavLink to="/admin/appointments">View All Appointments</AdminNavLink>
						<AdminNavLink to="/admin/inventory">View Inventory</AdminNavLink>
						<AdminNavLink to="/admin/issues">Issues / Review Queue</AdminNavLink>
					</nav>
				</div>
			</header>

			<main className="adminMain">
				<div className="adminContent">
					<Outlet/>

				</div>
			</main>
		</div>
	);
}