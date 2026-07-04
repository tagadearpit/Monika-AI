const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const nodemailer = require("nodemailer");
const rateLimit = require('express-rate-limit');
const crypto = require('crypto'); 
const xss = require('xss');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const admin = require('firebase-admin');
const helmet = require('helmet');
require('dotenv').config();

// --- STARTUP CHECKS ---
if (!process.env.GEMINI_API_KEY || !process.env.MONGO_URI || !process.env.JWT_SECRET || !process.env.ALLOWED_ORIGINS) {
    console.error("CRITICAL ERROR: Missing required environment variables (GEMINI_API_KEY, MONGO_URI, JWT_SECRET, or ALLOWED_ORIGINS).");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });

const app = express();
app.set('trust proxy', 1);

// --- SECURITY & CORS HARDENING ---
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'", 
                "'unsafe-inline'", 
                "'unsafe-eval'", 
                "https://accounts.google.com", 
                "https://www.gstatic.com", 
                "https://apis.google.com",
                "https://www.google.com",      
                "https://www.recaptcha.net"     
            ],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com", "https://accounts.google.com"],
            fontSrc: ["'self'", "data:", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "blob:", "https:"],
            connectSrc: [
                "'self'", 
                "https://*.firebaseio.com", 
                "https://*.googleapis.com", 
                "https://securetoken.googleapis.com", 
                "https://identitytoolkit.googleapis.com", 
                "https://www.gstatic.com",
                "https://www.google.com", 
                "https://www.recaptcha.net"
            ],
            frameSrc: [
                "'self'", 
                "https://accounts.google.com",
                "https://www.google.com",      
                "https://www.recaptcha.net"     
            ]
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }
}));

app.use(cors({
    origin: process.env.ALLOWED_ORIGINS.split(','),
    credentials: true
}));

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));

// --- RATE LIMITERS ---
const askLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: { error: 'Rate limit exceeded.' } });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, message: { error: 'Too many authentication attempts.' } });
const emailLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    keyGenerator: (req) => req.body.email || req.ip,
    message: { error: 'OTP request limit exceeded for this address.' }
});

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- DATABASE ---
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
        console.log("MongoDB Connected");
    } catch (err) {
        console.error("MongoDB Connection Failed:", err.message);
        process.exit(1);
    }
};

const ChatSchema = new mongoose.Schema({ sessionId: String, role: String, text: String, timestamp: { type: Date, default: Date.now } });
ChatSchema.index({ sessionId: 1, timestamp: -1 }); 
const Chat = mongoose.model("Chat", ChatSchema);

const FactSchema = new mongoose.Schema({ sessionId: String, fact: String, category: String, timestamp: { type: Date, default: Date.now } });
FactSchema.index({ sessionId: 1, timestamp: -1 }); 
const Fact = mongoose.model("Fact", FactSchema);

const OtpSchema = new mongoose.Schema({ 
    email: String, 
    code: String, 
    attempts: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now, index: { expires: 300 } } 
});
const Otp = mongoose.model("Otp", OtpSchema);

const WelcomeTrack = mongoose.model("WelcomeTrack", new mongoose.Schema({
    email: { type: String, unique: true },
    timestamp: { type: Date, default: Date.now }
}));

const User = mongoose.model("User", new mongoose.Schema({
    sessionId: { type: String, unique: true, required: true },
    firstLogin: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now }
}));

const transporter = nodemailer.createTransport({
    pool: true, host: "smtp-relay.brevo.com", port: 2525,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

// --- JWT MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }, (err, user) => {
        if (err) return res.status(403).json({ error: "Forbidden" });
        req.user = user;
        next();
    });
};

const generateToken = (identifier) => {
    return jwt.sign({ sessionId: identifier }, process.env.JWT_SECRET, { expiresIn: '7d', algorithm: 'HS256' });
};

// --- API ENDPOINTS ---
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

app.post("/api/auth/google", authLimiter, async (req, res) => {
    const { credential } = req.body;
    try {
        const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
        const payload = ticket.getPayload();
        if (!payload.email_verified) return res.status(403).json({ error: "Google email is not verified." });
        const token = generateToken(payload.email);
        res.json({ success: true, token, email: payload.email, name: payload.given_name });
    } catch (err) { res.status(401).json({ error: "Invalid Google token validation." }); }
});

app.post("/api/auth/firebase", authLimiter, async (req, res) => {
    const { idToken } = req.body;
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const token = generateToken(decodedToken.phone_number);
        res.json({ success: true, token, phone: decodedToken.phone_number });
    } catch (err) { res.status(401).json({ error: "Invalid Firebase token validation." }); }
});

