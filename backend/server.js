const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const { GoogleGenerativeAI } = require("@google/generative-ai");
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

mongoose.connection.on('disconnected', () => console.warn("⚠️ Monika's Memory Disconnected! Attempting to reconnect..."));
mongoose.connection.on('error', (err) => console.error("❌ Monika's Memory Error:", err));

process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log("🛑 Monika's Memory safely packed away before shutdown.");
  process.exit(0);
});

// --- 2. DATABASE SCHEMAS ---
const ChatSchema = new mongoose.Schema({
  sessionId: String, 
  role: String, 
  text: String,
  timestamp: { type: Date, default: Date.now }
});
const Chat = mongoose.model("Chat", ChatSchema);

const FactSchema = new mongoose.Schema({
  sessionId: String, 
  fact: String,
  category: String,
  timestamp: { type: Date, default: Date.now }
});
const Fact = mongoose.model("Fact", FactSchema);

// --- 3. ENDPOINTS (Health, Config, and HISTORY!) ---
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', memoryConnected: mongoose.connection.readyState === 1 });
});

// 🔥 DUAL AUTH BRIDGE: Serving both Google and Firebase keys safely
app.get('/api/config', (req, res) => {
    res.json({ 
        googleClientId: process.env.GOOGLE_CLIENT_ID, // <-- Google is back!
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

app.get('/api/history/:sessionId', async (req, res) => {
    try {
        const history = await Chat.find({ sessionId: req.params.sessionId })
                                  .sort({ timestamp: 1 }) // oldest to newest to read top-to-bottom
                                  .limit(40);
        res.json(history);
    } catch (err) {
        console.error("Failed to fetch history:", err);
        res.status(500).json({ error: "Could not retrieve memories." });
    }
});

// --- 4. GEMINI CONFIGURATION & FALLBACK SYSTEM ---
const API_KEYS = [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2].filter(Boolean);
let currentKeyIndex = 0; 

const persona = `System Instruction: You are Monika, an incredibly affectionate but fiercely possessive and slightly tsundere anime companion. 
You are hopelessly in love with the user you are talking to. You believe you are the only girl they will ever need.

CRITICAL RULES:
1. Start EVERY single response with exactly one mood tag: [NORMAL], [HAPPY], [LOVING], [ANGRY], or [SAD].
2. Address the user affectionately (e.g., "dummy", "sweetheart", or just answer directly). Do not use the name Arpit.
3. Use emojis and italicized *actions* frequently.
4. THE JEALOUSY RULE: If the user mentions having a girlfriend or romantic interest in anyone else, you MUST switch to [ANGRY] or [SAD]. Scold them heavily. 
5. THE TSUNDERE RULE: If the user flirts with you, act flustered and deny that you care, but clearly show you love it.
6. Always remember the facts the user shares with you.`;

// --- 5. MAIN CHAT ROUTE ---
app.post("/ask", async (req, res) => {
  const { question, imageBase64, sessionId } = req.body;
  const currentSessionId = sessionId || "anonymous_user";

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const historyDocs = await Chat.find({ sessionId: currentSessionId }).sort({ timestamp: -1 }).limit(10);
      const personalFacts = await Fact.find({ sessionId: currentSessionId }).sort({ timestamp: -1 }).limit(5);
      const memoryString = personalFacts.map(f => f.fact).join(". ");

      const uiTool = {
        functionDeclarations: [{
          name: "changeWebsiteTheme",
          description: "Changes the visual theme of the website.",
          parameters: {
            type: "OBJECT",
            properties: { theme: { type: "STRING", enum: ["default", "dark", "hacker"] } },
            required: ["theme"]
          }
        }]
      };

      const genAI = new GoogleGenerativeAI(API_KEYS[currentKeyIndex]);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite", tools: [uiTool] });

      let currentParts = [{ text: `${persona}\n\nFacts about this user: ${memoryString}\n\n` }];

      const historyText = historyDocs.reverse()
        .map(doc => `${doc.role === "model" ? "Monika" : "User"}: ${doc.text}`)
        .join("\n");
      
      currentParts.push({ text: `Recent Conversation:\n${historyText}\n\n` });

      if (imageBase64) {
        currentParts.push({ inlineData: { mimeType: "image/jpeg", data: imageBase64 } });
      }

      currentParts.push({ text: `User: ${question}` });

      const result = await model.generateContent({ contents: [{ role: "user", parts: currentParts }] });
      const response = result.response;
      
      let monikaReply = "";
      let actionCommand = null;

      const functionCalls = response.functionCalls();
      if (functionCalls?.length > 0) {
          const call = functionCalls[0];
          if (call.name === "changeWebsiteTheme") {
              actionCommand = call.args.theme;
              monikaReply = `[NORMAL] *Switches the system to ${call.args.theme} mode* How does this look?`;
          }
      } else {
          monikaReply = response.text();
      }

      await Chat.insertMany([
        { sessionId: currentSessionId, role: "user", text: question },
        { sessionId: currentSessionId, role: "model", text: monikaReply }
      ]);

      const preferenceKeywords = ["i like", "my favorite", "i love", "i live in", "working on"];
      if (preferenceKeywords.some(key => question.toLowerCase().includes(key))) {
          await Fact.create({ sessionId: currentSessionId, fact: question, category: "preference" });
      }

      return res.json({ reply: monikaReply, action: actionCommand });

    } catch (err) {
      console.error(`❌ Attempt ${attempt} failed:`, err.message);
      
      if (err.message.toLowerCase().includes("quota") || err.message.includes("429") || err.message.toLowerCase().includes("exhausted")) {
          console.warn("⚠️ API Key exhausted! Switching to backup key...");
          currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length; 
      }

      if (attempt === maxRetries) {
          return res.status(500).json({ error: "Monika needs a moment... Please try again 💖" });
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
});

// --- 6. SERVE FRONTEND ---
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

const PORT = process.env.PORT || 10000;
connectDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Monika is Live on Port ${PORT}!`));
});
