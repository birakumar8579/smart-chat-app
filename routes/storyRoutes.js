import express from "express";
import Story from "../models/Story.js";
import { authenticate } from "../middleware/authenticate.js";
import { uploadMessageFile } from "../middleware/uploadMessage.js";

const router = express.Router();

router.use(authenticate);

// Upload story media
router.post("/", uploadMessageFile.single("media"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const { caption } = req.body;
    const mediaUrl = `/uploads/${req.file.filename}`;
    const mediaType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';

    const story = new Story({
      userId: req.user._id,
      mediaUrl,
      mediaType,
      caption: caption || "",
    });

    await story.save();
    res.status(201).json({ success: true, story });
  } catch (err) {
    console.error("CREATE STORY ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Get all active stories
router.get("/", async (req, res) => {
  try {
    const stories = await Story.find({
      expiresAt: { $gt: new Date() },
    })
    .populate('userId', 'username avatar isOnline')
    .populate('views.userId', 'username avatar')
    .sort({ createdAt: -1 });

    // Group stories by user for frontend StoryBar
    const userStoryGroups = {};
    
    stories.forEach(story => {
      if (!story.userId) return;
      
      const userId = story.userId._id.toString();
      if (!userStoryGroups[userId]) {
        userStoryGroups[userId] = {
          user: {
            _id: story.userId._id,
            username: story.userId.username || "Unknown",
            avatar: story.userId.avatar,
            isOnline: story.userId.isOnline || false
          },
          stories: []
        };
      }
      
      userStoryGroups[userId].stories.push({
        _id: story._id,
        userId: story.userId,
        mediaUrl: story.mediaUrl,
        mediaType: story.mediaType,
        caption: story.caption,
        views: story.views,
        createdAt: story.createdAt,
        expiresAt: story.expiresAt
      });
    });

    const groupedStories = Object.values(userStoryGroups);

    res.json({ success: true, stories: groupedStories });
  } catch (err) {
    console.error("GET STORIES ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Mark story as viewed
router.post("/:id/view", async (req, res) => {
  try {
    if (!req.params.id) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    const story = await Story.findById(req.params.id);

    if (!story) {
      return res.status(404).json({ message: "Story not found" });
    }

    const alreadyViewed = story.views?.some(
      v => v.userId.toString() === req.user._id.toString()
    );

    if (!alreadyViewed) {
      story.views = story.views || [];
      story.views.push({ userId: req.user._id });
      await story.save();
    }

    res.json({ success: true });
  } catch (err) {
    console.error("VIEW ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Reply to story
router.post("/:id/reply", async (req, res) => {
  try {
    const { text } = req.body;
    const story = await Story.findById(req.params.id);

    if (!story) {
      return res.status(404).json({ message: "Story not found" });
    }

    if (!text || !text.trim()) {
      return res.status(400).json({ message: "Reply text is required" });
    }

    // Add reply to story (simplified - in production you'd have a replies array)
    console.log("Reply to story:", req.params.id, "by user:", req.user._id, "text:", text);

    res.json({ success: true });
  } catch (err) {
    console.error("REPLY ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// React to story
router.post("/:id/react", async (req, res) => {
  try {
    const { emoji } = req.body;
    const story = await Story.findById(req.params.id);

    if (!story) {
      return res.status(404).json({ message: "Story not found" });
    }

    if (!emoji) {
      return res.status(400).json({ message: "Emoji is required" });
    }

    // Add reaction to story (simplified - in production you'd have a reactions array)
    console.log("React to story:", req.params.id, "by user:", req.user._id, "emoji:", emoji);

    res.json({ success: true });
  } catch (err) {
    console.error("REACT ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Delete own story
router.delete("/:id", async (req, res) => {
  try {
    const story = await Story.findById(req.params.id);

    if (!story) {
      return res.status(404).json({ message: "Story not found" });
    }

    if (story.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    await Story.findByIdAndDelete(req.params.id);

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
