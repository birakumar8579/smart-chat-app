import User from "../models/User.js";
import onlineUsers from "../services/userStatus.js";

export const searchUsers = async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (q.length < 1) {
      return res.status(200).json({ success: true, users: [] });
    }
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const users = await User.find({
      _id: { $ne: req.user._id },
      $or: [{ username: regex }, { email: regex }],
    })
      .select("username email avatar bio isOnline lastSeen")
      .limit(20)
      .lean();

    const usersWithStatus = users.map(user => ({
      ...user,
      isOnline: onlineUsers.has(user._id.toString()),
    }));

    res.status(200).json({ success: true, users: usersWithStatus });
  } catch (error) {
    console.error("searchUsers:", error.message);
    res.status(500).json({ success: false, message: "Search failed" });
  }
};

export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.params.id || req.user._id)
      .select("username email avatar bio isOnline lastSeen createdAt")
      .lean();

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const userWithStatus = {
      ...user,
      isOnline: onlineUsers.has(user._id.toString()),
    };

    res.status(200).json({ success: true, user: userWithStatus });
  } catch (error) {
    console.error("getProfile:", error.message);
    res.status(500).json({ success: false, message: "Failed to get profile" });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { username, bio, avatar } = req.body;
    const updates = {};

    if (username) updates.username = username.trim();
    if (bio !== undefined) updates.bio = bio.trim();
    
    // Handle base64 avatar upload
    if (avatar !== undefined) {
      if (avatar.startsWith('data:image/')) {
        // Check base64 size (rough estimate)
        const base64Length = avatar.length;
        const fileSizeKB = Math.round(base64Length * 0.75 / 1024); // Rough estimate
        
        if (fileSizeKB > 5 * 1024) { // 5MB limit
          return res.status(413).json({ 
            success: false, 
            message: "Avatar image too large. Please upload an image smaller than 5MB." 
          });
        }
        
        updates.avatar = avatar;
      } else {
        // It's a URL string
        updates.avatar = avatar;
      }
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updates,
      { new: true, runValidators: true }
    ).select("username email avatar bio");

    res.status(200).json({ success: true, user });
  } catch (error) {
    console.error("updateProfile:", error.message);
    res.status(500).json({ success: false, message: "Failed to update profile" });
  }
};
