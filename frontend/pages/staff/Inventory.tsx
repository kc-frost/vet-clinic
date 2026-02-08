  import { useEffect, useMemo, useState } from "react";
  import { useNavigate } from "react-router-dom";
  import "../../styles/inventory.css";

  import type { Staff, StaffPosition } from "../../types/staff";
  import type { Room, RoomCreate, RoomType } from "../../types/rooms";
  import type { InventoryItem, InventoryType, InventoryCreate } from "../../types/inventory";
  import type { Equipment } from "../../types/equipment";
  import type { Medicine } from "../../types/medicine";

  import { getStaff, createStaff, deleteStaff } from "../../api/staff";
  import { getRooms, createRoom, deleteRoom } from "../../api/rooms";
  import { getInventory, createInventoryItem, deleteInventoryItem } from "../../api/inventory";
  import { getEquipment } from "../../api/equipment";
  import { getMedicines } from "../../api/medicine";

  const STAFF_POSITION_OPTIONS: { value: StaffPosition; label: string }[] = [
    { value: "Veterinarian", label: "Veterinarian" },
    { value: "VetAssistant", label: "Vet Assistant" },
    { value: "ServiceRepresentative", label: "Service Representative" },
  ];

  const ROOM_TYPE_OPTIONS: { value: RoomType; label: string }[] = [
    { value: "CheckupRoom", label: "Checkup Room" },
    { value: "XrayRoom", label: "X-ray Room" },
    { value: "SurgeryRoom", label: "Surgery Room" },
  ];

  const INVENTORY_TYPE_OPTIONS: { value: InventoryType; label: string }[] = [
    { value: "medicine", label: "Medicine" },
    { value: "equipment", label: "Equipment" },
  ];

  function errMsg(err: unknown): string {
    return err instanceof Error ? err.message : "Unknown error.";
  }

  export default function Inventory() {
    const navigate = useNavigate();

    const [loading, setLoading] = useState(false);
    const [pageError, setPageError] = useState("");

    // data lists
    const [staff, setStaff] = useState<Staff[]>([]);
    const [rooms, setRooms] = useState<Room[]>([]);
    const [items, setItems] = useState<InventoryItem[]>([]);
    const [equipment, setEquipment] = useState<Equipment[]>([]);
    const [medicines, setMedicines] = useState<Medicine[]>([]);

    // staff form
    const [sName, setSName] = useState("");
    const [sStaffNumber, setSStaffNumber] = useState("");
    const [sEmail, setSEmail] = useState("");
    const [sPosition, setSPosition] = useState<StaffPosition>("Veterinarian");

    // rooms form
    const [rRoomType, setRRoomType] = useState<RoomType>("CheckupRoom");
    const [rCapacity, setRCapacity] = useState<number>(1);

    // inventory form
    const [iType, setIType] = useState<InventoryType>("medicine");
    const [selectedNdc, setSelectedNdc] = useState<number | null>(null);
    const [selectedEquipmentID, setSelectedEquipmentID] = useState<number | null>(null);
    const [iQty, setIQty] = useState<number>(1);
    const [iDesc, setIDesc] = useState("");
    const [iInUse, setIInUse] = useState(false);

    const staffSorted = useMemo(
      () => [...staff].sort((a, b) => (a.name || "").localeCompare(b.name || "")),
      [staff]
    );
    const roomsSorted = useMemo(() => [...rooms].sort((a, b) => a.roomNumber - b.roomNumber), [rooms]);
    const itemsSorted = useMemo(
      () => [...items].sort((a, b) => (a.displayName || "").localeCompare(b.displayName || "")),
      [items]
    );

    const equipmentSorted = useMemo(
      () => [...equipment].sort((a, b) => (a.equipmentType || "").localeCompare(b.equipmentType || "")),
      [equipment]
    );
    const medicinesSorted = useMemo(
      () => [...medicines].sort((a, b) => (a.medicineName || "").localeCompare(b.medicineName || "")),
      [medicines]
    );

    async function refreshAll() {
      setPageError("");
      setLoading(true);

      const results = await Promise.allSettled([getStaff(), getRooms(), getInventory(), getEquipment(), getMedicines()]);

      const errs: string[] = [];

      const s = results[0];
      if (s.status === "fulfilled") setStaff(s.value);
      else errs.push(errMsg(s.reason));

      const r = results[1];
      if (r.status === "fulfilled") setRooms(r.value);
      else errs.push(errMsg(r.reason));

      const it = results[2];
      if (it.status === "fulfilled") setItems(it.value);
      else errs.push(errMsg(it.reason));

      const eq = results[3];
      if (eq.status === "fulfilled") setEquipment(eq.value);
      else errs.push(errMsg(eq.reason));

      const med = results[4];
      if (med.status === "fulfilled") setMedicines(med.value);
      else errs.push(errMsg(med.reason));

      if (errs.length > 0) setPageError(errs[0]);
      setLoading(false);
    }

    useEffect(() => {
      refreshAll();
    }, []);

    function handleBackToHome() {
      navigate("/");
    }

    async function handleAddStaff() {
      setPageError("");

      const name = sName.trim();
      const staffNumber = sStaffNumber.trim();
      const email = sEmail.trim();

      if (!name) {
        setPageError("Staff: name is required.");
        return;
      }

      const payload: Omit<Staff, "staffID"> = {
        name,
        position: sPosition,
        StaffNumber: staffNumber.length ? staffNumber : null,
        email: email.length ? email : null,
      };

      setLoading(true);
      try {
        await createStaff(payload);
        setSName("");
        setSStaffNumber("");
        setSEmail("");
        setSPosition("Veterinarian");
        await refreshAll();
      } catch (err) {
        setPageError(errMsg(err));
        setLoading(false);
      }
    }

    async function handleDeleteStaff(staffID: number) {
      setPageError("");
      setLoading(true);
      try {
        await deleteStaff(staffID);
        await refreshAll();
      } catch (err) {
        setPageError(errMsg(err));
        setLoading(false);
      }
    }

    async function handleAddRoom() {
      setPageError("");

      if (!Number.isFinite(rCapacity) || rCapacity < 1 || !Number.isInteger(rCapacity)) {
        setPageError("Rooms: capacity must be a whole number >= 1.");
        return;
      }

      const payload: RoomCreate = {
        roomType: rRoomType,
        capacity: rCapacity,
      };

      setLoading(true);
      try {
        await createRoom(payload);
        setRRoomType("CheckupRoom");
        setRCapacity(1);
        await refreshAll();
      } catch (err) {
        setPageError(errMsg(err));
        setLoading(false);
      }
    }

    async function handleDeleteRoom(roomNumber: number) {
      setPageError("");
      setLoading(true);
      try {
        await deleteRoom(roomNumber);
        await refreshAll();
      } catch (err) {
        setPageError(errMsg(err));
        setLoading(false);
      }
    }

    function handleInventoryTypeChange(next: InventoryType) {
      setIType(next);
      setPageError("");
      setSelectedNdc(null);
      setSelectedEquipmentID(null);
      setIInUse(false);
    }

    async function handleAddItem() {
      setPageError("");

      const desc = iDesc.trim();

      if (!Number.isFinite(iQty) || iQty < 0 || !Number.isInteger(iQty)) {
        setPageError("Inventory: quantity must be a whole number >= 0.");
        return;
      }

      let displayName = "";
      let ndc: number | null = null;
      let equipmentID: number | null = null;
      let inUse = false;

      if (iType === "medicine") {
        if (selectedNdc == null) {
          setPageError("Inventory: select a medicine.");
          return;
        }
        const med = medicines.find((m) => m.ndc === selectedNdc);
        if (!med) {
          setPageError("Inventory: selected medicine not found.");
          return;
        }
        displayName = med.medicineName;
        ndc = med.ndc;
        equipmentID = null;
        inUse = false; // backend should force/ignore for medicine anyway
      } else {
        if (selectedEquipmentID == null) {
          setPageError("Inventory: select equipment.");
          return;
        }
        const eq = equipment.find((e) => e.equipmentID === selectedEquipmentID);
        if (!eq) {
          setPageError("Inventory: selected equipment not found.");
          return;
        }
        displayName = eq.equipmentType;
        ndc = null;
        equipmentID = eq.equipmentID;
        inUse = iInUse;
      }

      const payload: InventoryCreate = {
        inventoryType: iType,
        quantity: iQty,
        itemDescription: desc.length ? desc : null,
        inUse,
        ndc,
        equipmentID,
        displayName, // backend can recompute/override
      };

      setLoading(true);
      try {
        await createInventoryItem(payload);
        setIType("medicine");
        setSelectedNdc(null);
        setSelectedEquipmentID(null);
        setIQty(1);
        setIDesc("");
        setIInUse(false);
        await refreshAll();
      } catch (err) {
        setPageError(errMsg(err));
        setLoading(false);
      }
    }

    async function handleDeleteItem(itemID: number) {
      setPageError("");
      setLoading(true);
      try {
        await deleteInventoryItem(itemID);
        await refreshAll();
      } catch (err) {
        setPageError(errMsg(err));
        setLoading(false);
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

              <label className="label">Staff Number</label>
              <input
                className="input"
                placeholder="Optional (e.g., 512-555-0101)"
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

              <label className="label">Position</label>
              <select
                className="input"
                value={sPosition}
                onChange={(e) => setSPosition(e.target.value as StaffPosition)}
                disabled={loading}
              >
                {STAFF_POSITION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>

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
                      Position: {s.position}
                      {s.email ? ` · ${s.email}` : ""}
                      {s.StaffNumber ? ` · ${s.StaffNumber}` : ""}
                    </div>
                  </div>
                  <div className="row-actions">
                    <button className="btn danger" type="button" onClick={() => handleDeleteStaff(s.staffID)} disabled={loading}>
                      Delete
                    </button>
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
                  <div className="row-actions">
                    <button className="btn danger" type="button" onClick={() => handleDeleteRoom(r.roomNumber)} disabled={loading}>
                      Delete
                    </button>
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
              <label className="label">Category</label>
              <select className="input" value={iType} onChange={(e) => handleInventoryTypeChange(e.target.value as InventoryType)} disabled={loading}>
                {INVENTORY_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>

              {iType === "medicine" ? (
                <>
                  <label className="label">Medicine</label>
                  <select
                    className="input"
                    value={selectedNdc ?? ""}
                    onChange={(e) => setSelectedNdc(e.target.value ? Number(e.target.value) : null)}
                    disabled={loading}
                  >
                    <option value="">Select medicine</option>
                    {medicinesSorted.map((m) => (
                      <option key={m.ndc} value={m.ndc}>
                        {m.medicineName}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <label className="label">Equipment</label>
                  <select
                    className="input"
                    value={selectedEquipmentID ?? ""}
                    onChange={(e) => setSelectedEquipmentID(e.target.value ? Number(e.target.value) : null)}
                    disabled={loading}
                  >
                    <option value="">Select equipment</option>
                    {equipmentSorted.map((eq) => (
                      <option key={eq.equipmentID} value={eq.equipmentID}>
                        {eq.equipmentType}
                      </option>
                    ))}
                  </select>
                </>
              )}

              <label className="label">Quantity</label>
              <input className="input" type="number" min={0} value={iQty} onChange={(e) => setIQty(Number(e.target.value))} disabled={loading} />

              <label className="label">Description</label>
              <input className="input" placeholder="Optional" value={iDesc} onChange={(e) => setIDesc(e.target.value)} disabled={loading} />

              {iType === "equipment" ? (
                <label className="checkboxRow">
                  <input type="checkbox" checked={iInUse} onChange={(e) => setIInUse(e.target.checked)} disabled={loading} />
                  In use
                </label>
              ) : null}

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
                      Type: {it.inventoryType} · Qty: {it.quantity}
                      {it.inventoryType === "equipment" ? ` · In use: ${it.inUse ? "yes" : "no"}` : ""}
                    </div>
                    {it.itemDescription ? <div className="row-desc">{it.itemDescription}</div> : null}
                  </div>

                  <div className="row-actions">
                    <button className="btn danger" type="button" onClick={() => handleDeleteItem(it.itemID)} disabled={loading}>
                      Delete
                    </button>
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
