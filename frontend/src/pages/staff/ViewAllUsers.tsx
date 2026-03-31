import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAllUsers, type UserSummary } from "../../api/users";
import "../../styles/viewUsers.css";

type SearchField = "email" | "userID";
type RangeField = "userID" | "days_registered" | "total_reservations" | "past_reservations" | "upcoming_reservations";

export default function ViewAllUsers() {
	const navigate = useNavigate();

	const [users, setUsers] = useState<UserSummary[]>([]);
	const [loading, setLoading] = useState(false);
	const [pageError, setPageError] = useState("");

	const [searchField, setSearchField] = useState<SearchField>("email");
	const [searchValue, setSearchValue] = useState("");

	const [rangeField, setRangeField] = useState<RangeField>("userID");
	const [minValue, setMinValue] = useState("");
	const [maxValue, setMaxValue] = useState("");

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

		// This is the text search
		// It checks either email or userID based on the selected mode
		if (trimmedSearch) {
			if (searchField === "email") {
				filtered = filtered.filter((user) => user.email.toLowerCase().includes(trimmedSearch.toLowerCase()));
			} else {
				filtered = filtered.filter((user) => String(user.userID).includes(trimmedSearch));
			}
		}

		// This is the numeric min and max filter
		// It checks the selected field only
		const parsedMin = minValue.trim() === "" ? null : Number(minValue);
		const parsedMax = maxValue.trim() === "" ? null : Number(maxValue);

		if (parsedMin !== null && !Number.isNaN(parsedMin)) {
			filtered = filtered.filter((user) => Number(user[rangeField]) >= parsedMin);
		}

		if (parsedMax !== null && !Number.isNaN(parsedMax)) {
			filtered = filtered.filter((user) => Number(user[rangeField]) <= parsedMax);
		}

		return filtered;
	}, [users, searchField, searchValue, rangeField, minValue, maxValue]);

	function clearFilters() {
		setSearchField("email");
		setSearchValue("");
		setRangeField("userID");
		setMinValue("");
		setMaxValue("");
	}

	return (
		<div className="usersPage">
			<div className="usersHeader">
				<button type="button" className="pageHomeBtn" onClick={() => navigate("/")}>← Home</button>
				<h1>View All Users</h1>
			</div>

			{pageError ? <p className="usersError">{pageError}</p> : null}
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
							<option value="total_reservations">Total Reservations</option>
							<option value="past_reservations">Past Reservations</option>
							<option value="upcoming_reservations">Upcoming Reservations</option>
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
							<th>Email</th>
							<th>Days Registered</th>
							<th>Total Reservations</th>
							<th>Past Reservations</th>
							<th>Upcoming Reservations</th>
						</tr>
					</thead>

					<tbody>
						{filteredUsers.map((user) => (
							<tr key={user.userID}>
								<td>{user.userID}</td>
								<td>{user.email}</td>
								<td>{user.days_registered}</td>
								<td>{user.total_reservations}</td>
								<td>{user.past_reservations}</td>
								<td>{user.upcoming_reservations}</td>
							</tr>
						))}

						{!loading && filteredUsers.length === 0 ? (
							<tr>
								<td colSpan={6}>No users found.</td>
							</tr>
						) : null}
					</tbody>
				</table>
			</div>
		</div>
	);
}
