import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deactivateUser, getAllUsers, type UserSummary } from "../../api/users";
import "../../styles/viewUsers.css";

type SearchField = "email" | "userID";
type RangeField = "userID" | "days_registered" | "total_reservations" | "past_reservations" | "upcoming_reservations";

function buildUserLabel(user: UserSummary) {
	const firstName = String(user.legalFirstName || "").trim();
	const lastName = String(user.legalLastName || "").trim();
	const fullName = `${firstName} ${lastName}`.trim();

	if (fullName) return `${fullName} (${user.email})`;
	return user.email;
}

function getFriendlyDeactivateError(error: unknown) {
	const rawMessage = error instanceof Error ? error.message : "";
	const normalizedMessage = rawMessage.toLowerCase();

	if (normalizedMessage.includes("admin accounts cannot be deactivated")) {
		return "Admin accounts cannot be removed from here";
	}

	if (normalizedMessage.includes("cannot deactivate your own account")) {
		return "You cannot remove your own account from here";
	}

	if (normalizedMessage.includes("not found")) {
		return "That user could not be found";
	}

	return error instanceof Error ? error.message : "Failed to remove user";
}

export default function ViewAllUsers() {
	const navigate = useNavigate();

	const [users, setUsers] = useState<UserSummary[]>([]);
	const [loading, setLoading] = useState(false);
	const [pageError, setPageError] = useState("");
	const [pageMessage, setPageMessage] = useState("");

	const [searchField, setSearchField] = useState<SearchField>("email");
	const [searchValue, setSearchValue] = useState("");

	const [rangeField, setRangeField] = useState<RangeField>("userID");
	const [minValue, setMinValue] = useState("");
	const [maxValue, setMaxValue] = useState("");

	const [targetUserID, setTargetUserID] = useState<number | null>(null);
	const [removeReasonText, setRemoveReasonText] = useState("");
	const [confirmingRemoval, setConfirmingRemoval] = useState(false);
	const [removingUserID, setRemovingUserID] = useState<number | null>(null);

	useEffect(() => {
		let cancelled = false;

		async function loadUsers() {
			try {
				setLoading(true);
				setPageError("");

				const data = await getAllUsers();
				if (!cancelled) {
					setUsers(data);
				}
			} catch (err) {
				if (!cancelled) {
					setPageError(err instanceof Error ? err.message : "Failed to load users");
				}
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		}

		loadUsers();

		return () => {
			cancelled = true;
		};
	}, []);

	const filteredUsers = useMemo(() => {
		let filtered = [...users];
		const trimmedSearch = searchValue.trim();

		// Keep the email or userID search separate from the numeric range filter so it stays easy to follow
		if (trimmedSearch) {
			if (searchField === "email") {
				filtered = filtered.filter((user) => user.email.toLowerCase().includes(trimmedSearch.toLowerCase()));
			} else {
				filtered = filtered.filter((user) => String(user.userID).includes(trimmedSearch));
			}
		}

		// Only apply min and max when the input can be parsed into a real number
		const parsedMin = minValue.trim() === "" ? null : Number(minValue);
		const parsedMax = maxValue.trim() === "" ? null : Number(maxValue);

		if (parsedMin !== null && !Number.isNaN(parsedMin)) filtered = filtered.filter((user) => Number(user[rangeField]) >= parsedMin);
		if (parsedMax !== null && !Number.isNaN(parsedMax)) filtered = filtered.filter((user) => Number(user[rangeField]) <= parsedMax);

		return filtered;
	}, [users, searchField, searchValue, rangeField, minValue, maxValue]);

	const selectedUser = useMemo(() => users.find((user) => user.userID === targetUserID) || null, [users, targetUserID]);

	function clearFilters() {
		setSearchField("email");
		setSearchValue("");
		setRangeField("userID");
		setMinValue("");
		setMaxValue("");
	}

	function closeRemovePanel() {
		setTargetUserID(null);
		setRemoveReasonText("");
		setConfirmingRemoval(false);
	}

	function beginRemoveUser(userID: number) {
		setPageError("");
		setPageMessage("");
		setTargetUserID(userID);
		setRemoveReasonText("");
		setConfirmingRemoval(false);
	}

	function requestRemoveConfirmation() {
		if (!selectedUser) return;

		// Keep the UI rule strict here too so the admin does not even get a live remove action for admin accounts
		if (selectedUser.userType === "ADMIN") {
			setPageError("Admin accounts cannot be removed from here");
			return;
		}

		setConfirmingRemoval(true);
	}

	async function handleRemoveUser() {
		if (!selectedUser) return;

		try {
			setPageError("");
			setPageMessage("");
			setRemovingUserID(selectedUser.userID);

			await deactivateUser(selectedUser.userID);

			// Remove the user from local state right away since deactivated users should disappear from this page
			setUsers((prev) => prev.filter((user) => user.userID !== selectedUser.userID));
			setPageMessage(`${buildUserLabel(selectedUser)} was removed`);
			closeRemovePanel();
		} catch (err) {
			setPageError(getFriendlyDeactivateError(err));
		} finally {
			setRemovingUserID(null);
		}
	}

	return (
		<div className="usersPage">
			<div className="usersHeader">
				<button type="button" className="pageHomeBtn" onClick={() => navigate("/")}>← Home</button>
				<h1>View All Users</h1>
			</div>

			{pageError ? <p className="usersError">{pageError}</p> : null}
			{pageMessage ? <p className="usersMessage">{pageMessage}</p> : null}
			{loading ? <p className="usersLoading">Loading...</p> : null}

			<div className="usersShell">
				<div className="usersFilterPanel">
					<div className="usersFilterField">
						<label htmlFor="searchField" className="usersFilterLabel">Search By</label>
						<select id="searchField" className="usersFilterInput" value={searchField} onChange={(e) => setSearchField(e.target.value as SearchField)}>
							<option value="email">Email</option>
							<option value="userID">User ID</option>
						</select>
					</div>

					<div className="usersFilterField usersFilterFieldWide">
						<label htmlFor="searchValue" className="usersFilterLabel">Search</label>
						<input
							id="searchValue"
							className="usersFilterInput"
							type="text"
							placeholder={searchField === "email" ? "Search by email" : "Search by user ID"}
							value={searchValue}
							onChange={(e) => setSearchValue(e.target.value)}
						/>
					</div>

					<div className="usersFilterField">
						<label htmlFor="rangeField" className="usersFilterLabel">Filter Field</label>
						<select id="rangeField" className="usersFilterInput" value={rangeField} onChange={(e) => setRangeField(e.target.value as RangeField)}>
							<option value="userID">User ID</option>
							<option value="days_registered">Days Registered</option>
							<option value="total_reservations">Total Appointments</option>
							<option value="past_reservations">Past Appointments</option>
							<option value="upcoming_reservations">Upcoming Appointments</option>
						</select>
					</div>

					<div className="usersFilterField">
						<label htmlFor="minValue" className="usersFilterLabel">Min</label>
						<input id="minValue" className="usersFilterInput" type="number" placeholder="Min" value={minValue} onChange={(e) => setMinValue(e.target.value)} />
					</div>

					<div className="usersFilterField">
						<label htmlFor="maxValue" className="usersFilterLabel">Max</label>
						<input id="maxValue" className="usersFilterInput" type="number" placeholder="Max" value={maxValue} onChange={(e) => setMaxValue(e.target.value)} />
					</div>

					<div className="usersFilterButtonRow">
						<button type="button" className="usersClearBtn" onClick={clearFilters}>Clear</button>
					</div>
				</div>

				<div className="usersSummaryText">Showing {filteredUsers.length} of {users.length} users</div>

				<table className="usersTable">
					<thead>
						<tr>
							<th>User ID</th>
							<th>Name</th>
							<th>Email</th>
							<th>Type</th>
							<th>Days Registered</th>
							<th>Total Appointments</th>
							<th>Past Appointments</th>
							<th>Upcoming Appointments</th>
							<th>Action</th>
						</tr>
					</thead>

					<tbody>
						{filteredUsers.map((user) => {
							const fullName = `${String(user.legalFirstName || "").trim()} ${String(user.legalLastName || "").trim()}`.trim();

							return (
								<tr key={user.userID}>
									<td>{user.userID}</td>
									<td>{fullName || "N/A"}</td>
									<td>{user.email}</td>
									<td>{user.userType}</td>
									<td>{user.days_registered}</td>
									<td>{user.total_reservations}</td>
									<td>{user.past_reservations}</td>
									<td>{user.upcoming_reservations}</td>
									<td>
										<button
											type="button"
											className="usersRemoveBtn"
											onClick={() => beginRemoveUser(user.userID)}
											disabled={removingUserID === user.userID || user.userType === "ADMIN"}
										>
											Remove
										</button>
									</td>
								</tr>
							);
						})}

						{!loading && filteredUsers.length === 0 ? (
							<tr>
								<td colSpan={9}>No users found.</td>
							</tr>
						) : null}
					</tbody>
				</table>

				{selectedUser ? (
					<div className="usersRemovePanel">
						<h2>Remove User</h2>
						<p className="usersRemoveText">
							This will deactivate <b>{buildUserLabel(selectedUser)}</b>
						</p>

						<div className="usersRemoveDetails">
							<div><b>User ID:</b> {selectedUser.userID}</div>
							<div><b>Type:</b> {selectedUser.userType}</div>
							<div><b>Upcoming Appointments:</b> {selectedUser.upcoming_reservations}</div>
						</div>

						<div className="usersFilterField">
							<label htmlFor="removeReasonText" className="usersFilterLabel">Internal note</label>
							<textarea
								id="removeReasonText"
								className="usersReasonTextarea"
								value={removeReasonText}
								onChange={(e) => setRemoveReasonText(e.target.value)}
								placeholder="type reason for removing user"
							/>
						</div>

						<div className="usersRemoveActions">
							<button type="button" className="usersSecondaryBtn" onClick={closeRemovePanel} disabled={removingUserID === selectedUser.userID}>
								Close
							</button>

							{confirmingRemoval ? (
								<button
									type="button"
									className="usersDangerBtn"
									onClick={handleRemoveUser}
									disabled={removingUserID === selectedUser.userID}
								>
									{removingUserID === selectedUser.userID ? "Removing..." : "Confirm Remove"}
								</button>
							) : (
								<button type="button" className="usersDangerBtn" onClick={requestRemoveConfirmation}>
									Continue
								</button>
							)}
						</div>
					</div>
				) : null}
			</div>
		</div>
	);
}
