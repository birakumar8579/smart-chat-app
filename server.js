import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import connectDB from "./connectDB.js";
import authRoutes from "./routes/authRoutes.js";
import conversationRoutes from "./routes/conversationRoutes.js";
import healthRoutes from "./routes/healthRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import storyRoutes from "./routes/storyRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import watchPartyRoutes from "./routes/watchPartyRoutes.js";
import registerSocketHandlers from "./socket/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config();

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "smartchat-dev-secret-change-in-production";
  console.warn("JWT_SECRET was missing; using a development default. Set JWT_SECRET in .env for production.");
}

const app = express();
const server = http.createServer(app);
const allowedClientOrigins = [
  process.env.CLIENT_URL,
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:5176",
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (origin.startsWith("http://localhost")) {
      return callback(null, true);
    }
    if (allowedClientOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
};

const io = new Server(server, {
  cors: corsOptions,
  transports: ["websocket", "polling"],
  allowUpgrades: true,
});

app.set("io", io);

app.use(cors(corsOptions));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/", (_req, res) => {
  res.status(200).json({ message: "SMARTCHATAPPLICATION API running" });
});
app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/stories", storyRoutes);
app.use("/api/watchparty", watchPartyRoutes);

registerSocketHandlers(io);

const PORT = 3001;

const startServer = async () => {
  try {
    console.log("Starting server...");
    // Auto-restart enabled
    await connectDB();
    
    server.listen(PORT, () => {
      console.log(`Server started successfully on http://localhost:${PORT}`);
      console.log("API endpoints available:");
      console.log("- POST /api/auth/login");
      console.log("- POST /api/auth/me");
      console.log("- GET /api/health");
      console.log("- CORS enabled for all origins");
    });
    
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
};

startServer();
