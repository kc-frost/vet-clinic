import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../../styles/inventory.css";

import type { Person } from "../../types/people";
import type { Room } from "../../types/rooms";
import type { Resource } from "../../types/resources";

import { getPeople, createPerson, deletePerson, updatePerson } from "../../api/people";
import { getRooms, createRoom, deleteRoom, updateRoom } from "../../api/rooms";
import { getResources, createResource, deleteResource, updateResource } from "../../api/resources";

function normalizeStatus(value: string | null | undefined, fallback: string) {
	const s = (value ?? "").trim();
	return s.length ? s : fallback;
}

export default function Inventory() {
	const navigate = useNavigate();

	const [people, setPeople] = useState<Person[]>([]);
	const [rooms, setRooms] = useState<Room[]>([]);
	const [resources, setResources] = useState<Resource[]>([]);

	const [loading, setLoading] = useState(false);
	const [pageError, setPageError] = useState("");

	// People form
	const [pFullName, setPFullName] = useState("");
	const [pRole, setPRole] = useState("");
	const [pPhoneNumber, setPPhoneNumber] = useState("");

	// Rooms form
	const [rRoomName, setRRoomName] = useState("");
	const [rRoomType, setRRoomType] = useState("");
	const [rCapacity, setRCapacity] = useState<number>(1);

	// Resources form
	const [resName, setResName] = useState("");
	const [resType, setResType] = useState("");
	const [resQty, setResQty] = useState<number>(1);

	const peopleSorted = useMemo(
		() => [...people].sort((a, b) => (a.fullName || "").localeCompare(b.fullName || "")),
		[people]
	);
	const roomsSorted = useMemo(
		() => [...rooms].sort((a, b) => (a.roomName || "").localeCompare(b.roomName || "")),
		[rooms]
	);
	const resourcesSorted = useMemo(
		() => [...resources].sort((a, b) => (a.resourceName || "").localeCompare(b.resourceName || "")),
		[resources]
	);

	async function refreshAll() {
		setPageError("");
		setLoading(true);
		try {
			const [p, r, res] = await Promise.all([getPeople(), getRooms(), getResources()]);
			setPeople(p);
			setRooms(r);
			setResources(res);
		} catch (err) {
			setPageError(err instanceof Error ? err.message : "Failed to load inventory.");
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		refreshAll();
	}, []);

	function handleBackToHome() {
		navigate("/");
	}

	// ---------- PEOPLE ----------
	async function handleAddPerson() {
		setPageError("");

		const fullName = pFullName.trim();
		const role = pRole.trim();
		const phoneNumber = pPhoneNumber.trim();

		if (!fullName || !role) {
			setPageError("People: fullName and role are required.");
			return;
		}

		setLoading(true);
		try {
			await createPerson({
				fullName,
				role,
				phoneNumber: phoneNumber.length ? phoneNumber : null,
				status: "available",
			});

			setPFullName("");
			setPRole("");
			setPPhoneNumber("");

			await refreshAll();
		} catch (err) {
			setPageError(err instanceof Error ? err.message : "Failed to add person.");
			setLoading(false);
		}
	}

	async function handleDeletePerson(personID: number) {
		setPageError("");
		setLoading(true);
		try {
			await deletePerson(personID);
			await refreshAll();
		} catch (err) {
			setPageError(err instanceof Error ? err.message : "Failed to delete person.");
			setLoading(false);
		}
	}

	async function handleTogglePersonStatus(person: Person) {
		const current = normalizeStatus(person.status, "available");
		const next = current === "available" ? "inUse" : "available";

		setPageError("");
		setLoading(true);
		try {
			await updatePerson(person.personID, { status: next });
			await refreshAll();
		} catch (err) {
			setPageError(err instanceof Error ? err.message : "Failed to update person status.");
			setLoading(false);
		}
	}

	// ---------- ROOMS ----------
	async function handleAddRoom() {
		setPageError("");

		const roomName = rRoomName.trim();
		const roomType = rRoomType.trim();

		if (!roomName || !roomType || !Number.isFinite(rCapacity) || rCapacity < 1) {
			setPageError("Rooms: roomName, roomType, and capacity (>= 1) are required.");
			return;
		}

		setLoading(true);
		try {
			await createRoom({
				roomName,
				roomType,
				capacity: rCapacity,
				status: "available",
			});

			setRRoomName("");
			setRRoomType("");
			setRCapacity(1);

			await refreshAll();
		} catch (err) {
			setPageError(err instanceof Error ? err.message : "Failed to add room.");
			setLoading(false);
		}
	}

	async function handleDeleteRoom(roomID: number) {
		setPageError("");
		setLoading(true);
		try {
			await deleteRoom(roomID);
			await refreshAll();
		} catch (err) {
			setPageError(err instanceof Error ? err.message : "Failed to delete room.");
			setLoading(false);
		}
	}

	async function handleToggleRoomStatus(room: Room) {
		const current = normalizeStatus(room.status, "available");
		const next = current === "available" ? "inUse" : "available";

		setPageError("");
		setLoading(true);
		try {
			await updateRoom(room.roomID, { status: next });
			await refreshAll();
		} catch (err) {
			setPageError(err instanceof Error ? err.message : "Failed to update room status.");
			setLoading(false);
		}
	}

	// ---------- RESOURCES ----------
	async function handleAddResource() {
		setPageError("");

		const resourceName = resName.trim();
		const resourceType = resType.trim();

		if (!resourceName || !resourceType || !Number.isFinite(resQty) || resQty < 0) {
			setPageError("Resources: resourceName, resourceType, and quantity (>= 0) are required.");
			return;
		}

		setLoading(true);
		try {
			await createResource({
				resourceName,
				resourceType,
				quantity: resQty,
				status: resQty === 0 ? "depleted" : "available",
			});

			setResName("");
			setResType("");
			setResQty(1);

			await refreshAll();
		} catch (err) {
			setPageError(err instanceof Error ? err.message : "Failed to add resource.");
			setLoading(false);
		}
	}

	async function handleDeleteResource(resourceID: number) {
		setPageError("");
		setLoading(true);
		try {
			await deleteResource(resourceID);
			await refreshAll();
		} catch (err) {
			setPageError(err instanceof Error ? err.message : "Failed to delete resource.");
			setLoading(false);
		}
	}

	async function handleUseOne(resource: Resource) {
		const nextQty = Math.max(0, resource.quantity - 1);
		const nextStatus = nextQty === 0 ? "depleted" : normalizeStatus(resource.status, "available");

		setPageError("");
		setLoading(true);
		try {
			await updateResource(resource.resourceID, {
				quantity: nextQty,
				status: nextStatus,
			});
			await refreshAll();
		} catch (err) {
			setPageError(err instanceof Error ? err.message : "Failed to use resource.");
			setLoading(false);
		}
	}

	/* TODO: POSSIBLY ADD A CAP TO DENOTE SPACE LIMIT OF ITEM*/
	async function handleRestockOne(resource: Resource) {
		const nextQty = resource.quantity + 1;

		setPageError("");
		setLoading(true);
		try {
			await updateResource(resource.resourceID, {
				quantity: nextQty,
				status: "available",
			});
			await refreshAll();
		} catch (err) {
			setPageError(err instanceof Error ? err.message : "Failed to restock resource.");
			setLoading(false);
		}
	}

	return (
		<div className="inventory-page">
			<div className="inventory-header">
				<div className="inventory-topbar">
					<button
						className="btn"
						type="button"
						onClick={handleBackToHome}
						disabled={loading}
					>
						← Home
					</button>

					<button
						className="btn"
						type="button"
						onClick={refreshAll}
						disabled={loading}
					>
						{loading ? "Loading..." : "Refresh"}
					</button>
				</div>

				<h1 className="inventory-title">Inventory</h1>
				<p className="inventory-subtitle">Manage people, rooms, and resources</p>

				{pageError ? <div className="inventory-error">{pageError}</div> : null}
			</div>

			<div className="inventory-grid">
				{/* PEOPLE */}
				<section className="card">
					<h2 className="card-title">People</h2>

					<div className="form">
						<input
							className="input"
							placeholder="Full name"
							value={pFullName}
							onChange={(e) => setPFullName(e.target.value)}
							disabled={loading}
						/>
						<input
							className="input"
							placeholder="Role (Vet, Tech...)"
							value={pRole}
							onChange={(e) => setPRole(e.target.value)}
							disabled={loading}
						/>
						<input
							className="input"
							placeholder="Phone (optional)"
							value={pPhoneNumber}
							onChange={(e) => setPPhoneNumber(e.target.value)}
							disabled={loading}
						/>
						<button
							className="btn primary"
							type="button"
							onClick={handleAddPerson}
							disabled={loading}
						>
							Add person
						</button>
					</div>

					<div className="list">
						{peopleSorted.map((p) => (
							<div key={p.personID} className="row">
								<div className="row-main">
									<div className="row-title">{p.fullName}</div>
									<div className="row-meta">
										Role: {p.role} · Status: {normalizeStatus(p.status, "available")}
									</div>
								</div>
								<div className="row-actions">
									<button
										className="btn"
										type="button"
										onClick={() => handleTogglePersonStatus(p)}
										disabled={loading}
									>
										Toggle inUse
									</button>
									<button
										className="btn danger"
										type="button"
										onClick={() => handleDeletePerson(p.personID)}
										disabled={loading}
									>
										Delete
									</button>
								</div>
							</div>
						))}
						{peopleSorted.length === 0 ? <div className="empty">No people yet.</div> : null}
					</div>
				</section>

				{/* ROOMS */}
				<section className="card">
					<h2 className="card-title">Rooms</h2>

					<div className="form">
						<input
							className="input"
							placeholder="Room name (Exam Room 1)"
							value={rRoomName}
							onChange={(e) => setRRoomName(e.target.value)}
							disabled={loading}
						/>
						<input
							className="input"
							placeholder="Room type (Exam, Surgery...)"
							value={rRoomType}
							onChange={(e) => setRRoomType(e.target.value)}
							disabled={loading}
						/>
						<input
							className="input"
							type="number"
							min={1}
							placeholder="Capacity"
							value={rCapacity}
							onChange={(e) => setRCapacity(Number(e.target.value))}
							disabled={loading}
						/>
						<button
							className="btn primary"
							type="button"
							onClick={handleAddRoom}
							disabled={loading}
						>
							Add room
						</button>
					</div>

					<div className="list">
						{roomsSorted.map((r) => (
							<div key={r.roomID} className="row">
								<div className="row-main">
									<div className="row-title">{r.roomName}</div>
									<div className="row-meta">
										Type: {r.roomType} · Capacity: {r.capacity} · Status: {normalizeStatus(r.status, "available")}
									</div>
								</div>
								<div className="row-actions">
									<button
										className="btn"
										type="button"
										onClick={() => handleToggleRoomStatus(r)}
										disabled={loading}
									>
										Toggle inUse
									</button>
									<button
										className="btn danger"
										type="button"
										onClick={() => handleDeleteRoom(r.roomID)}
										disabled={loading}
									>
										Delete
									</button>
								</div>
							</div>
						))}
						{roomsSorted.length === 0 ? <div className="empty">No rooms yet.</div> : null}
					</div>
				</section>

				{/* RESOURCES */}
				<section className="card">
					<h2 className="card-title">Resources</h2>

					<div className="form">
						<input
							className="input"
							placeholder="Resource name (X-ray Machine)"
							value={resName}
							onChange={(e) => setResName(e.target.value)}
							disabled={loading}
						/>
						<input
							className="input"
							placeholder="Resource type (Imaging...)"
							value={resType}
							onChange={(e) => setResType(e.target.value)}
							disabled={loading}
						/>
						<input
							className="input"
							type="number"
							min={0}
							placeholder="Quantity"
							value={resQty}
							onChange={(e) => setResQty(Number(e.target.value))}
							disabled={loading}
						/>
						<button
							className="btn primary"
							type="button"
							onClick={handleAddResource}
							disabled={loading}
						>
							Add resource
						</button>
					</div>

					<div className="list">
						{resourcesSorted.map((res) => (
							<div key={res.resourceID} className="row">
								<div className="row-main">
									<div className="row-title">{res.resourceName}</div>
									<div className="row-meta">
										Type: {res.resourceType} · Qty: {res.quantity} · Status: {normalizeStatus(res.status, "available")}
									</div>
								</div>
								<div className="row-actions">
									<button
										className="btn"
										type="button"
										onClick={() => handleUseOne(res)}
										disabled={loading || res.quantity <= 0}
									>
										Use -1
									</button>
									<button
										className="btn"
										type="button"
										onClick={() => handleRestockOne(res)}
										disabled={loading}
									>
										Restock +1
									</button>
									<button
										className="btn danger"
										type="button"
										onClick={() => handleDeleteResource(res.resourceID)}
										disabled={loading}
									>
										Delete
									</button>
								</div>
							</div>
						))}
						{resourcesSorted.length === 0 ? <div className="empty">No resources yet.</div> : null}
					</div>
				</section>
			</div>
		</div>
	);
}
