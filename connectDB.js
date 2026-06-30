import mongoose from "mongoose";

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/smartchatapplication";
    console.log("Attempting to connect to MongoDB...");
    await mongoose.connect(mongoUri);
    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    console.log("Server will continue without MongoDB connection");
    // Don't exit the process, let the server start anyway
  }
};

export default connectDB;
