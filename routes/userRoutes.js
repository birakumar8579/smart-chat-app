import express from "express";
import { searchUsers, getProfile, updateProfile } from "../controllers/userController.js";
import { authenticate } from "../middleware/authenticate.js";

const router = express.Router();

router.use(authenticate);

router.get("/search", searchUsers);
router.get("/profile", getProfile);
router.get("/profile/:id", getProfile);
router.put("/profile", updateProfile);

export default router;
