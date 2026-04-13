import { useEffect, useMemo, useState } from "react";
import {
	getMyStaffProfile,
	getMyStaffAvailability,
	saveMyStaffAvailability,
	getMyStaffAppointments,
	getMyStaffNotifications,
	markMyStaffNotificationRead,
	cancelMyStaffAppointment,
	type MyStaffProfile,
	type StaffAppointment,
	type StaffNotification,
} from "../../api/staff";

import "../../styles/staffDashboard.css";

const DEV_BYPASS_AUTH = false;

type AvailabilityDay = {
	day: string;
	dayOfWeek: number;
	enabled: boolean;
	startTime: string;
	endTime: string;
};

type TimeOption = {
	value: string;
	label: string;
};

const MOCK_STAFF_PROFILE: MyStaffProfile = {
	userID: 1,
	staffID: 1,
	staffNumber: "S1001",
	legalFirstName: "Demo",
	legalLastName: "Staff",
	positionTitle: "Veterinary Assistant",
	email: "demo.staff@vetclinic.com",
	phone: "555-123-4567",
	roleKeys: ["XRAY_TECH", "GP_VET"],
};

const INITIAL_AVAILABILITY: AvailabilityDay[] = [
	{ day: "Monday", dayOfWeek: 1, enabled: false, startTime: "09:00:00", endTime: "17:00:00" },
	{ day: "Tuesday", dayOfWeek: 2, enabled: false, startTime: "09:00:00", endTime: "17:00:00" },
	{ day: "Wednesday", dayOfWeek: 3, enabled: false, startTime: "09:00:00", endTime: "17:00:00" },
	{ day: "Thursday", dayOfWeek: 4, enabled: false, startTime: "09:00:00", endTime: "17:00:00" },
	{ day: "Friday", dayOfWeek: 5, enabled: false, startTime: "09:00:00", endTime: "17:00:00" },
	{ day: "Saturday", dayOfWeek: 6, enabled: false, startTime: "09:00:00", endTime: "17:00:00" },
	{ day: "Sunday", dayOfWeek: 7, enabled: false, startTime: "09:00:00", endTime: "17:00:00" },
];

function generateTimeOptions(): TimeOption[] {
	const options: TimeOption[] = [];

	for (let hour = 9; hour <= 17; hour++) {
		for (let minute = 0; minute < 60; minute += 15) {
			if (hour === 17 && minute > 0) break;

			const hour24 = String(hour).padStart(2, "0");
			const minuteText = String(minute).padStart(2, "0");
			const value = `${hour24}:${minuteText}:00`;

			const hour12 = hour === 12 ? 12 : hour % 12 === 0 ? 12 : hour % 12;
			const ampm = hour < 12 ? "AM" : "PM";
			const label = `${hour12}:${minuteText} ${ampm}`;

			options.push({ value, label });
		}
	}

	return options;
}

const TIME_OPTIONS = generateTimeOptions();
const START_TIME_OPTIONS = TIME_OPTIONS.filter((option) => option.value < "17:00:00");

function getEndTimeOptions(startTime: string): TimeOption[] {
	const startIndex = TIME_OPTIONS.findIndex((option) => option.value === startTime);
	if (startIndex === -1) return TIME_OPTIONS;
	return TIME_OPTIONS.slice(startIndex + 1);
}

function appointmentDateTimeValue(appointment: StaffAppointment) {
	const raw = String(appointment.appointmentDateTime || "").trim();
	if (!raw) return new Date(NaN).getTime();
	return new Date(raw.replace(" ", "T")).getTime();
}

function formatReasonLabel(reasonKey: string) {
	return String(reasonKey || "").replaceAll("_", " ");
}

function startOfTodayMs() {
	const now = new Date();
	return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function endOfTodayMs() {
	const now = new Date();
	return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();
}

function dateStringToMs(dateText: string, useEndOfDay: boolean) {
	if (!dateText) return null;

	const parts = dateText.split("-");
	if (parts.length !== 3) return null;

	const year = Number(parts[0]);
	const month = Number(parts[1]) - 1;
	const day = Number(parts[2]);

	if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
		return null;
	}

	if (useEndOfDay) return new Date(year, month, day, 23, 59, 59, 999).getTime();
	return new Date(year, month, day, 0, 0, 0, 0).getTime();
}