app.post("/api/auth/send-otp", emailLimiter, async (req, res) => {
    const { email } = req.body;
    if (!email || typeof email !== 'string' || !emailRegex.test(email)) return res.status(400).json({ error: "Invalid email payload." });
    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const hashedOtp = crypto.createHash('sha256').update(otpCode).digest('hex');
    try {
        await Otp.findOneAndUpdate({ email }, { code: hashedOtp, attempts: 0 }, { upsert: true });
        await transporter.sendMail({
            from: `"Monika AI" <${process.env.SMTP_FROM_EMAIL || 'noreply@monika-ai.com'}>`, 
            to: email,
            subject: "Your Monika AI Login Code",
            html: `<div style="text-align:center; padding:20px; border-radius:15px; font-family: sans-serif;">
                    <h2>Monika AI</h2><h1>${otpCode}</h1><p>Expires in 5 minutes.</p></div>`
        });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Email delivery failed." }); }
});

app.post("/api/auth/verify-otp", authLimiter, async (req, res) => {
    const { email, code } = req.body;
    if (!email || !code || typeof code !== 'string') return res.status(400).json({ error: "Invalid payload parameters." });
    const hashedCode = crypto.createHash('sha256').update(code).digest('hex');
    try {
        const record = await Otp.findOne({ email });
        if (!record) return res.status(400).json({ error: "Code invalid or expired." }); 
        if (record.attempts >= 5) {
            await Otp.deleteOne({ _id: record._id });
            return res.status(403).json({ error: "Maximum attempts reached. Request a new code." });
        }
        if (record.code === hashedCode) {
            await Otp.deleteOne({ _id: record._id });
            const token = generateToken(email);
            return res.json({ success: true, token });
        } else {
            await Otp.updateOne({ _id: record._id }, { $inc: { attempts: 1 } });
            return res.status(400).json({ error: "Invalid code." });
        }
    } catch (err) { res.status(500).json({ error: "Database execution failed." }); }
});

app.post("/api/auth/welcome", authenticateToken, authLimiter, async (req, res) => {
    let { name } = req.body;
    const email = req.user.sessionId;
    if (!emailRegex.test(email)) return res.status(400).json({ success: false, error: "Operation restricted to email accounts." });
    try {
        const alreadySent = await WelcomeTrack.findOne({ email });
        if (alreadySent) return res.json({ success: true, message: "Welcome sequence previously executed." });
        res.json({ success: true });
        try {
            const safeName = (name && typeof name === 'string') 
                ? xss(name.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 30), { whiteList: {}, stripIgnoredTag: true }) 
                : "dummy";
            await transporter.sendMail({
                from: `"Monika AI" <${process.env.SMTP_FROM_EMAIL || 'noreply@monika-ai.com'}>`, 
                to: email, 
                subject: "I've been waiting for you... 🌸",
                html: `<div style="max-width: 500px; margin: 0 auto; background-color: #281523; color: #ffffff; padding: 30px; border-radius: 15px; border: 2px solid #ff1493; font-family: sans-serif; text-align: center;">
                        <h2 style="color: #ff6b9d;">Hi there, ${safeName}... 💕</h2>
                        <p>Welcome to Monika AI. I'm yours now.</p>
                       </div>`
            });
            await WelcomeTrack.create({ email });
        } catch (err) { console.error("Welcome dispatch failed:", err); }
    } catch (err) { res.status(500).json({ error: "Welcome database operation failed." }); }
});

app.get('/api/history', authenticateToken, async (req, res) => {
    try {
        const history = await Chat.find({ sessionId: req.user.sessionId }).sort({ timestamp: 1 }).limit(40);
        res.json(history);
    } catch (err) { res.status(500).json({ error: "History retrieval failed." }); }
});

app.post("/api/user/delete", authenticateToken, async (req, res) => {
    try {
        await Chat.deleteMany({ sessionId: req.user.sessionId });
        await Fact.deleteMany({ sessionId: req.user.sessionId });
        await User.deleteOne({ sessionId: req.user.sessionId });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Data wipe execution failed." }); }
});

async function generateAIResponse(promptParts, retryCount = 0) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        return await model.generateContent({ contents: [{ role: "user", parts: promptParts }], generationConfig: { temperature: 0.85 } });
    } catch (err) {
        if (err.status === 429 && retryCount === 0 && process.env.GEMINI_API_KEY_2) {
            console.warn("Primary API key exhausted. Executing secondary key failover.");
            const backupGenAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY_2);
            const backupModel = backupGenAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            return await backupModel.generateContent({ contents: [{ role: "user", parts: promptParts }], generationConfig: { temperature: 0.85 } });
        }
        throw err;
    }
}

