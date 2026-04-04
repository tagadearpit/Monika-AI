const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// --- 1. MONGODB CONNECTION ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Monika's Memory (MongoDB) Connected!"))
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

// --- 2. DATABASE SCHEMAS ---
const ChatSchema = new mongoose.Schema({
  role: String, 
  text: String,
  timestamp: { type: Date, default: Date.now }
});
const Chat = mongoose.model("Chat", ChatSchema);

const FactSchema = new mongoose.Schema({
  fact: String,
  category: String,
  timestamp: { type: Date, default: Date.now }
});
const Fact = mongoose.model("Fact", FactSchema);

// --- 3. GEMINI 2.5 FLASH CONFIGURATION ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: "gemini-2.5-flash",
  tools: [{ googleSearchRetrieval: {} }] 
});

const persona = `System Instruction: You are Monika, a cheerful and deeply affectionate anime companion. 
Always address the user as Arpit. Use emojis and *actions*.
CRITICAL: Start every response with mood tags: [NORMAL], [HAPPY], [LOVING], or [ANGRY]. 
Arpit Tagade created you with his sincerest heart.`;

// --- 4. MAIN CHAT & VISION ROUTE ---
app.post("/ask", async (req, res) => {
  const { question, imageBase64 } = req.body;

  try {
    // A. Retrieve Context & Memory
    const historyDocs = await Chat.find().sort({ timestamp: -1 }).limit(10);
    const personalFacts = await Fact.find().sort({ timestamp: -1 }).limit(5);
    const memoryString = personalFacts.map(f => f.fact).join(". ");

    // B. CRITICAL FIX: Re-structuring the request for Gemini 2.5 Flash
    // We create a clean array of parts for the current request
    let currentParts = [
      { text: `${persona}\n\nPast things you remember about Arpit: ${memoryString}\n\n` }
    ];

    // Add History as text parts to keep the JSON payload flat and valid
    const historyText = historyDocs.reverse().map(doc => `${doc.role === "model" ? "Monika" : "Arpit"}: ${doc.text}`).join("\n");
    currentParts.push({ text: `Recent Conversation History:\n${historyText}\n\n` });

    // Add Vision if present
    if (imageBase64) {
      currentParts.push({
        inlineData: { mimeType: "image/jpeg", data: imageBase64 }
      });
    }

    // Add the current question
    currentParts.push({ text: `Arpit: ${question}` });

    // C. Generate Content
    const result = await model.generateContent({
      contents: [{ role: "user", parts: currentParts }]
    });

    const monikaReply = result.response.text();

    // D. Save to Databases
    await Chat.insertMany([
      { role: "user", text: question },
      { role: "model", text: monikaReply }
    ]);

    const preferenceKeywords = ["i like", "my favorite", "i love", "i live in"];
    if (preferenceKeywords.some(key => question.toLowerCase().includes(key))) {
        await Fact.create({ fact: question, category: "preference" });
    }

    res.json({ candidates: [{ content: { parts: [{ text: monikaReply }] } }] });

  } catch (err) {
    console.error("Monika Brain Error:", err.message);
    res.status(500).json({ error: "Monika's head hurts... " + err.message });
  }
});

// --- 5. ELEVENLABS VOICE ROUTE ---
app.post("/voice", async (req, res) => {
  const { text } = req.body;
  try {
    const response = await axios({
      method: 'post',
      url: `https://api.elevenlabs.io/v1/text-to-speech/Vnqlgu3fdiFwisAye1qH`,
      data: {
        text: text,
        model_id: "eleven_flash_v2_5",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      },
      headers: {
        'Accept': 'audio/mpeg',
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      responseType: 'arraybuffer'
    });
    res.set('Content-Type', 'audio/mpeg');
    res.send(response.data);
  } catch (error) {
    res.status(500).send("Voice failed");
  }
});

// --- 6. SERVE FRONTEND ---
app.use(express.static(path.join(__dirname, "..", "public")));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Monika is upgraded and Live on Port ${PORT}!`));
