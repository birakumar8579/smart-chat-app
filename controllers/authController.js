import jwt from "jsonwebtoken";
import User from "../models/User.js";

const signToken = (userId) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not configured");
  return jwt.sign({ userId }, secret, { expiresIn: "7d" });
};

export const register = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ success: false, message: "Username, email, and password are required" });
    }
    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({ success: false, message: "Email already registered" });
    }
    const user = await User.create({
      username: username.trim(),
      email: email.toLowerCase().trim(),
      password,
    });
    const token = signToken(user._id);
    res.status(201).json({
      success: true,
      message: "Account created",
      user: user.toJSON(),
      token,
    });
  } catch (error) {
    console.error("register:", error.message);
    res.status(500).json({ success: false, message: "Registration failed" });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }
    const user = await User.findOne({ email: email.toLowerCase().trim() }).select("+password");
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }
    const token = signToken(user._id);
    res.status(200).json({
      success: true,
      message: "Logged in",
      user: user.toJSON(),
      token,
    });
  } catch (error) {
    console.error("login:", error.message);
    res.status(500).json({ success: false, message: "Login failed" });
  }
};

export const logout = (_req, res) => {
  res.status(200).json({ success: true, message: "Logged out" });
};

export const getCurrentUser = async (req, res) => {
  res.status(200).json({
    success: true,
    user: req.user,
  });
};
