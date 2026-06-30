import express from "express";
import { handleMessageUpload } from "../controllers/messageUploadController.js";
import { authenticate } from "../middleware/authenticate.js";
import { uploadMessageFile } from "../middleware/uploadMessage.js";

const router = express.Router();

const runUpload = (req, res, next) => {
  uploadMessageFile.single("file")(req, res, (err) => {
    if (err) {
      console.error("[upload] multer error:", err.message);
      return res.status(400).json({ success: false, message: err.message || "Invalid file" });
    }
    return next();
  });
};

router.post("/upload", authenticate, (req, res, next) => {
  console.log("[upload] file upload start");
  next();
}, runUpload, handleMessageUpload);

export default router;
