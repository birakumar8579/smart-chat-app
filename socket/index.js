import mongoose from "mongoose";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
import { socketAuthMiddleware } from "./socketAuth.js";
import onlineUsers from "../services/userStatus.js";

const registerSocketHandlers = (io) => {
  io.use(socketAuthMiddleware);

  io.on("connection", async (socket) => {
    const userId = socket.userId;
    socket.join(`user:${userId}`);

    // Update user online status
    await User.findByIdAndUpdate(userId, { isOnline: true, lastSeen: new Date() });
    onlineUsers.set(userId, socket.id);

    // Broadcast online status to friends
    const conversations = await Conversation.find({ members: userId });
    const friendIds = new Set();
    conversations.forEach(conv => {
      conv.members.forEach(member => {
        if (member.toString() !== userId) {
          friendIds.add(member.toString());
        }
      });
    });

    friendIds.forEach(friendId => {
      io.to(`user:${friendId}`).emit("user-status-changed", {
        userId,
        isOnline: true,
        lastSeen: new Date(),
      });
    });

    console.log(`[chat] socket connected id=${socket.id} user=${userId}`);

    socket.on("disconnect", async () => {
      const lastSeen = new Date();
      await User.findByIdAndUpdate(userId, { isOnline: false, lastSeen });
      onlineUsers.delete(userId);

      // Broadcast offline status
      friendIds.forEach(friendId => {
        io.to(`user:${friendId}`).emit("user-status-changed", {
          userId,
          isOnline: false,
          lastSeen,
        });
      });
    });

    socket.on("join-conversation", async (conversationId, cb) => {
      try {
        if (!conversationId) {
          cb?.({ ok: false, error: "conversationId required" });
          return;
        }
        const conv = await Conversation.findOne({
          _id: conversationId,
          members: socket.userId,
        });
        if (!conv) {
          cb?.({ ok: false, error: "Conversation not found" });
          return;
        }
        socket.join(`conv:${conversationId}`);
        console.log(`[chat] user ${socket.userId} joined conv ${conversationId}`);
        cb?.({ ok: true });
      } catch (err) {
        console.error("[chat] join-conversation:", err.message);
        cb?.({ ok: false, error: "Failed to join" });
      }
    });

    socket.on("leave-conversation", (conversationId) => {
      if (conversationId) socket.leave(`conv:${conversationId}`);
    });

    socket.on("send-message", async (payload, cb) => {
      try {
        const { conversationId, text, fileUrl, fileName, fileType, replyTo, messageType = "text" } = payload || {};
        const trimmed = (text || "").trim();
        const hasFile = !!(fileUrl && String(fileUrl).trim());
        if (!conversationId || (!trimmed && !hasFile)) {
          cb?.({ ok: false, error: "conversationId and text or file required" });
          return;
        }

        const conv = await Conversation.findOne({
          _id: conversationId,
          members: socket.userId,
        });
        if (!conv) {
          cb?.({ ok: false, error: "Not allowed" });
          return;
        }

        console.log(`[chat] message sent conv=${conversationId} user=${socket.userId}`);

        const msg = await Message.create({
          conversation: conversationId,
          sender: socket.userId,
          text: trimmed,
          fileUrl: hasFile ? String(fileUrl).trim() : "",
          fileName: hasFile ? String(fileName || "").slice(0, 512) : "",
          fileType: hasFile ? String(fileType || "").slice(0, 128) : "",
          messageType,
          replyTo: replyTo ? mongoose.Types.ObjectId(replyTo) : null,
        });

        // Mark as delivered to sender immediately
        await Message.findByIdAndUpdate(msg._id, {
          $push: {
            deliveredTo: {
              user: socket.userId,
              deliveredAt: new Date(),
            }
          }
        });

        const preview = trimmed || (hasFile ? `File: ${fileName || "attachment"}` : "");
        await Conversation.findByIdAndUpdate(conversationId, {
          lastMessageAt: new Date(),
          lastMessagePreview: preview.slice(0, 200),
        });

        const populated = await Message.findById(msg._id)
          .populate("sender", "username email avatar")
          .populate("readBy.user", "username")
          .populate("reactions.userId", "username")
          .populate("replyTo", "text sender")
          .populate("deliveredTo.user", "username")
          .lean();

        io.to(`conv:${conversationId}`).emit("new-message", {
          conversationId,
          message: populated,
        });
        cb?.({ ok: true, message: populated });
      } catch (err) {
        console.error("[chat] send-message:", err.message);
        cb?.({ ok: false, error: "Send failed" });
      }
    });

    socket.on("typing", (payload) => {
      const { conversationId, isTyping } = payload || {};
      if (!conversationId) return;
      socket.to(`conv:${conversationId}`).emit("typing", {
        conversationId,
        userId: socket.userId,
        username: socket.user?.username,
        isTyping: !!isTyping,
      });
    });

    socket.on("mark-read", async (payload, cb) => {
      try {
        const { conversationId, messageIds } = payload || {};
        if (!conversationId || !Array.isArray(messageIds)) {
          cb?.({ ok: false, error: "conversationId and messageIds required" });
          return;
        }

        const conv = await Conversation.findOne({ _id: conversationId, members: socket.userId });
        if (!conv) {
          cb?.({ ok: false, error: "Not allowed" });
          return;
        }

        const now = new Date();
        await Message.updateMany(
          {
            _id: { $in: messageIds },
            conversation: conversationId,
            sender: { $ne: socket.userId }, // Don't mark own messages as read
          },
          {
            $addToSet: {
              readBy: { user: socket.userId, readAt: now },
              deliveredTo: { user: socket.userId, deliveredAt: now }
            }
          }
        );

        io.to(`conv:${conversationId}`).emit("read-receipt", {
          conversationId,
          messageIds,
          readByUserId: socket.userId,
        });
        cb?.({ ok: true });
      } catch (err) {
        console.error("[chat] mark-read:", err.message);
        cb?.({ ok: false, error: "Mark read failed" });
      }
    });

    socket.on("edit-message", async (payload, cb) => {
      try {
        const { messageId, text } = payload || {};
        const trimmed = (text || "").trim();
        if (!messageId || !trimmed) {
          cb?.({ ok: false, error: "messageId and text required" });
          return;
        }

        const msg = await Message.findOneAndUpdate(
          { _id: messageId, sender: socket.userId, deleted: { $ne: true } },
          {
            text: trimmed,
            edited: true,
            editedAt: new Date(),
          },
          { new: true }
        ).populate("sender", "username email avatar")
         .populate("readBy.user", "username")
         .populate("reactions.userId", "username")
         .populate("replyTo", "text sender")
         .populate("deliveredTo.user", "username");

        if (!msg) {
          cb?.({ ok: false, error: "Message not found or not allowed" });
          return;
        }

        io.to(`conv:${msg.conversation}`).emit("message-edited", {
          conversationId: msg.conversation,
          message: msg,
        });
        cb?.({ ok: true, message: msg });
      } catch (err) {
        console.error("[chat] edit-message:", err.message);
        cb?.({ ok: false, error: "Edit failed" });
      }
    });

    socket.on("delete-message", async (payload, cb) => {
      try {
        const { messageId, forEveryone = false } = payload || {};
        if (!messageId) {
          cb?.({ ok: false, error: "messageId required" });
          return;
        }

        const msg = await Message.findOne({ _id: messageId, sender: socket.userId });
        if (!msg) {
          cb?.({ ok: false, error: "Message not found or not allowed" });
          return;
        }

        if (forEveryone) {
          await Message.findByIdAndUpdate(messageId, {
            deleted: true,
            deletedAt: new Date(),
            text: "",
            fileUrl: "",
            fileName: "",
            fileType: "",
          });
        } else {
          // For now, just mark as deleted for the user (could implement per-user deletion later)
          await Message.findByIdAndUpdate(messageId, {
            deleted: true,
            deletedAt: new Date(),
          });
        }

        io.to(`conv:${msg.conversation}`).emit("message-deleted", {
          conversationId: msg.conversation,
          messageId,
          deletedBy: socket.userId,
          forEveryone,
        });
        cb?.({ ok: true });
      } catch (err) {
        console.error("[chat] delete-message:", err.message);
        cb?.({ ok: false, error: "Delete failed" });
      }
    });

    socket.on("add-reaction", async (payload, cb) => {
      try {
        const { messageId, emoji } = payload || {};
        if (!messageId || !emoji) {
          cb?.({ ok: false, error: "messageId and emoji required" });
          return;
        }

        const msg = await Message.findOne({ _id: messageId, deleted: { $ne: true } });
        if (!msg) {
          cb?.({ ok: false, error: "Message not found" });
          return;
        }

        const conv = await Conversation.findOne({ _id: msg.conversation, members: socket.userId });
        if (!conv) {
          cb?.({ ok: false, error: "Not allowed" });
          return;
        }

        // Remove existing reaction from this user
        await Message.findByIdAndUpdate(messageId, {
          $pull: { reactions: { userId: socket.userId } }
        });

        // Add new reaction
        const updatedMsg = await Message.findByIdAndUpdate(
          messageId,
          {
            $push: { reactions: { userId: socket.userId, emoji } }
          },
          { new: true }
        ).populate("sender", "username email avatar")
         .populate("readBy.user", "username")
         .populate("reactions.userId", "username")
         .populate("replyTo", "text sender")
         .populate("deliveredTo.user", "username");

        io.to(`conv:${msg.conversation}`).emit("reaction-updated", {
          conversationId: msg.conversation,
          messageId,
          reactions: updatedMsg.reactions,
        });
        cb?.({ ok: true, message: updatedMsg });
      } catch (err) {
        console.error("[chat] add-reaction:", err.message);
        cb?.({ ok: false, error: "Reaction failed" });
      }
    });

    socket.on("call-user", async (payload, cb) => {
      try {
        const { conversationId, targetUserId, offer, callType } = payload || {};
        if (!conversationId || !offer) {
          cb?.({ ok: false, error: "conversationId and offer required" });
          return;
        }
        const conv = await Conversation.findOne({ _id: conversationId, members: socket.userId });
        if (!conv) {
          cb?.({ ok: false, error: "Not allowed" });
          return;
        }
        const memberIds = conv.members.map((m) => m.toString());
        const other = memberIds.find((id) => id !== socket.userId && (!targetUserId || id === targetUserId));
        if (!other) {
          cb?.({ ok: false, error: "No call target available" });
          return;
        }
        console.log(`[chat] call-user from=${socket.userId} to=${other} conv=${conversationId} callType=${callType}`);
        io.to(`user:${other}`).emit("incoming-call", {
          conversationId,
          fromUserId: socket.userId,
          fromUsername: socket.user?.username,
          offer,
          callType: callType || "audio",
        });
        cb?.({ ok: true });
      } catch (err) {
        console.error("[chat] call-user:", err.message);
        cb?.({ ok: false, error: "Call failed" });
      }
    });

    socket.on("accept-call", async (payload, cb) => {
      try {
        const { conversationId, toUserId, answer } = payload || {};
        if (!conversationId || !toUserId || !answer) {
          cb?.({ ok: false, error: "conversationId, toUserId and answer required" });
          return;
        }
        const conv = await Conversation.findOne({ _id: conversationId, members: socket.userId });
        if (!conv) {
          cb?.({ ok: false, error: "Not allowed" });
          return;
        }
        console.log(`[chat] accept-call from=${socket.userId} to=${toUserId} conv=${conversationId}`);
        io.to(`user:${toUserId}`).emit("call-accepted", {
          conversationId,
          fromUserId: socket.userId,
          answer,
        });
        cb?.({ ok: true });
      } catch (err) {
        console.error("[chat] accept-call:", err.message);
        cb?.({ ok: false, error: "Accept failed" });
      }
    });

    socket.on("reject-call", async (payload, cb) => {
      try {
        const { conversationId, toUserId } = payload || {};
        if (!conversationId || !toUserId) {
          cb?.({ ok: false, error: "conversationId and toUserId required" });
          return;
        }
        const conv = await Conversation.findOne({ _id: conversationId, members: socket.userId });
        if (!conv) {
          cb?.({ ok: false, error: "Not allowed" });
          return;
        }
        console.log(`[chat] reject-call from=${socket.userId} to=${toUserId} conv=${conversationId}`);
        io.to(`user:${toUserId}`).emit("call-rejected", {
          conversationId,
          fromUserId: socket.userId,
        });
        cb?.({ ok: true });
      } catch (err) {
        console.error("[chat] reject-call:", err.message);
        cb?.({ ok: false, error: "Reject failed" });
      }
    });

    socket.on("ice-candidate", async (payload, cb) => {
      try {
        const { conversationId, toUserId, candidate } = payload || {};
        if (!conversationId || !toUserId || !candidate) {
          cb?.({ ok: false, error: "conversationId, toUserId and candidate required" });
          return;
        }
        const conv = await Conversation.findOne({ _id: conversationId, members: socket.userId });
        if (!conv) {
          cb?.({ ok: false, error: "Not allowed" });
          return;
        }
        io.to(`user:${toUserId}`).emit("ice-candidate", {
          conversationId,
          fromUserId: socket.userId,
          candidate,
        });
        cb?.({ ok: true });
      } catch (err) {
        console.error("[chat] ice-candidate:", err.message);
        cb?.({ ok: false, error: "Ice candidate failed" });
      }
    });

    socket.on("end-call", async (payload, cb) => {
      try {
        const { conversationId, toUserId } = payload || {};
        if (!conversationId || !toUserId) {
          cb?.({ ok: false, error: "conversationId and toUserId required" });
          return;
        }
        const conv = await Conversation.findOne({ _id: conversationId, members: socket.userId });
        if (!conv) {
          cb?.({ ok: false, error: "Not allowed" });
          return;
        }
        console.log(`[chat] end-call from=${socket.userId} to=${toUserId} conv=${conversationId}`);
        io.to(`user:${toUserId}`).emit("end-call", {
          conversationId,
          fromUserId: socket.userId,
        });
        cb?.({ ok: true });
      } catch (err) {
        console.error("[chat] end-call:", err.message);
        cb?.({ ok: false, error: "End failed" });
      }
    });

    socket.on("toggle-reaction", async (payload, cb) => {
      try {
        const { conversationId, messageId, emoji } = payload || {};
        const em = (emoji || "").trim();
        if (!conversationId || !messageId || !em) {
          cb?.({ ok: false, error: "conversationId, messageId, emoji required" });
          return;
        }

        const conv = await Conversation.findOne({
          _id: conversationId,
          members: socket.userId,
        });
        if (!conv) {
          cb?.({ ok: false, error: "Not allowed" });
          return;
        }

        const m = await Message.findById(messageId);
        if (!m || m.conversation.toString() !== conversationId.toString()) {
          cb?.({ ok: false, error: "Message not found" });
          return;
        }

        const me = socket.userId;
        const idx = m.reactions.findIndex((r) => r.userId.toString() === me && r.emoji === em);
        if (idx >= 0) m.reactions.splice(idx, 1);
        else m.reactions.push({ userId: me, emoji: em });
        await m.save();
        await m.populate("reactions.userId", "username");

        io.to(`conv:${conversationId}`).emit("reaction-updated", {
          conversationId,
          messageId,
          reactions: m.reactions,
        });
        console.log(`[chat] reaction conv=${conversationId} msg=${messageId} emoji=${em}`);
        cb?.({ ok: true });
      } catch (err) {
        console.error("[chat] toggle-reaction:", err.message);
        cb?.({ ok: false, error: "Reaction failed" });
      }
    });

    // Watch Party Events
    socket.on("join-watch-party", async (payload, cb) => {
      try {
        const { roomId, userId } = payload || {};
        if (!roomId) {
          cb?.({ ok: false, error: "roomId required" });
          return;
        }

        const WatchParty = mongoose.model("WatchParty");
        const watchParty = await WatchParty.findOne({ roomId })
          .populate("host", "username email avatar")
          .populate("participants.user", "username email avatar");

        if (!watchParty) {
          cb?.({ ok: false, error: "Watch party not found" });
          return;
        }

        // Check if user is already a participant
        const existingParticipant = watchParty.participants.find(
          p => p.user._id.toString() === (userId || socket.userId)
        );

        let updatedParticipants = watchParty.participants;
        let userAdded = false;

        if (!existingParticipant) {
          // Add user to participants list
          const newParticipant = {
            user: userId ? await User.findById(userId) : socket.user,
            joinedAt: new Date(),
            isActive: true
          };
          
          updatedParticipants = [...watchParty.participants, newParticipant];
          userAdded = true;

          // Update database
          await WatchParty.updateOne(
            { roomId },
            { 
              $push: { participants: newParticipant },
              $set: { updatedAt: new Date() }
            }
          );

          console.log(`[watchparty] Added user ${userId || socket.userId} to participants list`);
        }

        socket.join(`watchparty:${roomId}`);
        console.log(`[watchparty] user ${userId || socket.userId} joined socket room watchparty:${roomId}`);

        // Broadcast to all participants
        io.to(`watchparty:${roomId}`).emit("participant-joined", {
          roomId,
          participant: {
            user: userId ? await User.findById(userId) : socket.user,
            joinedAt: new Date(),
          },
          participantCount: updatedParticipants.length,
          userAdded,
        });

        cb?.({ ok: true, watchParty: { ...watchParty, participants: updatedParticipants } });
      } catch (err) {
        console.error("[watchparty] join-room:", err.message);
        cb?.({ ok: false, error: "Failed to join watch party" });
      }
    });

    socket.on("leave-watch-party", async (payload, cb) => {
      try {
        const { roomId } = payload || {};
        if (!roomId) {
          cb?.({ ok: false, error: "roomId required" });
          return;
        }

        socket.leave(`watchparty:${roomId}`);
        console.log(`[watchparty] user ${socket.userId} left room ${roomId}`);

        io.to(`watchparty:${roomId}`).emit("participant-left", {
          roomId,
          userId: socket.userId,
          username: socket.user?.username,
        });

        cb?.({ ok: true });
      } catch (err) {
        console.error("[watchparty] leave-room:", err.message);
        cb?.({ ok: false, error: "Failed to leave watch party" });
      }
    });

    socket.on("watch-party-play", async (payload, cb) => {
      try {
        const { roomId, currentTime } = payload || {};
        if (!roomId) {
          cb?.({ ok: false, error: "roomId required" });
          return;
        }

        const WatchParty = mongoose.model("WatchParty");
        const watchParty = await WatchParty.findOne({ roomId });

        if (!watchParty || watchParty.host.toString() !== socket.userId.toString()) {
          cb?.({ ok: false, error: "Only host can control playback" });
          return;
        }

        await WatchParty.updateOne(
          { roomId },
          { 
            isPlaying: true, 
            currentTime: currentTime || 0,
            lastSyncAt: new Date()
          }
        );

        io.to(`watchparty:${roomId}`).emit("play", {
          roomId,
          currentTime: currentTime || 0,
          timestamp: new Date().toISOString(),
        });

        console.log(`[watchparty] play room=${roomId} time=${currentTime}`);
        cb?.({ ok: true });
      } catch (err) {
        console.error("[watchparty] play:", err.message);
        cb?.({ ok: false, error: "Play failed" });
      }
    });

    socket.on("watch-party-pause", async (payload, cb) => {
      try {
        const { roomId, currentTime } = payload || {};
        if (!roomId) {
          cb?.({ ok: false, error: "roomId required" });
          return;
        }

        const WatchParty = mongoose.model("WatchParty");
        const watchParty = await WatchParty.findOne({ roomId });

        if (!watchParty || watchParty.host.toString() !== socket.userId.toString()) {
          cb?.({ ok: false, error: "Only host can control playback" });
          return;
        }

        await WatchParty.updateOne(
          { roomId },
          { 
            isPlaying: false, 
            currentTime: currentTime || 0,
            lastSyncAt: new Date()
          }
        );

        io.to(`watchparty:${roomId}`).emit("pause", {
          roomId,
          currentTime: currentTime || 0,
          timestamp: new Date().toISOString(),
        });

        console.log(`[watchparty] pause room=${roomId} time=${currentTime}`);
        cb?.({ ok: true });
      } catch (err) {
        console.error("[watchparty] pause:", err.message);
        cb?.({ ok: false, error: "Pause failed" });
      }
    });

    socket.on("watch-party-seek", async (payload, cb) => {
      try {
        const { roomId, currentTime } = payload || {};
        if (!roomId || typeof currentTime !== "number") {
          cb?.({ ok: false, error: "roomId and currentTime required" });
          return;
        }

        const WatchParty = mongoose.model("WatchParty");
        const watchParty = await WatchParty.findOne({ roomId });

        if (!watchParty || watchParty.host.toString() !== socket.userId.toString()) {
          cb?.({ ok: false, error: "Only host can control playback" });
          return;
        }

        await WatchParty.updateOne(
          { roomId },
          { 
            currentTime,
            lastSyncAt: new Date()
          }
        );

        io.to(`watchparty:${roomId}`).emit("seek", {
          roomId,
          currentTime,
          timestamp: new Date().toISOString(),
        });

        console.log(`[watchparty] seek room=${roomId} time=${currentTime}`);
        cb?.({ ok: true });
      } catch (err) {
        console.error("[watchparty] seek:", err.message);
        cb?.({ ok: false, error: "Seek failed" });
      }
    });

    // RAVE-style Chat Events
    socket.on("watch-party-chat-message", async (payload, cb) => {
      try {
        const { roomId, message } = payload || {};
        if (!roomId || !message || !message.trim()) {
          cb?.({ ok: false, error: "roomId and message required" });
          return;
        }

        const WatchParty = mongoose.model("WatchParty");
        const watchParty = await WatchParty.findOne({ roomId });

        if (!watchParty) {
          cb?.({ ok: false, error: "Watch party not found" });
          return;
        }

        let isParticipant = watchParty.participants.some(
          p => p.user.toString() === socket.userId.toString()
        );

        // Auto-add user if not in participants list
        if (!isParticipant) {
          console.log(`[watchparty] Auto-adding user ${socket.userId} to participants list`);
          const newParticipant = {
            user: socket.userId,
            joinedAt: new Date(),
            isActive: true
          };
          
          await WatchParty.updateOne(
            { roomId },
            { 
              $push: { participants: newParticipant }
            }
          );
          
          // Update isParticipant status
          isParticipant = true;
        }

        const chatMessage = {
          user: socket.userId,
          username: socket.user?.username || "Anonymous",
          message: message.trim(),
          timestamp: new Date(),
        };

        await WatchParty.updateOne(
          { roomId },
          { 
            $push: { chatMessages: chatMessage }
          }
        );

        io.to(`watchparty:${roomId}`).emit("chat-message", {
          roomId,
          message: chatMessage,
        });

        console.log(`[watchparty] chat room=${roomId} user=${socket.user?.username}`);
        cb?.({ ok: true });
      } catch (err) {
        console.error("[watchparty] chat-message:", err.message);
        cb?.({ ok: false, error: "Failed to send message" });
      }
    });

    // Enhanced participant management
    socket.on("watch-party-leave", async (payload, cb) => {
      try {
        const { roomId } = payload || {};
        if (!roomId) {
          cb?.({ ok: false, error: "roomId required" });
          return;
        }

        const WatchParty = mongoose.model("WatchParty");
        await WatchParty.updateOne(
          { roomId },
          { 
            $pull: { 
              participants: { user: socket.userId } 
            }
          }
        );

        socket.leave(`watchparty:${roomId}`);
        
        io.to(`watchparty:${roomId}`).emit("user-left", {
          roomId,
          userId: socket.userId,
          username: socket.user?.username,
        });

        console.log(`[watchparty] user left room=${roomId} user=${socket.user?.username}`);
        cb?.({ ok: true });
      } catch (err) {
        console.error("[watchparty] leave:", err.message);
        cb?.({ ok: false, error: "Failed to leave room" });
      }
    });

    // Privacy settings update
    socket.on("watch-party-update-privacy", async (payload, cb) => {
      try {
        const { roomId, isPublic } = payload || {};
        if (!roomId || typeof isPublic !== "boolean") {
          cb?.({ ok: false, error: "roomId and isPublic required" });
          return;
        }

        const WatchParty = mongoose.model("WatchParty");
        const watchParty = await WatchParty.findOne({ roomId });

        if (!watchParty || watchParty.host.toString() !== socket.userId.toString()) {
          cb?.({ ok: false, error: "Only host can change privacy" });
          return;
        }

        await WatchParty.updateOne(
          { roomId },
          { isPublic }
        );

        io.to(`watchparty:${roomId}`).emit("privacy-updated", {
          roomId,
          isPublic,
        });

        console.log(`[watchparty] privacy updated room=${roomId} public=${isPublic}`);
        cb?.({ ok: true });
      } catch (err) {
        console.error("[watchparty] privacy:", err.message);
        cb?.({ ok: false, error: "Failed to update privacy" });
      }
    });
  });
};

export default registerSocketHandlers;
