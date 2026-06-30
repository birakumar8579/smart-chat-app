import mongoose from "mongoose";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import onlineUsers from "../services/userStatus.js";

const memberPopulate = { path: "members", select: "username email" };

function conversationTitle(conv, currentUserId) {
  if (conv.type === "group") {
    return conv.name?.trim() || "Group";
  }
  const other = conv.members.find((m) => m._id.toString() !== currentUserId.toString());
  return other?.username || "Chat";
}

export const listConversations = async (req, res) => {
  try {
    const convs = await Conversation.find({ members: req.user._id })
      .populate(memberPopulate)
      .sort({ lastMessageAt: -1 })
      .lean();

    const payload = convs.map((c) => ({
      ...c,
      title: conversationTitle(c, req.user._id),
      members: c.members?.map(m => ({
        ...m,
        isOnline: onlineUsers.has(m._id.toString()),
        lastSeen: m.lastSeen,
      })),
    }));

    res.status(200).json({ success: true, conversations: payload });
  } catch (error) {
    console.error("listConversations:", error.message);
    res.status(500).json({ success: false, message: "Failed to load conversations" });
  }
};

export const createConversation = async (req, res) => {
  try {
    const { type, peerId, name, memberIds } = req.body;
    const uid = req.user._id;

    if (type === "direct") {
      if (!peerId) {
        return res.status(400).json({ success: false, message: "peerId is required for direct chat" });
      }
      if (peerId === uid.toString()) {
        return res.status(400).json({ success: false, message: "Cannot chat with yourself" });
      }
      const peerObjectId = new mongoose.Types.ObjectId(peerId);
      const existing = await Conversation.findOne({
        type: "direct",
        members: { $all: [uid, peerObjectId] },
        $expr: { $eq: [{ $size: "$members" }, 2] },
      }).populate(memberPopulate);

      if (existing) {
        const obj = existing.toObject();
        return res.status(200).json({
          success: true,
          conversation: { ...obj, title: conversationTitle(obj, uid) },
        });
      }

      const conv = await Conversation.create({
        type: "direct",
        name: "",
        members: [uid, peerObjectId],
        createdBy: uid,
        lastMessageAt: new Date(),
      });
      const populated = await Conversation.findById(conv._id).populate(memberPopulate).lean();
      return res.status(201).json({
        success: true,
        conversation: { ...populated, title: conversationTitle(populated, uid) },
      });
    }

    if (type === "group") {
      const groupName = (name || "").trim();
      if (!groupName) {
        return res.status(400).json({ success: false, message: "Group name is required" });
      }
      const ids = Array.isArray(memberIds) ? memberIds.map((id) => new mongoose.Types.ObjectId(id)) : [];
      const memberSet = new Map();
      memberSet.set(uid.toString(), uid);
      ids.forEach((id) => memberSet.set(id.toString(), id));
      const members = [...memberSet.values()];
      if (members.length < 2) {
        return res.status(400).json({ success: false, message: "Add at least one other member" });
      }

      const conv = await Conversation.create({
        type: "group",
        name: groupName,
        members,
        createdBy: uid,
        lastMessageAt: new Date(),
      });
      const populated = await Conversation.findById(conv._id).populate(memberPopulate).lean();
      return res.status(201).json({
        success: true,
        conversation: { ...populated, title: conversationTitle(populated, uid) },
      });
    }

    return res.status(400).json({ success: false, message: "Invalid conversation type" });
  } catch (error) {
    console.error("createConversation:", error.message);
    res.status(500).json({ success: false, message: "Failed to create conversation" });
  }
};

export const getMessages = async (req, res) => {
  try {
    const { id } = req.params;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;

    const conv = await Conversation.findOne({ _id: id, members: req.user._id });
    if (!conv) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    const [messages, total] = await Promise.all([
      Message.find({ conversation: id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("sender", "username email avatar isOnline lastSeen")
        .populate("readBy.user", "username")
        .populate("reactions.userId", "username")
        .populate("replyTo", "text sender fileName fileType")
        .populate("deliveredTo.user", "username")
        .lean(),
      Message.countDocuments({ conversation: id }),
    ]);

    res.status(200).json({
      success: true,
      messages: messages.reverse(),
      page,
      limit,
      total,
      hasMore: skip + messages.length < total,
    });
  } catch (error) {
    console.error("getMessages:", error.message);
    res.status(500).json({ success: false, message: "Failed to load messages" });
  }
};
