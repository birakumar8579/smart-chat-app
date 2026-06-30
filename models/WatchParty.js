import mongoose from "mongoose";

const chatMessageSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  username: {
    type: String,
    required: true,
    trim: true,
  },
  message: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500,
  },
  timestamp: {
    type: Date,
    default: () => new Date(),
  },
});

const watchPartySchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      required: true,
      unique: true,
      default: () => Math.random().toString(36).substring(2, 12).toUpperCase(),
    },
    host: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    participants: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        joinedAt: {
          type: Date,
          default: () => new Date(),
        },
        isActive: {
          type: Boolean,
          default: true,
        },
      },
    ],
    videoUrl: {
      type: String,
      required: true,
      trim: true,
    },
    videoTitle: {
      type: String,
      default: "",
      trim: true,
    },
    currentTime: {
      type: Number,
      default: 0,
    },
    isPlaying: {
      type: Boolean,
      default: false,
    },
    lastSyncAt: {
      type: Date,
      default: () => new Date(),
    },
    isPublic: {
      type: Boolean,
      default: true,
    },
    maxParticipants: {
      type: Number,
      default: 50,
    },
    chatMessages: [chatMessageSchema],
  },
  { timestamps: true }
);


const WatchParty = mongoose.model("WatchParty", watchPartySchema);
export default WatchParty;
