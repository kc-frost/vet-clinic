import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { Appointment } from "../../types/appointment";
import { getAppointments, deleteAppointment } from "../../api/appointments";
import trashIcon from "../../assets/trashcan1.png";
import "../../styles/appointments.css";

// turn unknown thrown values into a readable message
function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : "Unknown error";
}

// convert mysql datetime text into a js Date object
function parseMySqlDateTime(s: string) {
	return new Date(s.replace(" ", "T"));
}

// make reason keys like wellness_exam display nicely as Wellness Exam
function formatReason(reasonKey: string) {
	return reasonKey.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// format a datetime for display without seconds
function formatDateTimeNoSeconds(value: string) {
	const d = parseMySqlDateTime(value);
	return d.toLocaleString([], {
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

// keeps date-only filtering on the local calendar date
function getLocalDateOnlyText(value: string) {
	const d = parseMySqlDateTime(value);
	const year = d.getFullYear();
	const month = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

// splits comma separated staff search text into clean entries
function parseStaffSearchEntries(raw: string) {
	return raw.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean);
}

export default function ViewAppointments() {
	const navigate = useNavigate();
	const [loading, setLoading] = useState(false);
	const [pageError, setPageError] = useState("");
	const [appointments, setAppointments] = useState<Appointment[]>([]);

	// these are combined filters, not one-at-a-time filters
	const [filterStartDate, setFilterStartDate] = useState("");
	const [filterEndDate, setFilterEndDate] = useState("");
	const [filterAppointmentId, setFilterAppointmentId] = useState("");
	const [filterAppointmentType, setFilterAppointmentType] = useState("");
	const [filterUserEmail, setFilterUserEmail] = useState("");
	const [filterStaff, setFilterStaff] = useState("");

	useEffect(() => {
		let cancelled = false;

		async function load() {
			setLoading(true);
			setPageError("");
			try {
				const data = await getAppointments();
				if (!cancelled) setAppointments(data);
			} catch (err) {
				if (!cancelled) setPageError(errMsg(err));
			} finally {
				if (!cancelled) setLoading(false);
			}
		}

		load();
		return () => {
			cancelled = true;
		};
	}, []);

	// this keeps appointments that have not finished yet and sorts by start time
	const visibleAppointments = useMemo(() => {
		const now = Date.now();
		return [...appointments]
			.filter((a) => {
				const endDateTime = a.endDateTime
					? String(a.endDateTime)
					: new Date(parseMySqlDateTime(a.date).getTime() + Number(a.durationMinutes || 0) * 60000).toISOString();
				return new Date(String(endDateTime).replace(" ", "T")).getTime() > now;
			})
			.sort((a, b) => parseMySqlDateTime(a.date).getTime() - parseMySqlDateTime(b.date).getTime());
	}, [appointments]);

	// this applies all active filters together
	const filteredAppointments = useMemo(() => {
		const appointmentIdQuery = filterAppointmentId.trim();
		const typeQuery = filterAppointmentType.trim().toLowerCase();
		const emailQuery = filterUserEmail.trim().toLowerCase();
		const staffQueries = parseStaffSearchEntries(filterStaff);

		return visibleAppointments.filter((a) => {
			const apptDateOnly = getLocalDateOnlyText(a.date);
			const formattedReason = formatReason(a.reasonKey).toLowerCase();
			const rawReason = String(a.reasonKey || "").toLowerCase();
			const userEmail = String(a.userEmail || "").toLowerCase();
			const assignedStaffSummary = String(a.assignedStaffSummary || "").toLowerCase();

			// start date is inclusive
			if (filterStartDate && apptDateOnly < filterStartDate) return false;

			// end date is inclusive
			if (filterEndDate && apptDateOnly > filterEndDate) return false;

			if (appointmentIdQuery && !String(a.appointmentID).includes(appointmentIdQuery)) return false;

			// type can match either the raw reason key or the display label
			if (typeQuery && !rawReason.includes(typeQuery) && !formattedReason.includes(typeQuery)) return false;

			if (emailQuery && !userEmail.includes(emailQuery)) return false;

			// each comma separated staff entry must be present somewhere in the assigned staff text
			if (staffQueries.length > 0 && !staffQueries.every((entry) => assignedStaffSummary.includes(entry))) return false;

			return true;
		});
	}, [filterAppointmentId, filterAppointmentType, filterEndDate, filterStaff, filterStartDate, filterUserEmail, visibleAppointments]);

	function clearFilters() {
		setFilterStartDate("");
		setFilterEndDate("");
		setFilterAppointmentId("");
		setFilterAppointmentType("");
		setFilterUserEmail("");
		setFilterStaff("");
	}

	async function deleteAppt(appointmentID: number) {
		try {
			setPageError("");
			await deleteAppointment(appointmentID);
			const data = await getAppointments();
			setAppointments(data);
		} catch (err) {
			setPageError(errMsg(err));
		}
	}

	return (
		<div className="appointmentsPage">
			<div className="appointmentsHeader">
				<button type="button" className="pageHomeBtn" onClick={() => navigate("/")}>
					← Home
				</button>
				<h1>View All Appointments</h1>
			</div>

			{pageError && <p className="appointmentsError">{pageError}</p>}
			{loading && <p className="appointmentsLoading">Loading...</p>}

			<div className="appointmentsFiltersShell">
				<div className="appointmentsFiltersGrid">
					<div className="appointmentsFilterField">
						<label htmlFor="filterStartDate">Start Date</label>
						<input id="filterStartDate" type="date" value={filterStartDate} onChange={(e) => setFilterStartDate(e.target.value)} />
					</div>

					<div className="appointmentsFilterField">
						<label htmlFor="filterEndDate">End Date</label>
						<input id="filterEndDate" type="date" value={filterEndDate} onChange={(e) => setFilterEndDate(e.target.value)} />
					</div>

					<div className="appointmentsFilterField">
						<label htmlFor="filterAppointmentId">Appt. ID</label>
						<input
							id="filterAppointmentId"
							type="text"
							placeholder="Type an appointment ID"
							value={filterAppointmentId}
							onChange={(e) => setFilterAppointmentId(e.target.value)}
						/>
					</div>

					<div className="appointmentsFilterField">
						<label htmlFor="filterAppointmentType">Appt. Type</label>
						<input
							id="filterAppointmentType"
							type="text"
							placeholder="Type an appointment type"
							value={filterAppointmentType}
							onChange={(e) => setFilterAppointmentType(e.target.value)}
						/>
					</div>

					<div className="appointmentsFilterField">
						<label htmlFor="filterUserEmail">User Email</label>
						<input
							id="filterUserEmail"
							type="text"
							placeholder="Type part of an email"
							value={filterUserEmail}
							onChange={(e) => setFilterUserEmail(e.target.value)}
						/>
					</div>

					<div className="appointmentsFilterField appointmentsFilterFieldWide">
						<label htmlFor="filterStaff">Staff</label>
						<input
							id="filterStaff"
							type="text"
							placeholder="Type staff ID, first name, last name, or full name. Use commas for multiple"
							value={filterStaff}
							onChange={(e) => setFilterStaff(e.target.value)}
						/>
					</div>
				</div>

				<div className="appointmentsFiltersActions">
					<button type="button" className="appointmentsClearBtn" onClick={clearFilters}>
						Clear Filters
					</button>
					<div className="appointmentsFilterCount">Showing {filteredAppointments.length} appointment{filteredAppointments.length === 1 ? "" : "s"}</div>
				</div>
			</div>

			<div className="appointmentsShell">
				<table className="appointments-table">
					<thead>
						<tr>
							<th>Start</th>
							<th>End</th>
							<th>Appt. ID</th>
							<th>Type</th>
							<th>User Email</th>
							<th>Assigned Staff</th>
							<th>Room</th>
							<th>Equipment Used</th>
							<th>Action</th>
						</tr>
					</thead>

					<tbody>
						{filteredAppointments.map((a) => {
							const endObj = a.endDateTime
								? a.endDateTime
								: new Date(parseMySqlDateTime(a.date).getTime() + Number(a.durationMinutes || 0) * 60000).toISOString();

							return (
								<tr key={a.appointmentID}>
									<td>{formatDateTimeNoSeconds(a.date)}</td>
									<td>{formatDateTimeNoSeconds(String(endObj).replace("T", " "))}</td>
									<td>{a.appointmentID}</td>
									<td>{formatReason(a.reasonKey)}</td>
									<td>{a.userEmail || "—"}</td>
									<td className="staffCell">{a.assignedStaffSummary || "—"}</td>
									<td className="roomCell">
										<div>{a.roomNumber ?? "—"}</div>
										<div className="cellSubText">{a.roomType || "—"}</div>
									</td>
									<td className="equipmentCell">{a.equipmentUsed || "—"}</td>
									<td>
										<button
											onClick={() => deleteAppt(a.appointmentID)}
											className="btn danger appt-trash"
											aria-label="Delete appointment"
											title="Delete"
										>
											<img src={trashIcon} alt="" className="trash-icon" />
											<p>Delete</p>
										</button>
									</td>
								</tr>
							);
						})}

						{!loading && filteredAppointments.length === 0 && (
							<tr>
								<td colSpan={9}>No appointments found.</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</div>
	);
}
