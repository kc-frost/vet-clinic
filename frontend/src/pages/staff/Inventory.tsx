import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../../styles/inventory.css";

import type { Staff, StaffCreate, StaffRoleKey, StaffUserCandidate } from "../../types/staff";
import type { Room, RoomCreate, RoomType } from "../../types/rooms";
import type { InventoryCreate, InventoryItem } from "../../types/inventory";

import { getStaff, createStaff, getStaffUsers } from "../../api/staff";
import { getRooms, createRoom } from "../../api/rooms";
import { getInventory, createInventoryItem, updateInventoryItem } from "../../api/inventory";

// Must match the backend role validation list in /api/staff
const STAFF_ROLE_OPTIONS: { value: StaffRoleKey; label: string }[] = [
	{ value: "GP_VET", label: "GP_VET" },
	{ value: "SURGEON", label: "SURGEON" },
	{ value: "DENTIST", label: "DENTIST" },
	{ value: "GROOMER", label: "GROOMER" },
	{ value: "XRAY_TECH", label: "XRAY_TECH" },
	{ value: "ULTRASOUND_TECH", label: "ULTRASOUND_TECH" },
	{ value: "SURGEON_ASSISTANT", label: "SURGEON_ASSISTANT" },
];

// Must match backend validation in /api/rooms
const ROOM_TYPE_OPTIONS: { value: RoomType; label: string }[] = [
	{ value: "EXAM", label: "EXAM" },
	{ value: "IMAGING", label: "IMAGING" },
	{ value: "SURGERY", label: "SURGERY" },
	{ value: "GROOMING", label: "GROOMING" },
];

type StaffFilterMode = "name" | "staffID" | "roles";
type RoomFilterMode = "roomNumber" | "roomType";
type InventoryFilterMode = "consumableState" | "displayName" | "quantityThreshold";
type InventoryConsumableFilter = "consumable" | "non-consumable";

// Turns unknown thrown values into one readable error string
function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : "Unknown error";
}

// Keeps item keys in one db-friendly format
function normalizeItemKey(raw: string): string {
	return raw.trim().replace(/\s+/g, "_").toUpperCase();
}

// Used for display when profile fields were never filled in
function showOrNA(value: string | null | undefined): string {
	const text = typeof value === "string" ? value.trim() : "";
	return text.length > 0 ? text : "N/A";
}

/*
	Builds one display name for staff cards and the user preview

	First try the linked profile name
	If there is no name yet, use the fallback string
*/
function buildDisplayName(firstName: string | null, lastName: string | null, fallback: string): string {
	const first = showOrNA(firstName);
	const last = showOrNA(lastName);

	if (first !== "N/A" || last !== "N/A") {
		return `${first !== "N/A" ? first : ""} ${last !== "N/A" ? last : ""}`.trim();
	}

	return fallback;
}

/*
	Builds one readable address line for the card

	If nothing was filled in, return N/A
	If only some parts exist, only show those parts
*/
function buildAddressLine(addressLine1: string | null, city: string | null, state: string | null, zipCode: string | null): string {
	const line1 = showOrNA(addressLine1);
	const cityText = showOrNA(city);
	const stateText = showOrNA(state);
	const zipText = showOrNA(zipCode);

	if (line1 === "N/A" && cityText === "N/A" && stateText === "N/A" && zipText === "N/A") {
		return "N/A";
	}

	const cityStateZip = [cityText !== "N/A" ? cityText : "", stateText !== "N/A" ? stateText : "", zipText !== "N/A" ? zipText : ""]
		.filter(Boolean).join(", ").replace(/,\s([^,]+)$/, " $1");

	if (line1 !== "N/A" && cityStateZip) {
		return `${line1} · ${cityStateZip}`;
	}

	if (line1 !== "N/A") {
		return line1;
	}

	return cityStateZip || "N/A";
}

