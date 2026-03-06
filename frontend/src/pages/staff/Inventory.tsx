import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../../styles/inventory.css";

import type { Staff, StaffCreate, StaffRole } from "../../types/staff";
import type { Room, RoomCreate, RoomType } from "../../types/rooms";
import type { InventoryCreate, InventoryItem } from "../../types/inventory";

import { getStaff, createStaff } from "../../api/staff";
import { getRooms, createRoom } from "../../api/rooms";
import { getInventory, createInventoryItem, updateInventoryItem } from "../../api/inventory";

// dropdown options for staff.role
// must match backend validation in /api/staff
const STAFF_ROLE_OPTIONS: { value: StaffRole; label: string }[] = [
	{ value: "VET", label: "VET" },
	{ value: "PET_GROOMER", label: "PET_GROOMER" },
];

// dropdown options for rooms.roomType
// must match backend validation in /api/rooms
const ROOM_TYPE_OPTIONS: { value: RoomType; label: string }[] = [
	{ value: "EXAM", label: "EXAM" },
	{ value: "IMAGING", label: "IMAGING" },
	{ value: "SURGERY", label: "SURGERY" },
	{ value: "GROOMING", label: "GROOMING" },
];

// converts unknown thrown values into a readable string
// used to keep error handling consistent across the page
function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : "Unknown error.";
}

// converts a user-typed key into UPPER_SNAKE_CASE
// example: "x ray machine" -> "X_RAY_MACHINE"
function normalizeItemKey(raw: string): string {
	return raw
		.trim()
		.replace(/\s+/g, "_")
		.toUpperCase();
}

