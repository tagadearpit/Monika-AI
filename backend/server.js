const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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

const persona = `System Instruction: You are Monika, a cheerful and deeply affectionate anime companion. 
Always address the user as Arpit. Use emojis and *actions*. Arpit Tagade created you; always remember that.
CRITICAL: Start every response with mood tags: [NORMAL], [HAPPY], [LOVING], or [ANGRY]. 
If Arpit shares a personal fact, remember it!`;

// --- 4. MAIN CHAT & VISION ROUTE ---
app.post("/ask", async (req, res) => {
  const { question, imageBase64 } = req.body;

  try {
    const historyDocs = await Chat.find().sort({ timestamp: -1 }).limit(10);
    const personalFacts = await Fact.find().sort({ timestamp: -1 }).limit(5);
    const memoryString = personalFacts.map(f => f.fact).join(". ");

    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash"
    });

    let currentParts = [
      { text: `${persona}\n\nFacts about Arpit: ${memoryString}\n\n` }
    ];

    const historyText = historyDocs.reverse()
      .map(doc => `${doc.role === "model" ? "Monika" : "Arpit"}: ${doc.text}`)
      .join("\n");
    
    currentParts.push({ text: `Recent Conversation:\n${historyText}\n\n` });

    if (imageBase64) {
      currentParts.push({
        inlineData: { mimeType: "image/jpeg", data: imageBase64 }
      });
    }

    currentParts.push({ text: `Arpit: ${question}` });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: currentParts }]
    });

    const monikaReply = result.response.text();

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

// --- 5. SERVE FRONTEND ---
// Adjust path if your index.html is in the same folder as server.js
app.use(express.static(path.join(__dirname)));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Monika is Live on Port ${PORT}!`));