function appointmentMatchesRole(appointment: StaffAppointment, roleFilter: string) {
	if (!roleFilter) return true;
	return String(appointment.assignedRoleKey || "").toUpperCase() === roleFilter.toUpperCase();
}

function formatNotificationTime(createdAt: string) {
	const raw = String(createdAt || "").trim();
	if (!raw) return "";

	const dt = new Date(raw.replace(" ", "T"));
	if (Number.isNaN(dt.getTime())) return raw;

	return dt.toLocaleString();
}

function getFriendlyAvailabilityMessage(error: unknown) {
	const rawMessage = error instanceof Error ? error.message : "";
	const normalizedMessage = rawMessage.toLowerCase();

	if (
		normalizedMessage.includes("availability conflicts with future appointments") ||
		normalizedMessage.includes("conflict with an assigned future appointment") ||
		normalizedMessage.includes('"message":"forbidden"') ||
		normalizedMessage.includes("forbidden")
	) {
		return "Cannot edit schedule because it conflicts with your future existing appointments.";
	}

	return error instanceof Error ? error.message : "Failed to save availability";
}

function getFriendlyCancelMessage(error: unknown) {
	const rawMessage = error instanceof Error ? error.message : "";
	const normalizedMessage = rawMessage.toLowerCase();

	if (normalizedMessage.includes("reason")) {
		return "A cancellation reason is required.";
	}

	if (normalizedMessage.includes("own assigned appointments")) {
		return "You can only cancel appointments assigned to you.";
	}

	if (normalizedMessage.includes("past appointments")) {
		return "Past appointments cannot be canceled.";
	}

	if (normalizedMessage.includes("already canceled")) {
		return "This appointment was already canceled.";
	}

	return error instanceof Error ? error.message : "Failed to cancel appointment";
}

