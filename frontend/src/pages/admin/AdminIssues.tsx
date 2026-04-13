import { useEffect, useMemo, useState } from "react";
import { cancelUnderReviewAppointment, getUnderReviewAppointments } from "../../api/appointmentIssues";
import type { UnderReviewAppointment } from "../../types/appointmentIssue";
import "../../styles/adminIssues.css";

function formatReason(reasonKey: string) {
	// Keep reason labels readable without needing backend display text
	return String(reasonKey || "").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDateTime(value: string) {
	// Show a readable local datetime for the issue queue
	const dateValue = new Date(String(value || "").replace(" ", "T"));
	if (Number.isNaN(dateValue.getTime())) return String(value || "");
	return dateValue.toLocaleString([], {
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

function buildOwnerPetLabel(appointment: UnderReviewAppointment) {
	// Keep the title line short while still identifying the appointment
	const petName = String(appointment.petName || "").trim() || "Unknown Pet";
	const ownerName = String(appointment.ownerName || "").trim() || "Unknown Owner";
	return `${petName} with ${ownerName}`;
}

function getFriendlyCancelMessage(error: unknown) {
	const rawMessage = error instanceof Error ? error.message : "";
	const normalizedMessage = rawMessage.toLowerCase();

	if (normalizedMessage.includes("reason")) return "A cancellation reason is required";
	if (normalizedMessage.includes("already canceled")) return "That appointment was already canceled";
	if (normalizedMessage.includes("not found")) return "That under-review appointment was not found";

	return error instanceof Error ? error.message : "Failed to cancel under-review appointment";
}

export default function AdminIssues() {
	const [appointments, setAppointments] = useState<UnderReviewAppointment[]>([]);
	const [loading, setLoading] = useState(true);
	const [pageMessage, setPageMessage] = useState("");
	const [cancelReasonByAppointmentID, setCancelReasonByAppointmentID] = useState<Record<number, string>>({});
	const [confirmingCancelAppointmentID, setConfirmingCancelAppointmentID] = useState<number | null>(null);
	const [cancelingAppointmentID, setCancelingAppointmentID] = useState<number | null>(null);

	async function loadAppointments() {
		try {
			setLoading(true);
			const rows = await getUnderReviewAppointments();
			setAppointments(rows);
		} catch (err) {
			setPageMessage(err instanceof Error ? err.message : "Failed to load under-review appointments");
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		loadAppointments();
	}, []);

	const sortedAppointments = useMemo(() => {
		return [...appointments].sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime());
	}, [appointments]);

	function handleReasonChange(appointmentID: number, nextValue: string) {
		setCancelReasonByAppointmentID((prev) => ({ ...prev, [appointmentID]: nextValue }));
	}

	function beginCancelConfirm(appointmentID: number) {
		const cancellationReason = String(cancelReasonByAppointmentID[appointmentID] || "").trim();

		if (!cancellationReason) {
			setPageMessage("A cancellation reason is required");
			return;
		}

		setPageMessage("");
		setConfirmingCancelAppointmentID(appointmentID);
	}

	function clearCancelConfirm() {
		setConfirmingCancelAppointmentID(null);
	}

	async function handleConfirmCancel(appointmentID: number) {
		const cancellationReason = String(cancelReasonByAppointmentID[appointmentID] || "").trim();

		if (!cancellationReason) {
			setPageMessage("A cancellation reason is required");
			return;
		}

		try {
			setCancelingAppointmentID(appointmentID);
			setPageMessage("");

			await cancelUnderReviewAppointment(appointmentID, { cancellationReason });

			setAppointments((prev) => prev.filter((appointment) => appointment.appointmentID !== appointmentID));
			setCancelReasonByAppointmentID((prev) => {
				const nextMap = { ...prev };
				delete nextMap[appointmentID];
				return nextMap;
			});
			setConfirmingCancelAppointmentID(null);
			setPageMessage("Under-review appointment canceled");
		} catch (err) {
			setPageMessage(getFriendlyCancelMessage(err));
		} finally {
			setCancelingAppointmentID(null);
		}
	}

	return (
		<div className="adminIssuesPage">
			<div className="adminIssuesToolbar">
				<div>
					<h1>Issues / Review Queue</h1>
					<p>These are appointments that are under review and still need an admin decision</p>
				</div>

				<button className="adminIssueSecondaryBtn" type="button" onClick={loadAppointments}>
					Refresh
				</button>
			</div>

			{pageMessage ? <div className="adminIssuesMessage">{pageMessage}</div> : null}

			{loading ? (
				<div className="adminIssueEmpty">Loading under-review appointments...</div>
			) : sortedAppointments.length === 0 ? (
				<div className="adminIssueEmpty">There are no under-review appointments right now</div>
			) : (
				<div className="adminIssuesGrid">
					{sortedAppointments.map((appointment) => {
						const appointmentID = appointment.appointmentID;
						const cancelReason = cancelReasonByAppointmentID[appointmentID] || "";
						const isConfirming = confirmingCancelAppointmentID === appointmentID;
						const isCanceling = cancelingAppointmentID === appointmentID;

						return (
							<div className="adminIssueCard" key={appointmentID}>
								<div className="adminIssueHeader">
									<div className="adminIssueTitleBlock">
										<h2>{buildOwnerPetLabel(appointment)}</h2>
										<div className="adminIssueMeta">
											Appointment #{appointmentID} • {formatReason(appointment.reasonKey)}
										</div>
										<div className="adminIssueMeta">
											{formatDateTime(appointment.startAt)} to {formatDateTime(appointment.endAt)}
										</div>
										<div className="adminIssueMeta">
											Room: {appointment.roomNumber ?? "Unassigned"}
										</div>
									</div>
								</div>

								<div className="adminIssueSection">
									<strong>What is broken</strong>
									<div className="adminIssueChipRow">
										{appointment.issues.map((issue) => (
											<span className="adminIssueChip" key={issue.issueID}>
												{issue.label}
											</span>
										))}
									</div>
								</div>

								<div className="adminIssueSection">
									<strong>Assigned staff</strong>
									{appointment.assignedStaff.length === 0 ? (
										<div className="adminIssueMeta">No staff currently assigned</div>
									) : (
										<ul className="adminIssueStaffList">
											{appointment.assignedStaff.map((staffMember) => (
												<li key={`${appointmentID}-${staffMember.staffID}`}>
													{staffMember.name} • {staffMember.assignedRoleKey}
												</li>
											))}
										</ul>
									)}
								</div>

								<div className="adminIssueActionRow">
									<label htmlFor={`cancel-reason-${appointmentID}`}>
										<strong>Cancellation reason</strong>
									</label>
									<textarea
										id={`cancel-reason-${appointmentID}`}
										className="adminIssueTextarea"
										placeholder="Explain why this appointment is being canceled"
										value={cancelReason}
										onChange={(event) => handleReasonChange(appointmentID, event.target.value)}
									/>

									<div className="adminIssueButtonRow">
										<button className="adminIssuePrimaryBtn" type="button" disabled>
											Reschedule
										</button>

										{isConfirming ? (
											<>
												<button
													className="adminIssueDangerBtn"
													type="button"
													onClick={() => handleConfirmCancel(appointmentID)}
													disabled={isCanceling}
												>
													{isCanceling ? "Canceling..." : "Confirm Cancel"}
												</button>

												<button className="adminIssueSecondaryBtn" type="button" onClick={clearCancelConfirm} disabled={isCanceling}>
													Back
												</button>
											</>
										) : (
											<button className="adminIssueDangerBtn" type="button" onClick={() => beginCancelConfirm(appointmentID)}>
												Cancel Appointment
											</button>
										)}
									</div>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
