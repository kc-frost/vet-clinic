import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Appointment } from "../../types/appointment";
import { cancelAppointmentAsAdmin, getAppointments } from "../../api/appointments";
import "../../styles/appointments.css";

function errMsg(err: unknown): string {
	// Keep unknown thrown values from turning into ugly UI messages
	return err instanceof Error ? err.message : "Unknown error";
}

function parseMySqlDateTime(value: string) {
	// Convert MySQL-style datetime text into something the browser Date can read
	return new Date(String(value || "").replace(" ", "T"));
}

function formatReason(reasonKey: string) {
	// Turn reason keys like WELLNESS_EXAM into readable text for the page
	return String(reasonKey || "").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDateTimeNoSeconds(value: string) {
	// Display dates without seconds since the page does not need that level of detail
	const dateValue = parseMySqlDateTime(value);
	return dateValue.toLocaleString([], {
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

function getLocalDateOnlyText(value: string) {
	// Build a local YYYY-MM-DD value so date filtering lines up with the date inputs
	const dateValue = parseMySqlDateTime(value);
	const year = dateValue.getFullYear();
	const month = String(dateValue.getMonth() + 1).padStart(2, "0");
	const day = String(dateValue.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function parseStaffSearchEntries(raw: string) {
	// Support comma-separated staff search terms and ignore empty pieces
	return String(raw || "").split(",").map((part) => part.trim().toLowerCase()).filter(Boolean);
}

function formatCanceledByType(value: Appointment["canceledByType"]) {
	// Make backend cancel type values look cleaner in the table
	if (!value) return "—";
	return String(value).toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildCanceledBySummary(appointment: Appointment) {
	// Show the most useful canceled-by text depending on what data exists
	const name = String(appointment.canceledByName || "").trim();
	const userID = appointment.canceledByUserID;

	if (name && userID) return `${name} (#${userID})`;
	if (name) return name;
	if (userID) return `User #${userID}`;
	return "—";
}

function buildCountLabel(count: number, showCanceled: boolean) {
	// Keep the count text matched to the current mode
	if (showCanceled) return `Showing ${count} canceled appointment${count === 1 ? "" : "s"}`;
	return `Showing ${count} active appointment${count === 1 ? "" : "s"}`;
}

export default function ViewAppointments() {
	const navigate = useNavigate();
	const [loading, setLoading] = useState(false);
	const [pageError, setPageError] = useState("");
	const [appointments, setAppointments] = useState<Appointment[]>([]);
	const [showCanceled, setShowCanceled] = useState(false);
	const [cancelAppointmentID, setCancelAppointmentID] = useState<number | null>(null);
	const [cancelReason, setCancelReason] = useState("");
	const [cancelMessage, setCancelMessage] = useState("");
	const [cancelConfirmArmed, setCancelConfirmArmed] = useState(false);
	const [submittingCancel, setSubmittingCancel] = useState(false);
	const [filterStartDate, setFilterStartDate] = useState("");
	const [filterEndDate, setFilterEndDate] = useState("");
	const [filterAppointmentId, setFilterAppointmentId] = useState("");
	const [filterAppointmentType, setFilterAppointmentType] = useState("");
	const [filterUserEmail, setFilterUserEmail] = useState("");
	const [filterStaff, setFilterStaff] = useState("");

	useEffect(() => {
		let cancelled = false;

		async function loadAppointments() {
			setLoading(true);
			setPageError("");

			try {
				// Load either active or canceled appointments depending on the current toggle
				const data = await getAppointments({ includeCanceled: showCanceled });
				if (!cancelled) setAppointments(data);
			} catch (err) {
				if (!cancelled) setPageError(errMsg(err));
			} finally {
				if (!cancelled) setLoading(false);
			}
		}

		loadAppointments();

		// Stop state updates if the component unmounts before the request finishes
		return () => {
			cancelled = true;
		};
	}, [showCanceled]);

	const visibleAppointments = useMemo(() => {
		// In canceled mode, just show what came back from the API
		if (showCanceled) return [...appointments];

		const now = Date.now();

		// In active mode, keep only appointments that have not ended yet
		// and sort them by start time
		return [...appointments]
			.filter((appointment) => {
				const endDateTime = appointment.endDateTime
					? String(appointment.endDateTime)
					: new Date(parseMySqlDateTime(appointment.date).getTime() + Number(appointment.durationMinutes || 0) * 60000).toISOString();

				return new Date(String(endDateTime).replace(" ", "T")).getTime() > now;
			})
			.sort((left, right) => parseMySqlDateTime(left.date).getTime() - parseMySqlDateTime(right.date).getTime());
	}, [appointments, showCanceled]);

	const filteredAppointments = useMemo(() => {
		const appointmentIdQuery = filterAppointmentId.trim();
		const typeQuery = filterAppointmentType.trim().toLowerCase();
		const emailQuery = filterUserEmail.trim().toLowerCase();
		const staffQueries = parseStaffSearchEntries(filterStaff);

		return visibleAppointments.filter((appointment) => {
			const appointmentDateOnly = getLocalDateOnlyText(appointment.date);
			const formattedReason = formatReason(appointment.reasonKey).toLowerCase();
			const rawReason = String(appointment.reasonKey || "").toLowerCase();
			const userEmail = String(appointment.userEmail || "").toLowerCase();
			const assignedStaffSummary = String(appointment.assignedStaffSummary || "").toLowerCase();

			// Every active filter has to pass for the appointment to stay visible
			if (filterStartDate && appointmentDateOnly < filterStartDate) return false;
			if (filterEndDate && appointmentDateOnly > filterEndDate) return false;
			if (appointmentIdQuery && !String(appointment.appointmentID).includes(appointmentIdQuery)) return false;
			if (typeQuery && !rawReason.includes(typeQuery) && !formattedReason.includes(typeQuery)) return false;
			if (emailQuery && !userEmail.includes(emailQuery)) return false;

			// For staff search, every comma-separated token must appear in the staff summary
			if (staffQueries.length > 0 && !staffQueries.every((entry) => assignedStaffSummary.includes(entry))) return false;

			return true;
		});
	}, [filterAppointmentId, filterAppointmentType, filterEndDate, filterStaff, filterStartDate, filterUserEmail, visibleAppointments]);

	const selectedAppointment = useMemo(() => filteredAppointments.find((appointment) => appointment.appointmentID === cancelAppointmentID) || null, [cancelAppointmentID, filteredAppointments]);

	function clearFilters() {
		// Reset the whole filter bar back to its default state
		setFilterStartDate("");
		setFilterEndDate("");
		setFilterAppointmentId("");
		setFilterAppointmentType("");
		setFilterUserEmail("");
		setFilterStaff("");
	}

	function openCancelPanel(appointmentID: number) {
		// Open the admin cancel panel for one appointment and reset old form state
		setCancelAppointmentID(appointmentID);
		setCancelReason("");
		setCancelMessage("");
		setCancelConfirmArmed(false);
	}

	function closeCancelPanel() {
		// Fully close the cancel panel and clear its state
		setCancelAppointmentID(null);
		setCancelReason("");
		setCancelMessage("");
		setCancelConfirmArmed(false);
	}

	async function submitAdminCancel() {
		if (!selectedAppointment) return;

		const trimmedReason = cancelReason.trim();

		// Force the admin to enter a reason before canceling
		if (!trimmedReason) {
			setCancelMessage("A cancellation reason is required");
			return;
		}

		// Require a second click so canceling is harder to do by accident
		if (!cancelConfirmArmed) {
			setCancelConfirmArmed(true);
			setCancelMessage("Click confirm cancel appointment again if you want to finish canceling this appointment");
			return;
		}

		try {
			setSubmittingCancel(true);
			setPageError("");
			setCancelMessage("");

			await cancelAppointmentAsAdmin(selectedAppointment.appointmentID, { cancellationReason: trimmedReason });

			// Reload the list after canceling so the table stays in sync with the backend
			const refreshedAppointments = await getAppointments({ includeCanceled: showCanceled });
			setAppointments(refreshedAppointments);

			closeCancelPanel();
		} catch (err) {
			setCancelMessage(errMsg(err));
		} finally {
			setSubmittingCancel(false);
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
				<div className="appointmentsViewToggleRow">
					<button type="button" className={showCanceled ? "appointmentsToggleBtn" : "appointmentsToggleBtn appointmentsToggleBtnActive"} onClick={() => setShowCanceled(false)}>
						Active Appointments
					</button>
					<button type="button" className={showCanceled ? "appointmentsToggleBtn appointmentsToggleBtnActive" : "appointmentsToggleBtn"} onClick={() => setShowCanceled(true)}>
						Canceled Appointments
					</button>
				</div>

				<div className="appointmentsFiltersGrid">
					<div className="appointmentsFilterField">
						<label htmlFor="filterStartDate">Start Date</label>
						<input id="filterStartDate" type="date" value={filterStartDate} onChange={(event) => setFilterStartDate(event.target.value)} />
					</div>
					<div className="appointmentsFilterField">
						<label htmlFor="filterEndDate">End Date</label>
						<input id="filterEndDate" type="date" value={filterEndDate} onChange={(event) => setFilterEndDate(event.target.value)} />
					</div>
					<div className="appointmentsFilterField">
						<label htmlFor="filterAppointmentId">Appt. ID</label>
						<input id="filterAppointmentId" type="text" placeholder="Type an appointment ID" value={filterAppointmentId} onChange={(event) => setFilterAppointmentId(event.target.value)} />
					</div>
					<div className="appointmentsFilterField">
						<label htmlFor="filterAppointmentType">Appt. Type</label>
						<input id="filterAppointmentType" type="text" placeholder="Type an appointment type" value={filterAppointmentType} onChange={(event) => setFilterAppointmentType(event.target.value)} />
					</div>
					<div className="appointmentsFilterField">
						<label htmlFor="filterUserEmail">User Email</label>
						<input id="filterUserEmail" type="text" placeholder="Type part of an email" value={filterUserEmail} onChange={(event) => setFilterUserEmail(event.target.value)} />
					</div>
					<div className="appointmentsFilterField appointmentsFilterFieldWide">
						<label htmlFor="filterStaff">Staff</label>
						<input
							id="filterStaff"
							type="text"
							placeholder="Type staff ID, first name, last name, or full name. Use commas for multiple"
							value={filterStaff}
							onChange={(event) => setFilterStaff(event.target.value)}
						/>
					</div>
				</div>

				<div className="appointmentsFiltersActions">
					<button type="button" className="appointmentsClearBtn" onClick={clearFilters}>Clear Filters</button>
					<div className="appointmentsFilterCount">{buildCountLabel(filteredAppointments.length, showCanceled)}</div>
				</div>
			</div>

			{!showCanceled && selectedAppointment && (
				<div className="appointmentsCancelPanel">
					<h2>Cancel Appointment</h2>

					<div className="appointmentsCancelPanelDetails">
						<div><strong>Appt. ID:</strong> {selectedAppointment.appointmentID}</div>
						<div><strong>Type:</strong> {formatReason(selectedAppointment.reasonKey)}</div>
						<div><strong>User Email:</strong> {selectedAppointment.userEmail || "—"}</div>
						<div><strong>Pet:</strong> {selectedAppointment.petName || "—"}</div>
						<div><strong>Start:</strong> {formatDateTimeNoSeconds(selectedAppointment.date)}</div>
					</div>

					<label className="appointmentsCancelPanelLabel" htmlFor="cancelReason">Cancellation Reason</label>
					<textarea
						id="cancelReason"
						className="appointmentsCancelTextarea"
						value={cancelReason}
						onChange={(event) => {
							// Any edit to the reason resets the armed confirm state
							setCancelReason(event.target.value);
							setCancelConfirmArmed(false);
							setCancelMessage("");
						}}
						placeholder="Enter the reason for canceling this appointment"
					/>

					{cancelMessage && <div className="appointmentsCancelMessage">{cancelMessage}</div>}

					<div className="appointmentsCancelPanelActions">
						<button type="button" className="appointmentsClearBtn" onClick={closeCancelPanel} disabled={submittingCancel}>Close</button>
						<button type="button" className="appointmentsCancelBtn" onClick={submitAdminCancel} disabled={submittingCancel}>
							{submittingCancel ? "Canceling..." : cancelConfirmArmed ? "Confirm Cancel Appointment" : "Continue Cancel"}
						</button>
					</div>
				</div>
			)}

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
									{showCanceled ? (
										<>
											<th>Canceled By</th>
											<th>Cancel Type</th>
											<th>Cancel Reason</th>
											<th>Canceled At</th>
										</>
									) : (
										<>
											<th>Equipment Used</th>
											<th>Action</th>
										</>
									)}
								</tr>
							</thead>

					<tbody>
						{filteredAppointments.map((appointment) => {
							const endDateTime = appointment.endDateTime
								? String(appointment.endDateTime)
								: new Date(parseMySqlDateTime(appointment.date).getTime() + Number(appointment.durationMinutes || 0) * 60000).toISOString();

							return (
								<tr key={appointment.appointmentID}>
									<td>{formatDateTimeNoSeconds(appointment.date)}</td>
									<td>{formatDateTimeNoSeconds(String(endDateTime).replace("T", " "))}</td>
									<td>{appointment.appointmentID}</td>
									<td>{formatReason(appointment.reasonKey)}</td>
									<td>{appointment.userEmail || "—"}</td>
									<td className="staffCell">{appointment.assignedStaffSummary || "—"}</td>
									<td className="roomCell">
										<div>{appointment.roomNumber ?? "—"}</div>
										<div className="cellSubText">{appointment.roomType || "—"}</div>
									</td>
									{showCanceled ? (
										<>
											<td>{buildCanceledBySummary(appointment)}</td>
											<td>{formatCanceledByType(appointment.canceledByType)}</td>
											<td>{appointment.cancellationReason || "—"}</td>
											<td>{appointment.canceledAt ? formatDateTimeNoSeconds(appointment.canceledAt) : "—"}</td>
										</>
									) : (
										<>
											<td className="equipmentCell">{appointment.equipmentUsed || "—"}</td>
											<td>
												<button type="button" className="appointmentsCancelBtn appointmentsTableCancelBtn" onClick={() => openCancelPanel(appointment.appointmentID)}>
													Cancel Appointment
												</button>
											</td>
										</>
									)}
								</tr>
							);
						})}

						{!loading && filteredAppointments.length === 0 && (
							<tr>
								<td colSpan={showCanceled ? 11 : 9}>No appointments found.</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</div>
	);
}