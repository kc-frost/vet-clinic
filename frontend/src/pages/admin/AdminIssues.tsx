import { useEffect, useMemo, useState } from "react";
import SlotCalendar from "../../components/calendar/SlotCalendar";
import {
	cancelUnderReviewAppointment,
	getUnderReviewAppointments,
	getUnderReviewRescheduleOptions,
	rescheduleUnderReviewAppointment,
} from "../../api/appointmentIssues";
import type { UnderReviewAppointment, UnderReviewRescheduleSlot } from "../../types/appointmentIssue";
import "../../styles/adminIssues.css";

function formatReason(reasonKey: string) {
	// Make reason keys readable without needing separate display text from the backend
	return String(reasonKey || "").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDateTime(value: string) {
	// Show issue queue times in a readable local format
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

function getDateOnly(value: string) {
	// Pull just the date part so the calendar can start browsing from that day
	const raw = String(value || "");
	if (!raw) return "";
	return raw.split(" ")[0] || raw.slice(0, 10);
}

function buildOwnerPetLabel(appointment: UnderReviewAppointment) {
	// Keep the main card title short but still identifying
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

function getFriendlyRescheduleMessage(error: unknown) {
	const rawMessage = error instanceof Error ? error.message : "";
	const normalizedMessage = rawMessage.toLowerCase();

	if (normalizedMessage.includes("valid appointmentdate")) return "Pick a valid slot before rescheduling";
	if (normalizedMessage.includes("staff")) return rawMessage || "No staff are available for that time";
	if (normalizedMessage.includes("room")) return rawMessage || "No room is available for that time";
	if (normalizedMessage.includes("capacity")) return rawMessage || "That slot no longer has enough required resources";
	if (normalizedMessage.includes("overlapping appointment")) return rawMessage || "That pet already has an overlapping appointment";

	return error instanceof Error ? error.message : "Failed to reschedule under-review appointment";
}

export default function AdminIssues() {
	const [appointments, setAppointments] = useState<UnderReviewAppointment[]>([]);
	const [loading, setLoading] = useState(true);
	const [pageMessage, setPageMessage] = useState("");
	const [cancelReasonByAppointmentID, setCancelReasonByAppointmentID] = useState<Record<number, string>>({});
	const [confirmingCancelAppointmentID, setConfirmingCancelAppointmentID] = useState<number | null>(null);
	const [cancelingAppointmentID, setCancelingAppointmentID] = useState<number | null>(null);

	const [rescheduleAppointmentID, setRescheduleAppointmentID] = useState<number | null>(null);
	const [rescheduleSlots, setRescheduleSlots] = useState<UnderReviewRescheduleSlot[]>([]);
	const [rescheduleDate, setRescheduleDate] = useState("");
	const [rescheduleStartTime, setRescheduleStartTime] = useState("");
	const [rescheduleSelectedSlotId, setRescheduleSelectedSlotId] = useState("");
	const [rescheduleLoading, setRescheduleLoading] = useState(false);
	const [rescheduleBusy, setRescheduleBusy] = useState(false);
	const [rescheduleError, setRescheduleError] = useState("");

	async function loadAppointments() {
		try {
			setLoading(true);
			setPageMessage("");
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
		// Keep the queue ordered by appointment start time
		return [...appointments].sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime());
	}, [appointments]);

	function handleReasonChange(appointmentID: number, nextValue: string) {
		setCancelReasonByAppointmentID((prev) => ({ ...prev, [appointmentID]: nextValue }));
	}

	function beginCancelConfirm(appointmentID: number) {
		const cancellationReason = String(cancelReasonByAppointmentID[appointmentID] || "").trim();

		// Do not let the admin move into confirm state without a reason
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

			// Remove the appointment locally so the queue updates right away
			setAppointments((prev) => prev.filter((appointment) => appointment.appointmentID !== appointmentID));

			// Clear the saved textarea value for the appointment we just removed
			setCancelReasonByAppointmentID((prev) => {
				const nextMap = { ...prev };
				delete nextMap[appointmentID];
				return nextMap;
			});

			if (rescheduleAppointmentID === appointmentID) clearRescheduleState();
			setConfirmingCancelAppointmentID(null);
			setPageMessage("Under-review appointment canceled");
		} catch (err) {
			setPageMessage(getFriendlyCancelMessage(err));
		} finally {
			setCancelingAppointmentID(null);
		}
	}

	function clearRescheduleState() {
		// Fully reset the reschedule panel state
		setRescheduleAppointmentID(null);
		setRescheduleSlots([]);
		setRescheduleDate("");
		setRescheduleStartTime("");
		setRescheduleSelectedSlotId("");
		setRescheduleError("");
	}

	async function loadRescheduleOptions(appointment: UnderReviewAppointment, startDate: string) {
		try {
			setRescheduleLoading(true);
			setRescheduleError("");

			// Load a wider slot window here so the calendar can browse normally
			const response = await getUnderReviewRescheduleOptions(appointment.appointmentID, {
				startDate,
				days: 90,
			});

			setRescheduleSlots(response.slots);
		} catch (err) {
			setRescheduleError(getFriendlyRescheduleMessage(err));
			setRescheduleSlots([]);
		} finally {
			setRescheduleLoading(false);
		}
	}

	async function beginReschedule(appointment: UnderReviewAppointment) {
		const startDate = getDateOnly(appointment.startAt);

		// Open the reschedule area for this card and load fresh slot options
		setPageMessage("");
		setRescheduleAppointmentID(appointment.appointmentID);
		setRescheduleDate("");
		setRescheduleStartTime("");
		setRescheduleSelectedSlotId("");
		await loadRescheduleOptions(appointment, startDate);
	}

	function handleBrowseDateChange(nextDate: string) {
		// Browsing another date should only clear the old picked slot
		setRescheduleDate(nextDate);
		setRescheduleStartTime("");
		setRescheduleSelectedSlotId("");
		setRescheduleError("");
	}

	function handleSelectRescheduleSlot(value: { date: string; startTime: string; slotId?: string }) {
		setRescheduleDate(value.date);
		setRescheduleStartTime(value.startTime);
		setRescheduleSelectedSlotId(String(value.slotId || ""));
		setRescheduleError("");
	}

	async function handleConfirmReschedule() {
		if (!rescheduleAppointmentID || !rescheduleDate || !rescheduleStartTime) {
			setRescheduleError("Pick a valid slot before rescheduling");
			return;
		}

		try {
			setRescheduleBusy(true);
			setRescheduleError("");
			setPageMessage("");

			await rescheduleUnderReviewAppointment(rescheduleAppointmentID, {
				appointmentDate: rescheduleDate,
				startTime: rescheduleStartTime,
				slotId: rescheduleSelectedSlotId || undefined,
			});

			// Remove it from the queue once the reschedule succeeds
			setAppointments((prev) => prev.filter((appointment) => appointment.appointmentID !== rescheduleAppointmentID));
			clearRescheduleState();
			setPageMessage("Under-review appointment rescheduled");
		} catch (err) {
			setRescheduleError(getFriendlyRescheduleMessage(err));
		} finally {
			setRescheduleBusy(false);
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
						const isConfirmingCancel = confirmingCancelAppointmentID === appointmentID;
						const isCanceling = cancelingAppointmentID === appointmentID;
						const isRescheduling = rescheduleAppointmentID === appointmentID;

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
									<div className="adminIssueButtonRow">
										{isRescheduling ? (
											<button className="adminIssueSecondaryBtn" type="button" onClick={clearRescheduleState} disabled={rescheduleBusy}>
												Back
											</button>
										) : (
											<button className="adminIssuePrimaryBtn" type="button" onClick={() => beginReschedule(appointment)}>
												Reschedule
											</button>
										)}

										{isConfirmingCancel ? (
											<>
												<button className="adminIssueDangerBtn" type="button" onClick={() => handleConfirmCancel(appointmentID)} disabled={isCanceling}>
													{isCanceling ? "Canceling..." : "Confirm Cancel"}
												</button>

												<button className="adminIssueSecondaryBtn" type="button" onClick={clearCancelConfirm} disabled={isCanceling}>
													Back
												</button>
											</>
										) : (
											<button className="adminIssueDangerBtn" type="button" onClick={() => beginCancelConfirm(appointmentID)} disabled={rescheduleBusy && isRescheduling}>
												Cancel Appointment
											</button>
										)}
									</div>

									{isRescheduling ? (
										<div className="adminIssueRescheduleWrap">
											<div className="adminIssueRescheduleHint">
												Choose a new date and time for appointment #{appointmentID}. The appointment keeps the same reason and stays the same appointment record.
											</div>

											<SlotCalendar
												slots={rescheduleSlots}
												value={
													rescheduleDate && rescheduleStartTime
														? {
															date: rescheduleDate,
															startTime: rescheduleStartTime,
															slotId: rescheduleSelectedSlotId || undefined,
														}
														: null
												}
												onSelectSlot={handleSelectRescheduleSlot}
												onBrowseDateChange={handleBrowseDateChange}
												isLoading={rescheduleLoading}
												errorText={rescheduleError}
											/>

											<div className="adminIssueButtonRow">
												<button className="adminIssuePrimaryBtn" type="button" onClick={handleConfirmReschedule} disabled={rescheduleBusy || !rescheduleDate || !rescheduleStartTime}>
													{rescheduleBusy ? "Rescheduling..." : "Confirm Reschedule"}
												</button>
											</div>
										</div>
									) : (
										<>
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
										</>
									)}
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}