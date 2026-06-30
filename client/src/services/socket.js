import { io } from "socket.io-client";

// In dev, connect directly to backend; in production, use the same origin
const socketURL = import.meta.env.DEV 
  ? "http://localhost:3001" 
  : (window.location.origin.includes("localhost") ? window.location.origin : "http://localhost:3001");

const socket = io(socketURL, {
  autoConnect: false,
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 10,
  secure: false,
  rejectUnauthorized: false,
});

// Error handling
socket.on("connect_error", (error) => {
  console.error("[socket] Connection error:", error?.message || error);
});

socket.on("disconnect", (reason) => {
  console.log("[socket] Disconnected:", reason);
});

socket.on("connect", () => {
  console.log("[socket] Connected with ID:", socket.id);
});

export default socket;
