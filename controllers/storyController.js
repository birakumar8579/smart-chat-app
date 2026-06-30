import Story from "../models/Story.js";
import User from "../models/User.js";
import { uploadDir } from "../middleware/uploadMessage.js";

export const createStory = async (req, res) => {
  try {
    console.log("Story upload request:", {
      file: req.file?.originalname,
      size: req.file?.size,
      mimetype: req.file?.mimetype,
      body: req.body
    });

    if (!req.file) {
      console.error("No file uploaded in request");
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const { caption, privacy } = req.body;
    const mediaUrl = `/uploads/${req.file.filename}`;
    const mediaType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';

    // WhatsApp-style: Stories expire after 24 hours by default
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const story = new Story({
      userId: req.user._id,
      mediaUrl,
      mediaType,
      caption: caption || "",
      privacy: privacy || 'all', // Default to all users
      expiresAt,
    });

    await story.save();
    console.log("Story saved successfully:", story._id);

    const populatedStory = await Story.findById(story._id).populate('userId', 'username avatar');
    res.status(201).json({ 
      success: true, 
      story: populatedStory
    });
  } catch (error) {
    console.error("createStory error:", error);
    // Return safe fallback instead of crashing
    res.status(500).json({ success: false, message: "Failed to create story: " + error.message });
  }
};

export const getStories = async (req, res) => {
  try {
    const stories = await Story.find({
      expiresAt: { $gt: new Date() },
    })
    .populate('userId', 'username avatar isOnline')
    .populate('views.userId', 'username avatar')
    .populate('replies.userId', 'username avatar')
    .populate('reactions.userId', 'username avatar')
    .sort({ createdAt: -1 });

    // Group stories by user
    const storiesByUser = {};
    stories.forEach(story => {
      if (!storiesByUser[story.userId._id]) {
        storiesByUser[story.userId._id] = {
          user: story.userId,
          stories: [],
        };
      }
      storiesByUser[story.userId._id].stories.push(story);
    });

    res.status(200).json({ 
      success: true, 
      stories: Object.values(storiesByUser)
    });
  } catch (error) {
    console.error("getStories:", error.message);
    // Return safe fallback instead of crashing
    res.status(200).json({ success: true, stories: [] }); // Return empty array instead of error
  }
};

export const viewStory = async (req, res) => {
  try {
    const { id } = req.params;
    
    const story = await Story.findById(id);
    if (!story) {
      return res.status(404).json({ success: false, message: "Story not found" });
    }

    // Add user to views if not already viewed
    const alreadyViewed = story.views.some(view => 
      view.userId.toString() === req.user._id.toString()
    );

    if (!alreadyViewed) {
      story.views.push({ userId: req.user._id });
      await story.save();
    }

    // Return populated story with viewers data
    const populatedStory = await Story.findById(storyId)
      .populate('userId', 'username avatar')
      .populate('views.userId', 'username avatar')
      .populate('replies.userId', 'username avatar')
      .populate('reactions.userId', 'username avatar');

    res.status(200).json({ success: true, story: populatedStory });
  } catch (error) {
    console.error("viewStory:", error.message);
    res.status(500).json({ success: false, message: "Failed to view story" });
  }
};

export const replyToStory = async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;
    
    const story = await Story.findById(id);
    if (!story) {
      return res.status(404).json({ success: false, message: "Story not found" });
    }

    // Add reply to story
    const reply = {
      userId: req.user._id,
      text: text.trim(),
      createdAt: new Date()
    };

    if (!story.replies) {
      story.replies = [];
    }
    story.replies.push(reply);
    await story.save();

    // Populate reply with user info
    const populatedStory = await Story.findById(storyId).populate('replies.userId', 'username avatar');

    res.status(200).json({ 
      success: true, 
      reply: populatedStory.replies[populatedStory.replies.length - 1]
    });
  } catch (error) {
    console.error("replyToStory:", error.message);
    res.status(500).json({ success: false, message: "Failed to reply to story" });
  }
};

export const reactToStory = async (req, res) => {
  try {
    const { id } = req.params;
    const { emoji } = req.body;
    
    const story = await Story.findById(id);
    if (!story) {
      return res.status(404).json({ success: false, message: "Story not found" });
    }

    // Check if user already reacted
    if (!story.reactions) {
      story.reactions = [];
    }

    const existingReactionIndex = story.reactions.findIndex(
      reaction => reaction.userId.toString() === req.user._id.toString()
    );

    if (existingReactionIndex !== -1) {
      // Update existing reaction
      story.reactions[existingReactionIndex].emoji = emoji;
      story.reactions[existingReactionIndex].createdAt = new Date();
    } else {
      // Add new reaction
      story.reactions.push({
        userId: req.user._id,
        emoji,
        createdAt: new Date()
      });
    }

    await story.save();

    // Populate reaction with user info
    const populatedStory = await Story.findById(storyId).populate('reactions.userId', 'username avatar');

    res.status(200).json({ 
      success: true, 
      reaction: populatedStory.reactions.find(
        r => r.userId.toString() === req.user._id.toString()
      )
    });
  } catch (error) {
    console.error("reactToStory:", error.message);
    res.status(500).json({ success: false, message: "Failed to react to story" });
  }
};

export const deleteStory = async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log("Delete request for story:", id);
    console.log("CurrentUser:", req.user._id);
    
    const story = await Story.findById(id);
    if (!story) {
      return res.status(404).json({ success: false, message: "Story not found" });
    }

    console.log("StoryOwner:", story.userId.toString());
    console.log("StoryOwner type:", typeof story.userId.toString());
    console.log("CurrentUser type:", typeof req.user._id.toString());

    // Check if user is the owner
    if (story.userId.toString() !== req.user._id.toString()) {
      console.log("Ownership check failed");
      return res.status(403).json({ success: false, message: "Not authorized to delete this story" });
    }

    console.log("Ownership check passed");

    // Delete file from filesystem
    const fs = await import('fs');
    const filePath = `${uploadDir}${story.mediaUrl.replace('/uploads', '')}`;
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await Story.findByIdAndDelete(id);

    console.log("Story deleted successfully");
    res.status(200).json({ success: true, message: "Story deleted successfully" });
  } catch (error) {
    console.error("deleteStory:", error.message);
    res.status(500).json({ success: false, message: "Failed to delete story" });
  }
};