export default function Inventory() {
	// Used for the Home button
	const navigate = useNavigate();

	// loading locks buttons while requests are running
	// pageError shows one readable error message near the top
	const [loading, setLoading] = useState(false);
	const [pageError, setPageError] = useState("");

	// Main lists rendered on the page
	const [staff, setStaff] = useState<Staff[]>([]);
	const [staffUsers, setStaffUsers] = useState<StaffUserCandidate[]>([]);
	const [rooms, setRooms] = useState<Room[]>([]);
	const [items, setItems] = useState<InventoryItem[]>([]);

	/*
		Staff form state

		This form links an existing user account to a staff profile
		It also holds the staff-specific values and the selected role keys
	*/
	const [sSelectedUserID, setSSelectedUserID] = useState("");
	const [sUserSearch, setSUserSearch] = useState("");
	const [sStaffNumber, setSStaffNumber] = useState("");
	const [sPositionTitle, setSPositionTitle] = useState("Veterinarian");
	const [sRoleKeys, setSRoleKeys] = useState<StaffRoleKey[]>([]);

	// Rooms form state
	const [rRoomNumber, setRRoomNumber] = useState<number>(1);
	const [rRoomType, setRRoomType] = useState<RoomType>("EXAM");
	const [rCapacity, setRCapacity] = useState<number>(1);

	// Inventory form state
	const [iIsConsumable, setIIsConsumable] = useState<boolean>(true);
	const [iItemKey, setIItemKey] = useState("");
	const [iDisplayName, setIDisplayName] = useState("");
	const [iItemType, setIItemType] = useState("");
	const [iQty, setIQty] = useState<number>(0);
	const [iDesc, setIDesc] = useState("");

	/*
		qtyEdits stores the live text inside each quantity input
		itemID is used as the key so each row keeps its own temporary input value
	*/
	const [qtyEdits, setQtyEdits] = useState<Record<number, string>>({});

	/*
		savingQty tracks which inventory row is currently saving
		This lets only that row get disabled while its PATCH request is running
	*/
	const [savingQty, setSavingQty] = useState<Record<number, boolean>>({});

	// Staff list filter state
	const [staffFilterMode, setStaffFilterMode] = useState<StaffFilterMode>("name");
	const [staffFilterName, setStaffFilterName] = useState("");
	const [staffFilterStaffID, setStaffFilterStaffID] = useState("");
	const [staffFilterRoles, setStaffFilterRoles] = useState<StaffRoleKey[]>([]);

	// Rooms filter state
	const [roomFilterMode, setRoomFilterMode] = useState<RoomFilterMode>("roomNumber");
	const [roomFilterRoomNumber, setRoomFilterRoomNumber] = useState("");
	const [roomFilterRoomType, setRoomFilterRoomType] = useState<RoomType>("EXAM");

	// Inventory filter state
	const [inventoryFilterMode, setInventoryFilterMode] = useState<InventoryFilterMode>("consumableState");
	const [inventoryConsumableFilter, setInventoryConsumableFilter] = useState<InventoryConsumableFilter>("consumable");
	const [inventoryFilterDisplayName, setInventoryFilterDisplayName] = useState("");
	const [inventoryFilterMaxQty, setInventoryFilterMaxQty] = useState("");

	/*
		These sorted lists are derived from the main state arrays
		useMemo keeps the sort work from rerunning unless the source list changes

		Staff sort goes by first name if it exists
		If not, fallback is staffID
	*/
	const staffSorted = useMemo(() => {
		return [...staff].sort((a, b) => {
			const aFirst = (a.legalFirstName ?? "").trim();
			const bFirst = (b.legalFirstName ?? "").trim();

			// If both have first names, compare by that
			if (aFirst && bFirst) return aFirst.localeCompare(bFirst);

			// A real first name comes before an empty one
			if (aFirst && !bFirst) return -1;
			if (!aFirst && bFirst) return 1;

			// Final fallback if both names are missing
			return a.staffID - b.staffID;
		});
	}, [staff]);

	/*
		Same idea here but for the selectable user accounts

		First name first if it exists, otherwise userID fallback
	*/
	const staffUsersSorted = useMemo(() => {
		return [...staffUsers].sort((a, b) => {
			const aFirst = (a.legalFirstName ?? "").trim();
			const bFirst = (b.legalFirstName ?? "").trim();

			if (aFirst && bFirst) return aFirst.localeCompare(bFirst);
			if (aFirst && !bFirst) return -1;
			if (!aFirst && bFirst) return 1;

			return a.userID - b.userID;
		});
	}, [staffUsers]);

	/*
		Only show accounts that are not already linked to staff

		The live filter checks only userID text
	*/
	const filteredStaffUsers = useMemo(() => {
		const query = sUserSearch.trim();

		const unlinkedUsers = staffUsersSorted.filter((user) => !user.alreadyLinkedToStaff);

		if (!query) {
			return unlinkedUsers.slice(0, 25);
		}

		return unlinkedUsers.filter((user) => String(user.userID).includes(query)).slice(0, 25);
	}, [sUserSearch, staffUsersSorted]);

	// Rooms sort by room number
	const roomsSorted = useMemo(() => [...rooms].sort((a, b) => a.roomNumber - b.roomNumber), [rooms]);

	// Inventory sorts by display name
	const itemsSorted = useMemo(() => [...items].sort((a, b) => (a.displayName || "").localeCompare(b.displayName || "")), [items]);

	/*
		This is the currently selected user account the admin is about to link

		The selected value is stored as a string
		So it gets parsed into a number first, then matched against the loaded users
	*/
	const selectedStaffUser = useMemo(() => {
		const parsed = Number(sSelectedUserID);
		if (!Number.isInteger(parsed) || parsed < 1) return null;
		return staffUsers.find((user) => user.userID === parsed) ?? null;
	}, [sSelectedUserID, staffUsers]);

	/*
		This filters the existing staff list

		Only one filter mode is active at a time
		Name checks the built display name
		Staff ID checks the numeric ID text
		Roles uses AND logic so every checked role must exist
	*/
	const filteredStaff = useMemo(() => {
		if (staffFilterMode === "name") {
			const query = staffFilterName.trim().toLowerCase();
			if (!query) return staffSorted;

			return staffSorted.filter((member) => {
				const displayName = buildDisplayName(member.legalFirstName, member.legalLastName, `Staff ID ${member.staffID}`);
				return displayName.toLowerCase().includes(query);
			});
		}

		if (staffFilterMode === "staffID") {
			const query = staffFilterStaffID.trim();
			if (!query) return staffSorted;
			return staffSorted.filter((member) => String(member.staffID).includes(query));
		}

		if (staffFilterRoles.length === 0) return staffSorted;
		return staffSorted.filter((member) => staffFilterRoles.every((roleKey) => member.roleKeys.includes(roleKey)));
	}, [staffFilterMode, staffFilterName, staffFilterRoles, staffFilterStaffID, staffSorted]);

	/*
		This filters the room list

		Only one room filter mode is active at a time
	*/
	const filteredRooms = useMemo(() => {
		if (roomFilterMode === "roomNumber") {
			const query = roomFilterRoomNumber.trim();
			if (!query) return roomsSorted;
			return roomsSorted.filter((room) => String(room.roomNumber).includes(query));
		}

		return roomsSorted.filter((room) => room.roomType === roomFilterRoomType);
	}, [roomFilterMode, roomFilterRoomNumber, roomFilterRoomType, roomsSorted]);

	/*
		This filters the inventory list

		Only one inventory filter mode is active at a time
		Quantity filter is <= the threshold the admin types in
	*/
	const filteredItems = useMemo(() => {
		if (inventoryFilterMode === "consumableState") {
			return itemsSorted.filter((item) => inventoryConsumableFilter === "consumable" ? item.isConsumable : !item.isConsumable);
		}

		if (inventoryFilterMode === "displayName") {
			const query = inventoryFilterDisplayName.trim().toLowerCase();
			if (!query) return itemsSorted;
			return itemsSorted.filter((item) => item.displayName.toLowerCase().includes(query));
		}

		const rawThreshold = inventoryFilterMaxQty.trim();
		if (!rawThreshold) return itemsSorted;

		const threshold = Number(rawThreshold);
		if (!Number.isFinite(threshold)) return itemsSorted;

		return itemsSorted.filter((item) => item.quantity <= threshold);
	}, [inventoryConsumableFilter, inventoryFilterDisplayName, inventoryFilterMaxQty, inventoryFilterMode, itemsSorted]);

	/*
		Reloads all page data

		Promise.allSettled is used so one failed request does not stop the others

		If inventory loads, qtyEdits gets rebuilt from the db values
		That keeps each quantity input synced with the latest saved data
	*/
	async function refreshAll() {
		setPageError("");
		setLoading(true);

		const results = await Promise.allSettled([getStaff(), getStaffUsers(), getRooms(), getInventory()]);

		const errs: string[] = [];

		const s = results[0];
		if (s.status === "fulfilled") setStaff(s.value);
		else errs.push(errMsg(s.reason));

		const su = results[1];
		if (su.status === "fulfilled") setStaffUsers(su.value);
		else errs.push(errMsg(su.reason));

		const r = results[2];
		if (r.status === "fulfilled") setRooms(r.value);
		else errs.push(errMsg(r.reason));

		const it = results[3];
		if (it.status === "fulfilled") {
			setItems(it.value);

			/*
				Rebuild the quantity edit map from the fresh inventory list
				That keeps the quantity inputs aligned with the current db quantity
			*/
			const nextEdits: Record<number, string> = {};
			for (const row of it.value) nextEdits[row.itemID] = String(row.quantity);
			setQtyEdits(nextEdits);
		} else {
			errs.push(errMsg(it.reason));
		}

		// Keep the top error UI simple and show the first one found
		if (errs.length > 0) setPageError(errs[0]);
		setLoading(false);
	}

	// Initial page load
	useEffect(() => {
		refreshAll();
	}, []);

	function handleBackToHome() {
		navigate("/");
	}

	/*
		Picks one user from the filtered search results

		The search box is filled with the chosen userID
	*/
	function handlePickStaffUser(user: StaffUserCandidate) {
		setSSelectedUserID(String(user.userID));
		setSUserSearch(String(user.userID));
	}

	/*
		Toggles one role checkbox on or off

		If the role already exists, remove it
		If not, append it
	*/
	function toggleStaffRole(roleKey: StaffRoleKey) {
		setSRoleKeys((prev) => {
			if (prev.includes(roleKey)) {
				return prev.filter((value) => value !== roleKey);
			}
			return [...prev, roleKey];
		});
	}

	/*
		This is for the existing staff list filter

		AND logic is handled later in filteredStaff
	*/
	function toggleStaffFilterRole(roleKey: StaffRoleKey) {
		setStaffFilterRoles((prev) => {
			if (prev.includes(roleKey)) {
				return prev.filter((value) => value !== roleKey);
			}
			return [...prev, roleKey];
		});
	}

	/*
		Staff create flow

		This validates the selected user, the staff-specific fields,
		and the checked role keys before sending the StaffCreate payload
	*/
	async function handleAddStaff() {
		setPageError("");

		const parsedUserID = Number(sSelectedUserID);
		const cleanStaffNumber = sStaffNumber.trim();
		const cleanPositionTitle = sPositionTitle.trim();

		if (!Number.isInteger(parsedUserID) || parsedUserID < 1) {
			setPageError("Staff: pick a valid user to link.");
			return;
		}

		if (!selectedStaffUser) {
			setPageError("Staff: selected user could not be found.");
			return;
		}

		// Blocks trying to link the same account twice
		if (selectedStaffUser.alreadyLinkedToStaff) {
			setPageError("Staff: this user is already linked to a staff profile.");
			return;
		}

		if (!cleanStaffNumber) {
			setPageError("Staff: staff number is required.");
			return;
		}

		if (!cleanPositionTitle) {
			setPageError("Staff: position title is required.");
			return;
		}

		if (sRoleKeys.length === 0) {
			setPageError("Staff: choose at least one role.");
			return;
		}

		const payload: StaffCreate = { userID: parsedUserID, staffNumber: cleanStaffNumber, positionTitle: cleanPositionTitle, roleKeys: sRoleKeys };

		setLoading(true);
		try {
			await createStaff(payload);

			// Reset the form after a successful create
			setSSelectedUserID("");
			setSUserSearch("");
			setSStaffNumber("");
			setSPositionTitle("Veterinarian");
			setSRoleKeys([]);

			await refreshAll();
		} catch (err) {
			setPageError(errMsg(err));
			setLoading(false);
		}
	}

	/*
		Room create logic

		This validates the numeric fields first, then sends the RoomCreate payload
	*/
	async function handleAddRoom() {
		setPageError("");

		if (!Number.isFinite(rRoomNumber) || rRoomNumber < 1 || !Number.isInteger(rRoomNumber)) {
			setPageError("Rooms: room number must be a whole number >= 1.");
			return;
		}
		if (!Number.isFinite(rCapacity) || rCapacity < 1 || !Number.isInteger(rCapacity)) {
			setPageError("Rooms: capacity must be a whole number >= 1.");
			return;
		}

		const payload: RoomCreate = { roomNumber: rRoomNumber, roomType: rRoomType, capacity: rCapacity };

		setLoading(true);
		try {
			await createRoom(payload);

			// Reset the room form after create
			setRRoomNumber(1);
			setRRoomType("EXAM");
			setRCapacity(1);

			await refreshAll();
		} catch (err) {
			setPageError(errMsg(err));
			setLoading(false);
		}
	}

	/*
		Inventory create flow

		itemKey is normalized before sending so it stays in one consistent format
		The rest is required-field and number validation before the POST
	*/
	async function handleAddItem() {
		setPageError("");

		const itemKey = normalizeItemKey(iItemKey);
		const displayName = iDisplayName.trim();
		const itemType = iItemType.trim();
		const desc = iDesc.trim();

		if (!itemKey) {
			setPageError("Inventory: itemKey is required (recommend UPPER_SNAKE_CASE). ");
			return;
		}
		if (!displayName) {
			setPageError("Inventory: display name is required.");
			return;
		}
		if (!itemType) {
			setPageError("Inventory: item type is required.");
			return;
		}
		if (!Number.isFinite(iQty) || iQty < 0 || !Number.isInteger(iQty)) {
			setPageError("Inventory: quantity must be a whole number >= 0.");
			return;
		}
		if (!desc) {
			setPageError("Inventory: description is required.");
			return;
		}

		const payload: InventoryCreate = { itemKey, displayName, itemType, isConsumable: iIsConsumable, quantity: iQty, itemDescription: desc };

		setLoading(true);
		try {
			await createInventoryItem(payload);

			// Reset the inventory form after create
			setIIsConsumable(true);
			setIItemKey("");
			setIDisplayName("");
			setIItemType("");
			setIQty(0);
			setIDesc("");

			await refreshAll();
		} catch (err) {
			setPageError(errMsg(err));
			setLoading(false);
		}
	}

	// Updates one quantity input's live text
	function setQtyEdit(itemID: number, value: string) {
		setQtyEdits((prev) => ({ ...prev, [itemID]: value }));
	}

	/*
		Quantity save flow for one inventory row

		The input value is stored as text first
		So this parses it, validates it, then sends the PATCH

		savingQty[itemID] is what lets only that one row show Saving...
		and get disabled while its request is running
	*/
	async function handleSaveQty(itemID: number) {
		setPageError("");

		const raw = (qtyEdits[itemID] ?? "").trim();
		const nextQty = Number(raw);

		if (!raw.length || !Number.isFinite(nextQty) || nextQty < 0 || !Number.isInteger(nextQty)) {
			setPageError("Inventory: quantity must be a whole number >= 0.");
			return;
		}

		setSavingQty((p) => ({ ...p, [itemID]: true }));
		try {
			await updateInventoryItem(itemID, { quantity: nextQty });
			await refreshAll();
		} catch (err) {
			setPageError(errMsg(err));
		} finally {
			setSavingQty((p) => ({ ...p, [itemID]: false }));
		}
	}

	return (
		<div className="inventory-page">
			<div className="inventory-header">
				<div className="inventory-topbar">
					<button className="btn" type="button" onClick={handleBackToHome} disabled={loading}>
						← Home
					</button>
					<button className="btn" type="button" onClick={refreshAll} disabled={loading}>
						{loading ? "Loading..." : "Refresh"}
					</button>
				</div>

				<h1 className="inventory-title">Staff / Rooms / Inventory</h1>

				{/* Top page error area */}
				{pageError ? <div className="inventory-error">{pageError}</div> : null}

				<div className="inventory-muted">
					<b>Note:</b> delete actions are disabled for this sprint to avoid breaking existing appointments.
				</div>
			</div>

			<div className="inventory-grid">
				{/* Staff section */}
				<section className="card">
					<h2 className="card-title">Staff</h2>

					<div className="panelBlock">
						<div className="subsectionTitle">Link User Account</div>
						<label className="label">Search User To Link</label>
						<input
							className="input"
							placeholder="Type user ID"
							value={sUserSearch}
							onChange={(e) => {
								setSUserSearch(e.target.value);
								setSSelectedUserID("");
							}}
							disabled={loading}
						/>

						{/* Search result list for unlinked users only */}
						<div className="list compactUserList">
							{filteredStaffUsers.map((user) => (
								<div key={user.userID} className="row compactUserRow">
									<div className="row-main">
										<div className="row-title">User ID {user.userID}</div>
										<div className="row-meta compactUserMeta">Email: {showOrNA(user.email)}</div>
									</div>
									<button className="btn" type="button" onClick={() => handlePickStaffUser(user)} disabled={loading}>
										Select
									</button>
								</div>
							))}

							{sUserSearch.trim() && filteredStaffUsers.length === 0 ? <div className="empty">No matching unlinked users</div> : null}
						</div>

						{/* Read-only preview of the selected linked user account */}
						{selectedStaffUser ? (
							<div className="row">
								<div className="row-main">
									<div className="row-title">
										{buildDisplayName(selectedStaffUser.legalFirstName, selectedStaffUser.legalLastName, `User ID ${selectedStaffUser.userID}`)}
									</div>
									<div className="row-meta">
										User ID: {selectedStaffUser.userID} · Username: {showOrNA(selectedStaffUser.username)}
									</div>
									<div className="row-meta">Email: {showOrNA(selectedStaffUser.email)}</div>
									<div className="row-meta">Already Linked: {selectedStaffUser.alreadyLinkedToStaff ? "Yes" : "No"}</div>
								</div>
							</div>
						) : null}

						<label className="label">Position Title</label>
						<input className="input" placeholder='Required (e.g., "Veterinarian")' value={sPositionTitle} onChange={(e) => setSPositionTitle(e.target.value)} disabled={loading} />

						<label className="label">Staff Number</label>
						<input className="input" placeholder="Required" value={sStaffNumber} onChange={(e) => setSStaffNumber(e.target.value)} disabled={loading} />

						<label className="label">Skills / Roles</label>
						<div className="form">
							{/* Checkboxes are used since one staff member can have multiple role keys */}
							{STAFF_ROLE_OPTIONS.map((option) => (
								<label key={option.value} className="checkboxRow">
									<input type="checkbox" checked={sRoleKeys.includes(option.value)} onChange={() => toggleStaffRole(option.value)} disabled={loading} />
									{option.label}
								</label>
							))}
						</div>

						<button className="btn primary" type="button" onClick={handleAddStaff} disabled={loading}>
							Add staff
						</button>
					</div>

					{/* This is for filtering the existing staff list only */}
					<div className="panelBlock subsectionDivider">
						<div className="subsectionTitle">Filter Existing Staff</div>

						<div className="form">
							<label className="checkboxRow">
								<input type="radio" name="staff-filter-mode" checked={staffFilterMode === "name"} onChange={() => setStaffFilterMode("name")} disabled={loading} />
								Name
							</label>
							<label className="checkboxRow">
								<input type="radio" name="staff-filter-mode" checked={staffFilterMode === "staffID"} onChange={() => setStaffFilterMode("staffID")} disabled={loading} />
								Staff ID
							</label>
							<label className="checkboxRow">
								<input type="radio" name="staff-filter-mode" checked={staffFilterMode === "roles"} onChange={() => setStaffFilterMode("roles")} disabled={loading} />
								Roles
							</label>
						</div>

						{/* Only one filter input area shows at a time */}
						{staffFilterMode === "name" ? (
							<>
								<label className="label">Filter By Name</label>
								<input
									className="input"
									placeholder="Type a name"
									value={staffFilterName}
									onChange={(e) => setStaffFilterName(e.target.value)}
									disabled={loading}
								/>
							</>
						) : null}

						{staffFilterMode === "staffID" ? (
							<>
								<label className="label">Filter By Staff ID</label>
								<input
									className="input"
									placeholder="Type a staff ID"
									value={staffFilterStaffID}
									onChange={(e) => setStaffFilterStaffID(e.target.value)}
									disabled={loading}
								/>
							</>
						) : null}

						{staffFilterMode === "roles" ? (
							<>
								<label className="label">Filter By Roles</label>
								<div className="form">
									{/* This uses AND logic so all checked roles must exist on the same staff member */}
									{STAFF_ROLE_OPTIONS.map((option) => (
										<label key={option.value} className="checkboxRow">
											<input
												type="checkbox"
												checked={staffFilterRoles.includes(option.value)}
												onChange={() => toggleStaffFilterRole(option.value)}
												disabled={loading}
											/>
											{option.label}
										</label>
									))}
								</div>
							</>
						) : null}
					</div>

					<div className="resultsBlock subsectionDivider">
						<div className="subsectionTitle">Existing Staff</div>
						<div className="list">
						{/* Existing staff cards */}
						{filteredStaff.map((s) => {
							const displayName = buildDisplayName(s.legalFirstName, s.legalLastName, `Staff ID ${s.staffID}`);
							const addressLine = buildAddressLine(s.addressLine1, s.city, s.state, s.zipCode);

							return (
								<div key={s.staffID} className="row">
									<div className="row-main">
										<div className="row-title">{displayName}</div>
										<div className="row-meta">
											Staff ID: {s.staffID} · User ID: {s.userID} · Staff Number: {showOrNA(s.staffNumber)}
										</div>
										<div className="row-meta">Position Title: {showOrNA(s.positionTitle)}</div>
										<div className="row-meta">Email: {showOrNA(s.email)}</div>
										<div className="row-meta">Phone: {showOrNA(s.phone)}</div>
										<div className="row-meta">Address: {addressLine}</div>
										<div className="row-meta">Roles: {s.roleKeys.length > 0 ? s.roleKeys.join(", ") : "N/A"}</div>
									</div>
								</div>
							);
						})}

						{/* Empty state for filtered staff */}
						{staff.length > 0 && filteredStaff.length === 0 ? <div className="empty">No staff match the current filter.</div> : null}

						{/* Empty state for no staff at all */}
						{staff.length === 0 ? <div className="empty">No staff yet.</div> : null}
						</div>
					</div>
				</section>

				{/* Rooms section */}
				<section className="card">
					<h2 className="card-title">Rooms</h2>

					<div className="panelBlock">
						<div className="subsectionTitle">Add Room</div>
						<label className="label">Room Number</label>
						<input className="input" type="number" min={1} value={rRoomNumber} onChange={(e) => setRRoomNumber(Number(e.target.value))} disabled={loading} />

						<label className="label">Room Type</label>
						<select className="input" value={rRoomType} onChange={(e) => setRRoomType(e.target.value as RoomType)} disabled={loading}>
							{ROOM_TYPE_OPTIONS.map((o) => (
								<option key={o.value} value={o.value}>
									{o.label}
								</option>
							))}
						</select>

						<label className="label">Capacity</label>
						<input className="input" type="number" min={1} value={rCapacity} onChange={(e) => setRCapacity(Number(e.target.value))} disabled={loading} />

						<button className="btn primary" type="button" onClick={handleAddRoom} disabled={loading}>
							Add room
						</button>
					</div>

					{/* This is for filtering the existing room list only */}
					<div className="panelBlock subsectionDivider">
						<div className="subsectionTitle">Filter Rooms</div>

						<div className="form">
							<label className="checkboxRow">
								<input type="radio" name="room-filter-mode" checked={roomFilterMode === "roomNumber"} onChange={() => setRoomFilterMode("roomNumber")} disabled={loading} />
								Room Number
							</label>
							<label className="checkboxRow">
								<input type="radio" name="room-filter-mode" checked={roomFilterMode === "roomType"} onChange={() => setRoomFilterMode("roomType")} disabled={loading} />
								Room Type
							</label>
						</div>

						{/* Only one room filter input area shows at a time */}
						{roomFilterMode === "roomNumber" ? (
							<>
								<label className="label">Filter By Room Number</label>
								<input
									className="input"
									placeholder="Type a room number"
									value={roomFilterRoomNumber}
									onChange={(e) => setRoomFilterRoomNumber(e.target.value)}
									disabled={loading}
								/>
							</>
						) : null}

						{roomFilterMode === "roomType" ? (
							<>
								<label className="label">Filter By Room Type</label>
								<select className="input" value={roomFilterRoomType} onChange={(e) => setRoomFilterRoomType(e.target.value as RoomType)} disabled={loading}>
									{ROOM_TYPE_OPTIONS.map((o) => (
										<option key={o.value} value={o.value}>
											{o.label}
										</option>
									))}
								</select>
							</>
						) : null}
					</div>

					<div className="resultsBlock subsectionDivider">
						<div className="subsectionTitle">Existing Rooms</div>
						<div className="list">
						{filteredRooms.map((r) => (
							<div key={r.roomNumber} className="row">
								<div className="row-main">
									<div className="row-title">Room #{r.roomNumber}</div>
									<div className="row-meta">Type: {r.roomType} · Capacity: {r.capacity}</div>
								</div>
							</div>
						))}

						{rooms.length > 0 && filteredRooms.length === 0 ? <div className="empty">No rooms match the current filter.</div> : null}
						{rooms.length === 0 ? <div className="empty">No rooms yet.</div> : null}
						</div>
					</div>
				</section>

				{/* Inventory section */}
				<section className="card">
					<h2 className="card-title">Inventory Items</h2>

					<div className="panelBlock">
						<div className="subsectionTitle">Add Inventory Item</div>
						<label className="checkboxRow">
							<input type="checkbox" checked={iIsConsumable} onChange={(e) => setIIsConsumable(e.target.checked)} disabled={loading} />
							Consumable (stock-based)
						</label>

						<label className="label">Item Key</label>
						<input className="input" placeholder="Required (e.g., VACCINE_DOSE, XRAY_MACHINE)" value={iItemKey} onChange={(e) => setIItemKey(e.target.value)} disabled={loading} />

						<label className="label">Display Name</label>
						<input className="input" placeholder="Required" value={iDisplayName} onChange={(e) => setIDisplayName(e.target.value)} disabled={loading} />

						<label className="label">Item Type</label>
						<input className="input" placeholder='Required (e.g., "Medicine", "Equipment")' value={iItemType} onChange={(e) => setIItemType(e.target.value)} disabled={loading} />

						<label className="label">Quantity</label>
						<input className="input" type="number" min={0} value={iQty} onChange={(e) => setIQty(Number(e.target.value))} disabled={loading} />

						<label className="label">Description</label>
						<input className="input" placeholder="Required" value={iDesc} onChange={(e) => setIDesc(e.target.value)} disabled={loading} />

						<button className="btn primary" type="button" onClick={handleAddItem} disabled={loading}>
							Add inventory item
						</button>
					</div>

					{/* This is for filtering the existing inventory list only */}
					<div className="panelBlock subsectionDivider">
						<div className="subsectionTitle">Filter Inventory Items</div>

						<div className="form">
							<label className="checkboxRow">
								<input
									type="radio"
									name="inventory-filter-mode"
									checked={inventoryFilterMode === "consumableState"}
									onChange={() => setInventoryFilterMode("consumableState")}
									disabled={loading}
								/>
								Consumable State
							</label>
							<label className="checkboxRow">
								<input
									type="radio"
									name="inventory-filter-mode"
									checked={inventoryFilterMode === "displayName"}
									onChange={() => setInventoryFilterMode("displayName")}
									disabled={loading}
								/>
								Display Name
							</label>
							<label className="checkboxRow">
								<input
									type="radio"
									name="inventory-filter-mode"
									checked={inventoryFilterMode === "quantityThreshold"}
									onChange={() => setInventoryFilterMode("quantityThreshold")}
									disabled={loading}
								/>
								Quantity Threshold
							</label>
						</div>

						{/* Only one inventory filter input area shows at a time */}
						{inventoryFilterMode === "consumableState" ? (
							<>
								<label className="label">Filter By Consumable State</label>
								<div className="form">
									<label className="checkboxRow">
										<input
											type="radio"
											name="inventory-consumable-filter"
											checked={inventoryConsumableFilter === "consumable"}
											onChange={() => setInventoryConsumableFilter("consumable")}
											disabled={loading}
										/>
										Consumables Only
									</label>
									<label className="checkboxRow">
										<input
											type="radio"
											name="inventory-consumable-filter"
											checked={inventoryConsumableFilter === "non-consumable"}
											onChange={() => setInventoryConsumableFilter("non-consumable")}
											disabled={loading}
										/>
										Non-consumables Only
									</label>
								</div>
							</>
						) : null}

						{inventoryFilterMode === "displayName" ? (
							<>
								<label className="label">Filter By Display Name</label>
								<input
									className="input"
									placeholder='Type part of a name like "Anti"'
									value={inventoryFilterDisplayName}
									onChange={(e) => setInventoryFilterDisplayName(e.target.value)}
									disabled={loading}
								/>
							</>
						) : null}

						{inventoryFilterMode === "quantityThreshold" ? (
							<>
								<label className="label">Filter By Max Quantity</label>
								<input
									className="input"
									type="number"
									min={0}
									placeholder="Show items with quantity <= this number"
									value={inventoryFilterMaxQty}
									onChange={(e) => setInventoryFilterMaxQty(e.target.value)}
									disabled={loading}
								/>
							</>
						) : null}
					</div>

					<div className="resultsBlock subsectionDivider">
						<div className="subsectionTitle">Existing Inventory Items</div>
						<div className="list">
						{/* Inventory rows with inline quantity editing */}
						{filteredItems.map((it) => (
							<div key={it.itemID} className="row">
								<div className="row-main">
									<div className="row-title">{it.displayName}</div>
									<div className="row-meta">
										Key: {it.itemKey} · Type: {it.itemType} · {it.isConsumable ? "Consumable" : "Non-consumable"}
									</div>
									<div className="row-desc">{it.itemDescription}</div>

									<div className="row-meta" style={{ marginTop: 8 }}>
										Quantity
									</div>

									{/* Input edits local text first, save button sends the PATCH */}
									<div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
										<input
											className="input"
											style={{ maxWidth: 120 }}
											type="number"
											min={0}
											value={qtyEdits[it.itemID] ?? ""}
											onChange={(e) => setQtyEdit(it.itemID, e.target.value)}
											disabled={loading || !!savingQty[it.itemID]}
										/>
										<button className="btn" type="button" onClick={() => handleSaveQty(it.itemID)} disabled={loading || !!savingQty[it.itemID]}>
											{savingQty[it.itemID] ? "Saving..." : "Save qty"}
										</button>
									</div>
								</div>
							</div>
						))}

						{items.length > 0 && filteredItems.length === 0 ? <div className="empty">No inventory items match the current filter.</div> : null}
						{items.length === 0 ? <div className="empty">No inventory items yet.</div> : null}
						</div>
					</div>
				</section>
			</div>
		</div>
	);
}