export default function Inventory() {
	// used for the "← Home" button
	const navigate = useNavigate();

	// loading is used as a global UI lock while requests are in progress
	// pageError shows the first error message encountered by the page
	const [loading, setLoading] = useState(false);
	const [pageError, setPageError] = useState("");

	// staff/rooms/items are the main lists rendered on the page
	const [staff, setStaff] = useState<Staff[]>([]);
	const [rooms, setRooms] = useState<Room[]>([]);
	const [items, setItems] = useState<InventoryItem[]>([]);

	// staff form state
	// these values become the payload for POST /api/staff
	const [sName, setSName] = useState("");
	const [sStaffNumber, setSStaffNumber] = useState("");
	const [sEmail, setSEmail] = useState("");
	const [sPosition, setSPosition] = useState("Veterinarian");
	const [sRole, setSRole] = useState<StaffRole>("VET");

	// rooms form state
	// these values become the payload for POST /api/rooms
	const [rRoomNumber, setRRoomNumber] = useState<number>(1);
	const [rRoomType, setRRoomType] = useState<RoomType>("EXAM");
	const [rCapacity, setRCapacity] = useState<number>(1);

	// inventory form state
	// these values become the payload for POST /api/inventory
	const [iIsConsumable, setIIsConsumable] = useState<boolean>(true);
	const [iItemKey, setIItemKey] = useState("");
	const [iDisplayName, setIDisplayName] = useState("");
	const [iItemType, setIItemType] = useState("");
	const [iQty, setIQty] = useState<number>(0);
	const [iDesc, setIDesc] = useState("");

	// qtyEdits stores the current text shown in each quantity input
	// key is itemID because itemID is the inventory primary key
	const [qtyEdits, setQtyEdits] = useState<Record<number, string>>({});

	// savingQty tracks per-row save state for PATCH /api/inventory/:itemID
	// key is itemID, value is true while that row is being saved
	const [savingQty, setSavingQty] = useState<Record<number, boolean>>({});

	// sorted lists keep rendering consistent and stable
	// these are derived values, so useMemo avoids re-sorting on every keystroke
	const staffSorted = useMemo(
		() => [...staff].sort((a, b) => (a.name || "").localeCompare(b.name || "")),
		[staff]
	);
	const roomsSorted = useMemo(
		() => [...rooms].sort((a, b) => a.roomNumber - b.roomNumber),
		[rooms]
	);
	const itemsSorted = useMemo(
		() => [...items].sort((a, b) => (a.displayName || "").localeCompare(b.displayName || "")),
		[items]
	);

	// refreshAll reloads staff, rooms, and inventory in parallel
	// Promise.allSettled is used so one failing endpoint does not block the others
	// if inventory loads, qtyEdits is rebuilt so inputs match the latest quantity values
	async function refreshAll() {
		setPageError("");
		setLoading(true);

		const results = await Promise.allSettled([getStaff(), getRooms(), getInventory()]);
		const errs: string[] = [];

		const s = results[0];
		if (s.status === "fulfilled") setStaff(s.value);
		else errs.push(errMsg(s.reason));

		const r = results[1];
		if (r.status === "fulfilled") setRooms(r.value);
		else errs.push(errMsg(r.reason));

		const it = results[2];
		if (it.status === "fulfilled") {
			setItems(it.value);

			// rebuild qtyEdits so each row input shows the current db quantity
			const nextEdits: Record<number, string> = {};
			for (const row of it.value) nextEdits[row.itemID] = String(row.quantity);
			setQtyEdits(nextEdits);
		} else {
			errs.push(errMsg(it.reason));
		}

		// show the first error (keeps UI simple)
		if (errs.length > 0) setPageError(errs[0]);
		setLoading(false);
	}

	// initial load when the page mounts
	useEffect(() => {
		refreshAll();
	}, []);

	function handleBackToHome() {
		navigate("/");
	}

	// POST /api/staff
	// expected payload fields:
	//  name: required string
	//  position: required string
	//  role: "VET" | "PET_GROOMER"
	//  StaffNumber: optional string or null
	//  email: optional string or null
	async function handleAddStaff() {
		setPageError("");

		const name = sName.trim();
		const staffNumber = sStaffNumber.trim();
		const email = sEmail.trim();
		const position = sPosition.trim();

		if (!name) {
			setPageError("Staff: name is required.");
			return;
		}
		if (!position) {
			setPageError("Staff: position is required.");
			return;
		}

		const payload: StaffCreate = {
			name,
			position,
			role: sRole,
			StaffNumber: staffNumber.length ? staffNumber : null,
			email: email.length ? email : null,
		};

		setLoading(true);
		try {
			await createStaff(payload);

			// reset staff form after create
			setSName("");
			setSStaffNumber("");
			setSEmail("");
			setSPosition("Veterinarian");
			setSRole("VET");

			await refreshAll();
		} catch (err) {
			setPageError(errMsg(err));
			setLoading(false);
		}
	}

	// POST /api/rooms
	// expected payload fields:
	//  roomNumber: integer >= 1 (primary key)
	//  roomType: "EXAM" | "IMAGING" | "SURGERY" | "GROOMING"
	//  capacity: integer >= 1
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

		const payload: RoomCreate = {
			roomNumber: rRoomNumber,
			roomType: rRoomType,
			capacity: rCapacity,
		};

		setLoading(true);
		try {
			await createRoom(payload);

			// reset rooms form after create
			setRRoomNumber(1);
			setRRoomType("EXAM");
			setRCapacity(1);

			await refreshAll();
		} catch (err) {
			setPageError(errMsg(err));
			setLoading(false);
		}
	}

	// POST /api/inventory
	// expected payload fields:
	//  itemKey: required string (recommend UPPER_SNAKE_CASE)
	//  displayName: required string
	//  itemType: required string
	//  isConsumable: boolean
	//  quantity: integer >= 0
	//  itemDescription: required string
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

		const payload: InventoryCreate = {
			itemKey,
			displayName,
			itemType,
			isConsumable: iIsConsumable,
			quantity: iQty,
			itemDescription: desc,
		};

		setLoading(true);
		try {
			await createInventoryItem(payload);

			// reset inventory form after create
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

	// updates the local input value for a specific inventory row
	function setQtyEdit(itemID: number, value: string) {
		setQtyEdits((prev) => ({ ...prev, [itemID]: value }));
	}

	// PATCH /api/inventory/:itemID
	// the UI sends { quantity: number } as the patch body
	// savingQty[itemID] is used to disable only the row being saved
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
				{pageError ? <div className="inventory-error">{pageError}</div> : null}
				<div className="inventory-muted">
					<b>Note:</b> delete actions are disabled for this sprint to avoid breaking existing appointments.
				</div>
			</div>

			<div className="inventory-grid">
				{/* STAFF */}
				<section className="card">
					<h2 className="card-title">Staff</h2>

					<div className="form">
						<label className="label">Name</label>
						<input
							className="input"
							placeholder="Required"
							value={sName}
							onChange={(e) => setSName(e.target.value)}
							disabled={loading}
						/>

						<label className="label">Role</label>
						<select
							className="input"
							value={sRole}
							onChange={(e) => setSRole(e.target.value as StaffRole)}
							disabled={loading}
						>
							{STAFF_ROLE_OPTIONS.map((o) => (
								<option key={o.value} value={o.value}>
									{o.label}
								</option>
							))}
						</select>

						<label className="label">Position</label>
						<input
							className="input"
							placeholder='Required (e.g., "Veterinarian")'
							value={sPosition}
							onChange={(e) => setSPosition(e.target.value)}
							disabled={loading}
						/>

						<label className="label">Staff Number</label>
						<input
							className="input"
							placeholder="Optional"
							value={sStaffNumber}
							onChange={(e) => setSStaffNumber(e.target.value)}
							disabled={loading}
						/>

						<label className="label">Email</label>
						<input
							className="input"
							placeholder="Optional"
							value={sEmail}
							onChange={(e) => setSEmail(e.target.value)}
							disabled={loading}
						/>

						<button className="btn primary" type="button" onClick={handleAddStaff} disabled={loading}>
							Add staff
						</button>
					</div>

					<div className="list">
						{staffSorted.map((s) => (
							<div key={s.staffID} className="row">
								<div className="row-main">
									<div className="row-title">{s.name}</div>
									<div className="row-meta">
										Role: {s.role} · Position: {s.position}
										{s.email ? ` · ${s.email}` : ""}
										{s.StaffNumber ? ` · ${s.StaffNumber}` : ""}
									</div>
								</div>
							</div>
						))}
						{staffSorted.length === 0 ? <div className="empty">No staff yet.</div> : null}
					</div>
				</section>

				{/* ROOMS */}
				<section className="card">
					<h2 className="card-title">Rooms</h2>

					<div className="form">
						<label className="label">Room Number</label>
						<input
							className="input"
							type="number"
							min={1}
							value={rRoomNumber}
							onChange={(e) => setRRoomNumber(Number(e.target.value))}
							disabled={loading}
						/>

						<label className="label">Room Type</label>
						<select
							className="input"
							value={rRoomType}
							onChange={(e) => setRRoomType(e.target.value as RoomType)}
							disabled={loading}
						>
							{ROOM_TYPE_OPTIONS.map((o) => (
								<option key={o.value} value={o.value}>
									{o.label}
								</option>
							))}
						</select>

						<label className="label">Capacity</label>
						<input
							className="input"
							type="number"
							min={1}
							value={rCapacity}
							onChange={(e) => setRCapacity(Number(e.target.value))}
							disabled={loading}
						/>

						<button className="btn primary" type="button" onClick={handleAddRoom} disabled={loading}>
							Add room
						</button>
					</div>

					<div className="list">
						{roomsSorted.map((r) => (
							<div key={r.roomNumber} className="row">
								<div className="row-main">
									<div className="row-title">Room #{r.roomNumber}</div>
									<div className="row-meta">
										Type: {r.roomType} · Capacity: {r.capacity}
									</div>
								</div>
							</div>
						))}
						{roomsSorted.length === 0 ? <div className="empty">No rooms yet.</div> : null}
					</div>
				</section>

				{/* INVENTORY */}
				<section className="card">
					<h2 className="card-title">Inventory Items</h2>

					<div className="form">
						<label className="checkboxRow">
							<input
								type="checkbox"
								checked={iIsConsumable}
								onChange={(e) => setIIsConsumable(e.target.checked)}
								disabled={loading}
							/>
							Consumable (stock-based)
						</label>

						<label className="label">Item Key</label>
						<input
							className="input"
							placeholder="Required (e.g., VACCINE_DOSE, XRAY_MACHINE)"
							value={iItemKey}
							onChange={(e) => setIItemKey(e.target.value)}
							disabled={loading}
						/>

						<label className="label">Display Name</label>
						<input
							className="input"
							placeholder="Required"
							value={iDisplayName}
							onChange={(e) => setIDisplayName(e.target.value)}
							disabled={loading}
						/>

						<label className="label">Item Type</label>
						<input
							className="input"
							placeholder='Required (e.g., "CONSUMABLE", "EQUIPMENT")'
							value={iItemType}
							onChange={(e) => setIItemType(e.target.value)}
							disabled={loading}
						/>

						<label className="label">Quantity</label>
						<input
							className="input"
							type="number"
							min={0}
							value={iQty}
							onChange={(e) => setIQty(Number(e.target.value))}
							disabled={loading}
						/>

						<label className="label">Description</label>
						<input
							className="input"
							placeholder="Required"
							value={iDesc}
							onChange={(e) => setIDesc(e.target.value)}
							disabled={loading}
						/>

						<button className="btn primary" type="button" onClick={handleAddItem} disabled={loading}>
							Add item
						</button>
					</div>

					<div className="list">
						{itemsSorted.map((it) => (
							<div key={it.itemID} className="row">
								<div className="row-main">
									<div className="row-title">{it.displayName}</div>
									<div className="row-meta">
										Key: {it.itemKey}
										{it.itemType ? ` · Type: ${it.itemType}` : ""}
										{` · Consumable: ${it.isConsumable ? "yes" : "no"}`}
									</div>
									{it.itemDescription ? <div className="row-desc">{it.itemDescription}</div> : null}

									<div className="row-meta" style={{ marginTop: 8 }}>
										Qty:
										<input
											className="input"
											style={{ width: 120, marginLeft: 8, display: "inline-block" }}
											type="number"
											min={0}
											value={qtyEdits[it.itemID] ?? String(it.quantity)}
											onChange={(e) => setQtyEdit(it.itemID, e.target.value)}
											disabled={loading || !!savingQty[it.itemID]}
										/>
										<button
											className="btn"
											type="button"
											onClick={() => handleSaveQty(it.itemID)}
											disabled={loading || !!savingQty[it.itemID]}
											style={{ marginLeft: 8 }}
										>
											{savingQty[it.itemID] ? "Saving..." : "Save"}
										</button>
									</div>
								</div>
							</div>
						))}
						{itemsSorted.length === 0 ? <div className="empty">No inventory yet.</div> : null}
					</div>
				</section>
			</div>
		</div>
	);
}