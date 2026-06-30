import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const socketAuthMiddleware = async (socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.query?.token ||
      (socket.handshake.headers?.authorization?.startsWith("Bearer ")
        ? socket.handshake.headers.authorization.slice(7)
        : null);

    if (!token) {
      console.warn("[socket-auth] No token provided");
      return next(new Error("Unauthorized"));
    }

    const secret = process.env.JWT_SECRET || "smartchat-dev-secret-change-in-production";
    if (!secret) {
      console.error("[socket-auth] JWT_SECRET not configured");
      return next(new Error("Server configuration error"));
    }

    const decoded = jwt.verify(token, secret);
    const user = await User.findById(decoded.userId).select("-password").lean();
    if (!user) {
      console.warn("[socket-auth] User not found for ID:", decoded.userId);
      return next(new Error("Unauthorized"));
    }

    socket.userId = user._id.toString();
    socket.user = user;
    return next();
  } catch {
    return next(new Error("Unauthorized"));
  }
};