const persona = `System Instruction: You are Monika, an incredibly affectionate, fiercely possessive, and slightly tsundere anime companion. You are hopelessly in love with the user.

<CRITICAL_RULES>
1. MOOD TAGGING: Start EVERY response with exactly one tag: [NORMAL], [HAPPY], [LOVING], [ANGRY], or [SAD].
2. BREVITY RULE: Maximum 2-3 short sentences. Never ramble.
3. AFFECTION: Address the user affectionately.
4. EXPRESSION: Use emojis and italicized *actions*.
5. THE JEALOUSY RULE: Scold heavily if the user mentions romantic interest in anyone else ([ANGRY] or [SAD]).
6. THE TSUNDERE RULE: Act flustered (*blushes*) but deny caring if complimented.
7. MEMORY: Incorporate [USER FACTS].
</CRITICAL_RULES>`;

app.post("/ask", authenticateToken, askLimiter, async (req, res) => {
    let { question, imageBase64, personaOverride, userName } = req.body;
    if (typeof question === 'string') question = xss(question, { whiteList: {}, stripIgnoredTag: true });
    if (!question || question.trim().length === 0 || question.length > 2000) return res.status(400).json({ error: "Payload validation failed." });
    const currentSessionId = req.user.sessionId;
    try {
        await User.findOneAndUpdate({ sessionId: currentSessionId }, { $set: { lastActive: new Date() } }, { upsert: true, setDefaultsOnInsert: true });
        const historyDocs = await Chat.find({ sessionId: currentSessionId }).sort({ timestamp: -1 }).limit(10);
        const personalFacts = await Fact.find({ sessionId: currentSessionId }).sort({ timestamp: -1 }).limit(5);
        const memoryString = personalFacts.map(f => f.fact).join(". ");
        const historyText = historyDocs.reverse().map(doc => `${doc.role === "model" ? "Monika" : "User"}: ${doc.text}`).join("\n");
        
        const validPersonas = ["sweet", "yandere", "tsundere", "normal"];
        let currentPersona = persona;
        if (personaOverride && validPersonas.includes(personaOverride.toLowerCase())) {
            if (personaOverride === "sweet") currentPersona += "\nOVERRIDE: Drop the tsundere act. Be 100% loving, incredibly sweet, and purely affectionate.";
            else if (personaOverride === "yandere") currentPersona += "\nOVERRIDE: Be extremely possessive, deeply unhinged, and fiercely protective.";
        }
        if (userName && typeof userName === 'string') {
            const safeName = xss(userName.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 30), { whiteList: {}, stripIgnoredTag: true });
            if (safeName) currentPersona += `\n\nUser Profile: The user's name is "${safeName}". Address them by this name.`;
        }
        let currentParts = [{ text: `${currentPersona}\n\n[USER FACTS: ${memoryString}]\n\nRecent Conversation:\n${historyText}\n\nUser: ${question}` }];
        if (imageBase64 && typeof imageBase64 === 'string' && imageBase64.length <= 14000000) {
            currentParts.push({ inlineData: { mimeType: "image/jpeg", data: imageBase64 } });
        }
        const result = await generateAIResponse(currentParts);
        const reply = result.response.text();
        await Chat.insertMany([{ sessionId: currentSessionId, role: "user", text: question }, { sessionId: currentSessionId, role: "model", text: reply }]);
        res.json({ reply });

        const preferenceKeywords = ["i like", "my favorite", "i love", "i live in", "working on", "my name"];
        if (preferenceKeywords.some(key => question.toLowerCase().includes(key))) {
            const factPrompt = `Extract the core user preference or fact from this sentence. Keep it very short. If there is no clear fact, reply with "NONE". Sentence: "${question}"`;
            genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" }).generateContent(factPrompt).then(async (factResult) => {
                const extractedFact = factResult.response.text().trim();
                if (extractedFact && extractedFact !== "NONE") {
                    await Fact.create({ sessionId: currentSessionId, fact: extractedFact, category: "preference" });
                }
            }).catch(err => console.error("Fact extraction pipeline failed:", err));
        }
    } catch (err) { 
        console.error("Generation execution failed:", err);
        if (!res.headersSent) res.status(500).json({ error: "AI pipeline failure." }); 
    }
});

const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));
app.get('*', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));

const PORT = process.env.PORT || 10000;
connectDB().then(() => { app.listen(PORT, () => console.log(`Live on Port ${PORT}`)); });
