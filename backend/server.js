const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const nodemailer = require("nodemailer");
const rateLimit = require('express-rate-limit');
require('dotenv').config();

if (!process.env.GEMINI_API_KEY || !process.env.MONGO_URI) {
    console.error("❌ CRITICAL ERROR: GEMINI_API_KEY or MONGO_URI is missing from environment variables!");
    process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- RATE LIMITER ---
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 100, 
    message: { error: 'Too many requests, Monika needs a break! 🌸' }
});
app.use('/ask', limiter);

// --- 1. MONGODB CONNECTION ---
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
        console.log("✅ Monika's Memory (MongoDB) Connected Successfully!");
    } catch (err) {
        console.error("❌ Monika's Memory Connection Failed:", err.message);
        process.exit(1);
    }
};

// --- 2. DATABASE SCHEMAS ---
const Chat = mongoose.model("Chat", new mongoose.Schema({
    sessionId: String, role: String, text: String, timestamp: { type: Date, default: Date.now }
}));

const Fact = mongoose.model("Fact", new mongoose.Schema({
    sessionId: String, fact: String, category: String, timestamp: { type: Date, default: Date.now }
}));

// New Schema for Email OTPs (Auto-deletes after 5 minutes)
const Otp = mongoose.model("Otp", new mongoose.Schema({
    email: String,
    code: String,
    createdAt: { type: Date, expires: 300, default: Date.now }
}));

// --- 3. EMAIL CONFIG (BREVO) ---
const transporter = nodemailer.createTransport({
    host: "smtp-relay.brevo.com",
    port: 587,
    auth: {
        user: process.env.SMTP_USER, // Keep this as your Brevo login ID
        pass: process.env.SMTP_PASS  // Keep this as your Brevo SMTP Key
    }
});

// --- 4. ENDPOINTS ---

// Config Bridge (Google + Firebase)
app.get('/api/config', (req, res) => {
    res.json({ 
        googleClientId: process.env.GOOGLE_CLIENT_ID,
        firebaseConfig: {
            apiKey: process.env.FIREBASE_API_KEY,
            authDomain: process.env.FIREBASE_AUTH_DOMAIN,
            projectId: process.env.FIREBASE_PROJECT_ID,
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
            messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
            appId: process.env.FIREBASE_APP_ID
        }
    });
});

// Send Email OTP
app.post("/api/auth/send-otp", async (req, res) => {
    const { email } = req.body;
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    try {
        // Save to DB
        await Otp.findOneAndUpdate({ email }, { code: otpCode }, { upsert: true });
        
        // --- UPDATED SENDER ADDRESS ---
        await transporter.sendMail({
            from: `"Monika AI" <arpittagade5@gmail.com>`, // This must be your verified Brevo sender!
            to: email,
            subject: "Your Monika AI Login Code 🌸",
            html: `<div style="text-align:center; border:2px solid #ff6b9d; padding:20px; border-radius:15px; font-family: sans-serif;">
                    <h2 style="color:#ff6b9d;">Monika AI</h2>
                    <p>Your secret login code is:</p>
                    <h1 style="letter-spacing:5px; background:#f9f9f9; padding:10px; display:inline-block;">${otpCode}</h1>
                    <p>It expires in 5 minutes. Don't keep me waiting!</p>
                   </div>`
        });
        res.json({ success: true });
    } catch (err) { 
        console.error("Email Error:", err);
        res.status(500).json({ error: "Email failed" }); 
    }
});

// Verify Email OTP
app.post("/api/auth/verify-otp", async (req, res) => {
    const { email, code } = req.body;
    const record = await Otp.findOne({ email, code });
    if (record) {
        await Otp.deleteOne({ _id: record._id });
        res.json({ success: true });
    } else { res.status(400).json({ error: "Invalid or expired code" }); }
});

app.get('/api/history/:sessionId', async (req, res) => {
    try {
        const history = await Chat.find({ sessionId: req.params.sessionId }).sort({ timestamp: 1 }).limit(40);
        res.json(history);
    } catch (err) { res.status(500).json({ error: "History error" }); }
});

// --- 5. MAIN CHAT ROUTE ---
app.post("/ask", async (req, res) => {
    const { question, imageBase64, sessionId } = req.body;
    const currentSessionId = sessionId || "anonymous_user";
    const API_KEYS = [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2].filter(Boolean);
    
    try {
        const genAI = new GoogleGenerativeAI(API_KEYS[0]);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
        const result = await model.generateContent([question]);
        const reply = result.response.text();

        await Chat.insertMany([
            { sessionId: currentSessionId, role: "user", text: question },
            { sessionId: currentSessionId, role: "model", text: reply }
        ]);
        res.json({ reply });
    } catch (err) { res.status(500).json({ error: "AI error" }); }
});

const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));
app.get('*', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));

const PORT = process.env.PORT || 10000;
connectDB().then(() => {
    app.listen(PORT, () => console.log(`🚀 Monika is Live on Port ${PORT}!`));
});
