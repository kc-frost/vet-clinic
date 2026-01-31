// Import the Router class from Express to create modular route handlers
import { Router } from "express";
const router = Router();

// POST /api/auth/login
// This route will eventually handle user login requests.
router.post("/login", async (req, res) => {
  res.status(501).json({ message: "Login not implemented yet." });
});

// POST /api/auth/register
// This route will eventually handle new user registration.
router.post("/register", async (req, res) => {
  res.status(501).json({ message: "Register not implemented yet." });
});
// Export the router so it can be used in the main application
export default router;
