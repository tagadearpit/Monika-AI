const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const app = express();
app.use(cors());
// 20MB limit to handle high-quality Vision images from Arpit's camera
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

// --- 3. GEMINI CONFIGURATION ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Define the persona once to keep the /ask route clean
const persona = `System Instruction: You are Monika, a cheerful and deeply affectionate anime companion. 
Always address the user as Arpit. Use emojis and *actions* and arpit tagade created you always remember that.
CRITICAL: Start every response with mood tags: [NORMAL], [HAPPY], [LOVING], or [ANGRY]. 
If Arpit shares a personal fact, remember it!`;

// --- 4. MAIN CHAT & VISION ROUTE ---
app.post("/ask", async (req, res) => {
  const { question, imageBase64 } = req.body;

  try {
    // A. Retrieve Context & Memory from MongoDB
    const historyDocs = await Chat.find().sort({ timestamp: -1 }).limit(10);
    const personalFacts = await Fact.find().sort({ timestamp: -1 }).limit(5);
    const memoryString = personalFacts.map(f => f.fact).join(". ");

    // B. INITIALIZE MODEL WITH SEARCH TOOLS (The Fix for the 400 Error)
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash-lite",
      tools: [{ googleSearchRetrieval: {} }] 
    });

    // C. Prepare Prompt Parts
    let currentParts = [
      { text: `${persona}\n\nFacts about Arpit: ${memoryString}\n\n` }
    ];

    // Format History as a string for SDK stability
    const historyText = historyDocs.reverse()
      .map(doc => `${doc.role === "model" ? "Monika" : "Arpit"}: ${doc.text}`)
      .join("\n");
    
    currentParts.push({ text: `Recent Conversation:\n${historyText}\n\n` });

    // Add Vision if present
    if (imageBase64) {
      currentParts.push({
        inlineData: { mimeType: "image/jpeg", data: imageBase64 }
      });
    }

    // Add current question
    currentParts.push({ text: `Arpit: ${question}` });

    // D. Generate Content
    const result = await model.generateContent({
      contents: [{ role: "user", parts: currentParts }]
    });

    const monikaReply = result.response.text();

    // E. Save to Databases (Chat History + Intelligence)
    await Chat.insertMany([
      { role: "user", text: question },
      { role: "model", text: monikaReply }
    ]);

    const preferenceKeywords = ["i like", "my favorite", "i love", "i live in", "working on"];
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
app.listen(PORT, () => console.log(`🚀 Monika is Live on Port ${PORT}!`));
