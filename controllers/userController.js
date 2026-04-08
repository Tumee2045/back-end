import validator from "validator";
import userModel from "../models/userModel.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

// JWT Token creator
const createToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "7d" });

const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await userModel.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(404).json({ success: false, message: "User doesn't exist." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Incorrect password." });
    }

    const token = createToken(user._id);
    return res.status(200).json({
      success: true,
      token,
      user: { _id: user._id, name: user.name, email: user.email },
    });
  } catch (error) {
    console.error("loginUser error:", error);
    return res.status(500).json({ success: false, message: "Server error. Please try again later." });
  }
};

const registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "All fields are required." });
    }

    const normalizedEmail = email.toLowerCase().trim();
    if (!validator.isEmail(normalizedEmail)) {
      return res.status(400).json({ success: false, message: "Please enter a valid email." });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters." });
    }

    const exists = await userModel.findOne({ email: normalizedEmail });
    if (exists) {
      return res.status(409).json({ success: false, message: "User already exists." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new userModel({
      name,
      email: normalizedEmail,
      password: hashedPassword,
    });

    const savedUser = await newUser.save();
    const token = createToken(savedUser._id);

    return res.status(201).json({
      success: true,
      token,
      user: { _id: savedUser._id, name: savedUser.name, email: savedUser.email },
    });
  } catch (error) {
    console.error("registerUser error:", error);
    return res.status(500).json({ success: false, message: "Server error. Please try again later." });
  }
};

// ✅ Admin Login (Safe payload)
const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
      const token = jwt.sign({ role: "admin" }, process.env.JWT_SECRET, { expiresIn: "1d" });
      return res.status(200).json({ success: true, token });
    } else {
      return res.status(401).json({ success: false, message: "Email or password is incorrect." });
    }
  } catch (error) {
    console.error("adminLogin error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getUser = async (req, res) => {
  try {
    const user = await userModel.findById(req.userId).select("-password");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    return res.status(200).json({
      success: true,
      user: { _id: user._id, name: user.name, email: user.email },
    });
  } catch (error) {
    console.error("getUser error:", error);
    return res.status(500).json({ success: false, message: "Server error. Please try again later." });
  }
};

export { loginUser, registerUser, adminLogin, getUser };
