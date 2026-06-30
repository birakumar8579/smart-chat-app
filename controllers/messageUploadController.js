export const handleMessageUpload = (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const host = req.get("host") || `localhost:${process.env.PORT || 3001}`;
    const protocol = req.protocol === "https" ? "https" : "http";
    const base = process.env.PUBLIC_BASE_URL || `${protocol}://${host}`;
    const fileUrl = `${base}/uploads/${req.file.filename}`;

    console.log("[upload] file upload success", req.file.originalname, req.file.mimetype);

    return res.status(200).json({
      success: true,
      fileUrl,
      fileType: req.file.mimetype,
      fileName: req.file.originalname,
    });
  } catch (error) {
    console.error("[upload] error:", error.message);
    return res.status(500).json({ success: false, message: "Upload failed" });
  }
};
