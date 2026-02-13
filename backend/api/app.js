import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { pool } from "./db.js";

import inventoryRoutes from "./routes/inventory.js";
import roomsRoutes from "./routes/rooms.js";
import staffRoutes from "./routes/staff.js";
import resourcesRoutes from "./routes/resources.js";
import authRoutes from "./routes/auth.js";
import medicineRoutes from "./routes/medicine.js";
import equipmentRoutes from "./routes/equipment.js";

import appointmentsRoutes from "./routes/appointments.js";   // view page
import reservationsRoutes from "./routes/reservations.js";   // form flow

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/db-test", async (req, res) => {
  try {
    const conn = await pool.getConnection();
    conn.release();
    res.json({ connected: true });
  } catch (e) {
    res.status(500).json({ connected: false, error: e.message });
  }
});

app.use("/api/inventory", inventoryRoutes);
app.use("/api/rooms", roomsRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/resources", resourcesRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/medicine", medicineRoutes);
app.use("/api/equipment", equipmentRoutes);

// split responsibilities
app.use("/api/appointments", appointmentsRoutes);   // list/delete for view page
app.use("/api/reservations", reservationsRoutes);   // availability/create for form

const port = process.env.PORT || 3001;
app.listen(port, "127.0.0.1", () => {
  console.log("API running on port", port);
});
