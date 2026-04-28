import express from "express";
import { requireAuth, requireStaff } from "../lib/authMiddleware.js";
import {
	getCustomerSummary,
	getFollowUpPrefill,
	getStaffSummary,
	finalizeSummary,
	saveDraftSummary,
} from "../lib/appointmentSummaryService.js";

const router = express.Router();

router.get("/staff/:appointmentID", requireStaff, async (req, res) => {
	try {
		const result = await getStaffSummary(req.session.userID, req.params.appointmentID);
		res.json(result);
	} catch (error) {
		res.status(error.status || 500).json({ error: error.message });
	}
});

router.put("/staff/:appointmentID", requireStaff, async (req, res) => {
	try {
		const result = await saveDraftSummary(req.session.userID, req.params.appointmentID, req.body);
		res.json(result);
	} catch (error) {
		res.status(error.status || 500).json({ error: error.message });
	}
});

router.post("/staff/:appointmentID/finalize", requireStaff, async (req, res) => {
	try {
		const result = await finalizeSummary(req.session.userID, req.params.appointmentID);
		res.json(result);
	} catch (error) {
		res.status(error.status || 500).json({ error: error.message });
	}
});

router.get("/staff/:appointmentID/follow-up-prefill", requireStaff, async (req, res) => {
	try {
		const result = await getFollowUpPrefill(req.session.userID, req.params.appointmentID);
		res.json(result);
	} catch (error) {
		res.status(error.status || 500).json({ error: error.message });
	}
});

router.get("/customer/:appointmentID", requireAuth, async (req, res) => {
	try {
		const result = await getCustomerSummary(req.session.userID, req.params.appointmentID);
		res.json(result);
	} catch (error) {
		res.status(error.status || 500).json({ error: error.message });
	}
});

export default router;