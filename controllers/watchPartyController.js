import WatchParty from "../models/WatchParty.js";
import User from "../models/User.js";

export const createWatchParty = async (req, res) => {
  try {
    const { videoUrl, videoTitle, isPublic } = req.body;
    
    if (!videoUrl) {
      return res.status(400).json({ 
        success: false, 
        message: "Video URL is required" 
      });
    }

    const watchParty = await WatchParty.create({
      host: req.user._id,
      videoUrl: videoUrl.trim(),
      videoTitle: videoTitle?.trim() || "",
      isPublic: isPublic !== undefined ? isPublic : true,
      participants: [{ user: req.user._id, isActive: true }],
    });

    await WatchParty.findById(watchParty._id)
      .populate("host", "username email avatar")
      .populate("participants.user", "username email avatar")
      .populate("chatMessages.user", "username");

    res.status(201).json({
      success: true,
      message: "Watch party created",
      watchParty,
    });
  } catch (error) {
    console.error("createWatchParty:", error.message);
    res.status(500).json({ 
      success: false, 
      message: "Failed to create watch party" 
    });
  }
};

export const joinWatchParty = async (req, res) => {
  try {
    const { roomId } = req.params;
    
    const watchParty = await WatchParty.findOne({ roomId })
      .populate("host", "username email avatar")
      .populate("participants.user", "username email avatar");

    if (!watchParty) {
      return res.status(404).json({ 
        success: false, 
        message: "Watch party not found" 
      });
    }

    const isAlreadyParticipant = watchParty.participants.some(
      (p) => p.user._id.toString() === req.user._id.toString()
    );

    if (!isAlreadyParticipant) {
      watchParty.participants.push({ user: req.user._id });
      await watchParty.save();
      
      await watchParty.populate("participants.user", "username email avatar");
    }

    res.status(200).json({
      success: true,
      message: "Joined watch party",
      watchParty,
    });
  } catch (error) {
    console.error("joinWatchParty:", error.message);
    res.status(500).json({ 
      success: false, 
      message: "Failed to join watch party" 
    });
  }
};

export const getWatchParty = async (req, res) => {
  try {
    const { roomId } = req.params;
    
    const watchParty = await WatchParty.findOne({ roomId })
      .populate("host", "username email avatar")
      .populate("participants.user", "username email avatar");

    if (!watchParty) {
      return res.status(404).json({ 
        success: false, 
        message: "Watch party not found" 
      });
    }

    res.status(200).json({
      success: true,
      watchParty,
    });
  } catch (error) {
    console.error("getWatchParty:", error.message);
    res.status(500).json({ 
      success: false, 
      message: "Failed to get watch party" 
    });
  }
};

export const updateWatchPartyState = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { currentTime, isPlaying } = req.body;
    
    const watchParty = await WatchParty.findOne({ roomId });

    if (!watchParty) {
      return res.status(404).json({ 
        success: false, 
        message: "Watch party not found" 
      });
    }

    if (watchParty.host.toString() !== req.user._id.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: "Only host can update watch party state" 
      });
    }

    if (typeof currentTime === "number") {
      watchParty.currentTime = currentTime;
    }
    
    if (typeof isPlaying === "boolean") {
      watchParty.isPlaying = isPlaying;
    }

    watchParty.lastSyncAt = new Date();
    await watchParty.save();

    res.status(200).json({
      success: true,
      message: "Watch party state updated",
      watchParty: {
        currentTime: watchParty.currentTime,
        isPlaying: watchParty.isPlaying,
        lastSyncAt: watchParty.lastSyncAt,
      },
    });
  } catch (error) {
    console.error("updateWatchPartyState:", error.message);
    res.status(500).json({ 
      success: false, 
      message: "Failed to update watch party state" 
    });
  }
};

export const updateWatchPartyPrivacy = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { isPublic } = req.body;
    
    const watchParty = await WatchParty.findOne({ roomId });

    if (!watchParty) {
      return res.status(404).json({ 
        success: false, 
        message: "Watch party not found" 
      });
    }

    if (watchParty.host.toString() !== req.user._id.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: "Only host can update privacy settings" 
      });
    }

    watchParty.isPublic = isPublic;
    await watchParty.save();

    res.status(200).json({
      success: true,
      message: "Privacy settings updated",
      watchParty: {
        isPublic: watchParty.isPublic,
      },
    });
  } catch (error) {
    console.error("updateWatchPartyPrivacy:", error.message);
    res.status(500).json({ 
      success: false, 
      message: "Failed to update privacy settings" 
    });
  }
};

export const addChatMessage = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { message } = req.body;
    
    if (!message || !message.trim()) {
      return res.status(400).json({ 
        success: false, 
        message: "Message is required" 
      });
    }

    const watchParty = await WatchParty.findOne({ roomId });

    if (!watchParty) {
      return res.status(404).json({ 
        success: false, 
        message: "Watch party not found" 
      });
    }

    const isParticipant = watchParty.participants.some(
      p => p.user.toString() === req.user._id.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({ 
        success: false, 
        message: "You are not a participant" 
      });
    }

    const chatMessage = {
      user: req.user._id,
      username: req.user?.username || "Anonymous",
      message: message.trim(),
      timestamp: new Date(),
    };

    await WatchParty.updateOne(
      { roomId },
      { 
        $push: { chatMessages: chatMessage }
      }
    );

    res.status(201).json({
      success: true,
      message: "Message sent",
      chatMessage,
    });
  } catch (error) {
    console.error("addChatMessage:", error.message);
    res.status(500).json({ 
      success: false, 
      message: "Failed to send message" 
    });
  }
};
