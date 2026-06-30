import express from "express";
import {
  createConversation,
  getMessages,
  listConversations,
} from "../controllers/conversationController.js";
import { authenticate } from "../middleware/authenticate.js";

const router = express.Router();

router.use(authenticate);

router.get("/", listConversations);
router.post("/", createConversation);
router.get("/:id/messages", getMessages);

export default router;
