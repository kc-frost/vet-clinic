import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import session from "express-session";
import { pool } from "./db.js";

import inventoryRoutes from "./routes/inventory.js";
import roomsRoutes from "./routes/rooms.js";
import staffRoutes from "./routes/staff.js";
import staffAvailabilityRoutes from "./routes/staffAvailability.js";
import resourcesRoutes from "./routes/resources.js";
import authRoutes from "./routes/auth.js";
import medicineRoutes from "./routes/medicine.js";
import equipmentRoutes from "./routes/equipment.js";

import appointmentsRoutes from "./routes/appointments.js";
import reservationsRoutes from "./routes/reservations.js";
import usersRoutes from "./routes/users.js";
import appointmentIssuesRoutes from "./routes/appointmentIssues.js";

import adminAnalyticsRoutes from "./routes/adminAnalytics.js";

import path from "path";
import profileRoutes from "./routes/profile.js";
import { startNotificationScheduler } from "./lib/notifications.js";

dotenv.config();

const app = express();

app.set("trust proxy", 1);

app.use(cors({
	origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
	credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
	name: "vet.sid",
	secret: process.env.SESSION_SECRET || "dev_secret_change_me",
	resave: false,
	saveUninitialized: false,
	cookie: {
		httpOnly: true,
		sameSite: "lax",
		secure: false,
		maxAge: 1000 * 60 * 60 * 24 * 7,
	},
}));

app.get("/api/db-test", async (_req, res) => {
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
app.use("/api/staff", staffAvailabilityRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/resources", resourcesRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/medicine", medicineRoutes);
app.use("/api/equipment", equipmentRoutes);

app.use("/api/appointments", appointmentsRoutes);
app.use("/api/reservations", reservationsRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/appointment-issues", appointmentIssuesRoutes);

app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));
app.use("/api/profile", profileRoutes);

app.use("/api/admin/analytics", adminAnalyticsRoutes);

// scheduler starts once when the api boots
startNotificationScheduler();

const port = process.env.PORT || 3001;
app.listen(port, "127.0.0.1", () => {
	console.log("API running on port", port);
});