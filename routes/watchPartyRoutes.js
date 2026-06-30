import express from "express";
import { 
  createWatchParty, 
  joinWatchParty, 
  getWatchParty, 
  updateWatchPartyState,
  updateWatchPartyPrivacy,
  addChatMessage
} from "../controllers/watchPartyController.js";
import { authenticate } from "../middleware/authenticate.js";

const router = express.Router();

router.use(authenticate);

router.post("/create", createWatchParty);
router.post("/join/:roomId", joinWatchParty);
router.get("/:roomId", getWatchParty);
router.patch("/:roomId/state", updateWatchPartyState);
router.patch("/:roomId/privacy", updateWatchPartyPrivacy);
router.post("/:roomId/chat", addChatMessage);

export default router;