export default function StaffDashboard() {
	const [profile, setProfile] = useState<MyStaffProfile | null>(null);
	const [loading, setLoading] = useState(true);
	const [pageError, setPageError] = useState("");
	const [availability, setAvailability] = useState<AvailabilityDay[]>(INITIAL_AVAILABILITY);
	const [availabilityMessage, setAvailabilityMessage] = useState("");
	const [appointments, setAppointments] = useState<StaffAppointment[]>([]);
	const [notifications, setNotifications] = useState<StaffNotification[]>([]);
	const [notificationMessage, setNotificationMessage] = useState("");
	const [markingNotificationID, setMarkingNotificationID] = useState<number | null>(null);
	const [appointmentMessage, setAppointmentMessage] = useState("");
	const [cancelingAppointmentID, setCancelingAppointmentID] = useState<number | null>(null);

	const [todayRoleFilter, setTodayRoleFilter] = useState("");
	const [futureRoleFilter, setFutureRoleFilter] = useState("");
	const [futureStartDate, setFutureStartDate] = useState("");
	const [futureEndDate, setFutureEndDate] = useState("");

	useEffect(() => {
		let cancelled = false;

		async function loadDashboard() {
			try {
				setLoading(true);
				setPageError("");

				if (DEV_BYPASS_AUTH) {
					if (!cancelled) {
						setProfile(MOCK_STAFF_PROFILE);
						setAppointments([]);
						setNotifications([]);
						setAvailability(INITIAL_AVAILABILITY);
					}
					return;
				}

				const [profileData, availabilityData, appointmentsData, notificationsData] = await Promise.all([
					getMyStaffProfile(),
					getMyStaffAvailability(),
					getMyStaffAppointments(),
					getMyStaffNotifications(),
				]);

				if (!cancelled) {
					setProfile(profileData);
					setAppointments(appointmentsData);
					setNotifications(notificationsData);

					const mappedAvailability = INITIAL_AVAILABILITY.map((day) => {
						const savedDay = availabilityData.find((item) => item.dayOfWeek === day.dayOfWeek);
						if (!savedDay) return day;

						return {
							...day,
							enabled: true,
							startTime: savedDay.startTime,
							endTime: savedDay.endTime,
						};
					});

					setAvailability(mappedAvailability);
				}
			} catch (err) {
				if (!cancelled) {
					setPageError(err instanceof Error ? err.message : "Failed to load staff dashboard data");
				}
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		}

		loadDashboard();

		return () => {
			cancelled = true;
		};
	}, []);

	const roleOptions = useMemo(() => {
		const uniqueRoles = [
			...new Set(
				appointments
					.map((appointment) => String(appointment.assignedRoleKey || "").trim())
					.filter(Boolean)
			),
		];

		return uniqueRoles.sort((a, b) => a.localeCompare(b));
	}, [appointments]);

	const todayAppointments = useMemo(() => {
		const startToday = startOfTodayMs();
		const endToday = endOfTodayMs();

		return appointments
			.filter((appointment) => {
				const appointmentMs = appointmentDateTimeValue(appointment);
				if (!Number.isFinite(appointmentMs)) return false;
				if (appointmentMs < startToday || appointmentMs > endToday) return false;
				return appointmentMatchesRole(appointment, todayRoleFilter);
			})
			.sort((a, b) => appointmentDateTimeValue(a) - appointmentDateTimeValue(b));
	}, [appointments, todayRoleFilter]);

	const futureAppointments = useMemo(() => {
		const endToday = endOfTodayMs();
		const filterStartMs = dateStringToMs(futureStartDate, false);
		const filterEndMs = dateStringToMs(futureEndDate, true);

		return appointments
			.filter((appointment) => {
				const appointmentMs = appointmentDateTimeValue(appointment);
				if (!Number.isFinite(appointmentMs)) return false;
				if (appointmentMs <= endToday) return false;
				if (!appointmentMatchesRole(appointment, futureRoleFilter)) return false;
				if (filterStartMs !== null && appointmentMs < filterStartMs) return false;
				if (filterEndMs !== null && appointmentMs > filterEndMs) return false;
				return true;
			})
			.sort((a, b) => appointmentDateTimeValue(a) - appointmentDateTimeValue(b));
	}, [appointments, futureRoleFilter, futureStartDate, futureEndDate]);

	function handleAvailabilityToggle(index: number) {
		setAvailability((prev) =>
			prev.map((item, i) => (i === index ? { ...item, enabled: !item.enabled } : item))
		);
	}

	function handleTimeChange(index: number, field: "startTime" | "endTime", value: string) {
		setAvailability((prev) =>
			prev.map((item, i) => {
				if (i !== index) return item;

				const updatedItem = { ...item, [field]: value };

				if (field === "startTime" && updatedItem.endTime <= value) {
					const validEndOptions = getEndTimeOptions(value);
					updatedItem.endTime = validEndOptions.length > 0 ? validEndOptions[0].value : value;
				}

				return updatedItem;
			})
		);
	}

	async function handleSaveAvailability() {
		setAvailabilityMessage("");

		const enabledDays = availability.filter((day) => day.enabled);

		if (enabledDays.length === 0) {
			setAvailabilityMessage("Please select at least one available day");
			return;
		}

		for (const day of enabledDays) {
			if (day.startTime >= day.endTime) {
				setAvailabilityMessage(`End time must be later than start time for ${day.day}`);
				return;
			}
		}

		const payload = enabledDays.map((day) => ({
			dayOfWeek: day.dayOfWeek,
			startTime: day.startTime,
			endTime: day.endTime,
		}));

		try {
			const result = await saveMyStaffAvailability(payload);
			setAvailabilityMessage(result.message || "Availability saved successfully");
		} catch (err) {
			setAvailabilityMessage(getFriendlyAvailabilityMessage(err));
		}
	}

	async function handleDismissNotification(notificationID: number) {
		try {
			setNotificationMessage("");
			setMarkingNotificationID(notificationID);

			await markMyStaffNotificationRead(notificationID);

			setNotifications((prev) => prev.filter((note) => note.notificationID !== notificationID));
			setNotificationMessage("Notification dismissed");
		} catch (err) {
			setNotificationMessage(err instanceof Error ? err.message : "Failed to dismiss notification");
		} finally {
			setMarkingNotificationID(null);
		}
	}

	async function handleCancelAppointment(appointmentID: number) {
		const reason = window.prompt("Please enter the cancellation reason:");

		if (reason === null) return;

		const trimmedReason = reason.trim();
		if (!trimmedReason) {
			setAppointmentMessage("A cancellation reason is required.");
			return;
		}

		try {
			setAppointmentMessage("");
			setCancelingAppointmentID(appointmentID);

			await cancelMyStaffAppointment(appointmentID, {
				cancellationReason: trimmedReason,
			});

			const updatedAppointments = await getMyStaffAppointments();
			setAppointments(updatedAppointments);
			setAppointmentMessage("Appointment canceled successfully.");
		} catch (err) {
			setAppointmentMessage(getFriendlyCancelMessage(err));
		} finally {
			setCancelingAppointmentID(null);
		}
	}

	function clearFutureFilters() {
		setFutureRoleFilter("");
		setFutureStartDate("");
		setFutureEndDate("");
	}

	return (
		<div className="staffDashboardPage">
			<h1 className="staffDashboardTitle">Staff Dashboard</h1>

			{loading && <p>Loading...</p>}
			{pageError && <div className="staffDashboardError">{pageError}</div>}

			{profile && (
				<div className="staffDashboardGrid">
					<section className="staffDashboardCard">
						<h2>Staff Info</h2>

						<div className="staffDashboardInfoGrid">
							<div className="staffDashboardField">
								<label className="staffDashboardLabel">Staff Number</label>
								<div className="staffDashboardValue">{profile.staffNumber}</div>
							</div>

							<div className="staffDashboardField">
								<label className="staffDashboardLabel">Position Title</label>
								<div className="staffDashboardValue">{profile.positionTitle}</div>
							</div>

							<div className="staffDashboardField">
								<label className="staffDashboardLabel">First Name</label>
								<div className="staffDashboardValue">{profile.legalFirstName}</div>
							</div>

							<div className="staffDashboardField">
								<label className="staffDashboardLabel">Last Name</label>
								<div className="staffDashboardValue">{profile.legalLastName}</div>
							</div>

							<div className="staffDashboardField staffDashboardFieldWide">
								<label className="staffDashboardLabel">Email</label>
								<div className="staffDashboardValue">{profile.email}</div>
							</div>

							<div className="staffDashboardField">
								<label className="staffDashboardLabel">Phone</label>
								<div className="staffDashboardValue">{profile.phone || "N/A"}</div>
							</div>

							<div className="staffDashboardField">
								<label className="staffDashboardLabel">Roles</label>
								<div className="staffDashboardValue">
									{profile.roleKeys.length > 0 ? profile.roleKeys.join(", ") : "None"}
								</div>
							</div>
						</div>
					</section>

					<section className="staffDashboardCard">
						<h2>Availability</h2>
						<p className="availabilitySubtext">Select the days and times you are available to work</p>

						<div className="availabilityList">
							{availability.map((item, index) => (
								<div className="availabilityRow" key={item.day}>
									<label className="availabilityDay">
										<input
											type="checkbox"
											checked={item.enabled}
											onChange={() => handleAvailabilityToggle(index)}
										/>
										<span>{item.day}</span>
									</label>

									<div className="availabilityTimes">
										<select
											value={item.startTime}
											disabled={!item.enabled}
											onChange={(e) => handleTimeChange(index, "startTime", e.target.value)}
										>
											{START_TIME_OPTIONS.map((option) => (
												<option key={option.value} value={option.value}>
													{option.label}
												</option>
											))}
										</select>

										<span>to</span>

										<select
											value={item.endTime}
											disabled={!item.enabled}
											onChange={(e) => handleTimeChange(index, "endTime", e.target.value)}
										>
											{getEndTimeOptions(item.startTime).map((option) => (
												<option key={option.value} value={option.value}>
													{option.label}
												</option>
											))}
										</select>
									</div>
								</div>
							))}
						</div>

						<div className="staffDashboardActions">
							<button className="staffDashboardPrimaryBtn" onClick={handleSaveAvailability}>
								Save Availability
							</button>
						</div>

						{availabilityMessage && <div className="staffDashboardMessage">{availabilityMessage}</div>}
					</section>

					<section className="staffDashboardCard">
						<h2>Today's Appointments</h2>

						<div className="staffFilterPanel">
							<div className="staffFilterField">
								<label className="staffDashboardLabel">Assigned Role</label>
								<select
									className="staffDashboardInput"
									value={todayRoleFilter}
									onChange={(e) => setTodayRoleFilter(e.target.value)}
								>
									<option value="">All Roles</option>
									{roleOptions.map((roleKey) => (
										<option key={roleKey} value={roleKey}>
											{roleKey}
										</option>
									))}
								</select>
							</div>
						</div>

						{todayAppointments.length === 0 ? (
							<p>No appointments for today.</p>
						) : (
							<ul className="staffDashboardList">
								{todayAppointments.map((appt) => (
									<li className="staffDashboardListItem" key={appt.appointmentID}>
										<div>
											<b>{appt.petName}</b> — {formatReasonLabel(appt.service)}
										</div>
										<div>
											{appt.appointmentDate} @ {appt.appointmentTime}
										</div>
										<div>Assigned Role: {appt.assignedRoleKey}</div>
									</li>
								))}
							</ul>
						)}
					</section>

					<section className="staffDashboardCard">
						<h2>Future Appointments</h2>

						<div className="staffFilterPanel">
							<div className="staffFilterField">
								<label className="staffDashboardLabel">Assigned Role</label>
								<select
									className="staffDashboardInput"
									value={futureRoleFilter}
									onChange={(e) => setFutureRoleFilter(e.target.value)}
								>
									<option value="">All Roles</option>
									{roleOptions.map((roleKey) => (
										<option key={roleKey} value={roleKey}>
											{roleKey}
										</option>
									))}
								</select>
							</div>

							<div className="staffFilterField">
								<label className="staffDashboardLabel">Start Date</label>
								<input
									className="staffDashboardInput"
									type="date"
									value={futureStartDate}
									onChange={(e) => setFutureStartDate(e.target.value)}
								/>
							</div>

							<div className="staffFilterField">
								<label className="staffDashboardLabel">End Date</label>
								<input
									className="staffDashboardInput"
									type="date"
									value={futureEndDate}
									onChange={(e) => setFutureEndDate(e.target.value)}
								/>
							</div>

							<div className="staffFilterButtonRow">
								<button
									type="button"
									className="staffDashboardSecondaryBtn"
									onClick={clearFutureFilters}
								>
									Clear Future Filters
								</button>
							</div>
						</div>

						{appointmentMessage && <div className="staffDashboardMessage">{appointmentMessage}</div>}

						{futureAppointments.length === 0 ? (
							<p>No future appointments.</p>
						) : (
							<ul className="staffDashboardList">
								{futureAppointments.map((appt) => (
									<li className="staffDashboardListItem" key={appt.appointmentID}>
										<div>
											<b>{appt.petName}</b> — {formatReasonLabel(appt.service)}
										</div>
										<div>
											{appt.appointmentDate} @ {appt.appointmentTime}
										</div>
										<div>Assigned Role: {appt.assignedRoleKey}</div>

										<div className="staffDashboardActions">
											<button
												type="button"
												className="staffDashboardSecondaryBtn"
												onClick={() => handleCancelAppointment(appt.appointmentID)}
												disabled={cancelingAppointmentID === appt.appointmentID}
											>
												{cancelingAppointmentID === appt.appointmentID ? "Canceling..." : "Cancel Appointment"}
											</button>
										</div>
									</li>
								))}
							</ul>
						)}
					</section>

					<section className="staffDashboardCard">
						<h2>Notifications</h2>

						{notificationMessage ? (
							<div className="staffDashboardMessage">{notificationMessage}</div>
						) : null}

						{notifications.length === 0 ? (
							<p>No notifications right now.</p>
						) : (
							<ul className="staffDashboardList">
								{notifications.map((note) => (
									<li className="staffDashboardListItem staffNotificationItem" key={note.notificationID}>
										<div className="staffNotificationTitle">{note.title}</div>
										<div className="staffNotificationMessage">{note.message}</div>
										<div className="staffNotificationMeta">{formatNotificationTime(note.createdAt)}</div>

										<div className="staffNotificationActions">
											<button
												type="button"
												className="staffDashboardSecondaryBtn"
												onClick={() => handleDismissNotification(note.notificationID)}
												disabled={markingNotificationID === note.notificationID}
											>
												{markingNotificationID === note.notificationID ? "Dismissing..." : "Mark Read"}
											</button>
										</div>
									</li>
								))}
							</ul>
						)}
					</section>
				</div>
			)}
		</div>
	);
}