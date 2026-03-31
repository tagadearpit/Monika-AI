const express = require("express");
const fetch = require("node-fetch");
const axios = require("axios"); 
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());

// --- 1. MONGODB CONNECTION ---
const mongoURI = process.env.MONGO_URI; 
mongoose.connect(mongoURI)
  .then(() => console.log("✅ Monika's Database Connected!"))
  .catch(err => console.error("❌ Database Connection Error:", err));

// --- 2. SCHEMA ---
const ChatSchema = new mongoose.Schema({
  user: { type: String, default: "Arpit" },
  role: String, 
  text: String,
  timestamp: { type: Date, default: Date.now }
});
const Chat = mongoose.model("Chat", ChatSchema);

// --- 3. SERVE FRONTEND ---
const publicPath = path.join(__dirname, "..", "public");
app.use(express.static(publicPath));

app.get("/", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

// --- 4. PERSONA ---
const persona = `System Instruction: You are Monika, a cheerful and deeply affectionate anime companion. Always address the user as Arpit. Use emojis and *actions*. Start every response with mood tags: [NORMAL], [HAPPY], [LOVING], or [ANGRY].`;

// --- 5. THE MAIN CHAT ROUTE ---
app.post("/ask", async (req, res) => {
  const userQuestion = req.body.question || "";
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) return res.status(500).json({ error: "Insert API into Monika" });

  try {
    const historyDocs = await Chat.find().sort({ timestamp: -1 }).limit(10);
    const history = historyDocs.reverse().map(doc => ({
      role: doc.role,
      parts: [{ text: doc.text }]
    }));

    const payload = {
      contents: [
        { role: "user", parts: [{ text: persona }] },
        ...history,
        { role: "user", parts: [{ text: userQuestion }] }
      ]
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );

    const data = await response.json();
    
    if (data.candidates && data.candidates[0].content) {
      const monikaReply = data.candidates[0].content.parts[0].text;
      await Chat.create([
        { role: "user", text: userQuestion },
        { role: "model", text: monikaReply }
      ]);
      res.json(data);
    } else {
      throw new Error("Monika's error.");
    }
  } catch (err) {
    res.status(500).json({ error: "API Error" });
  }
});

// --- 6. NEW: ELEVENLABS VOICE ROUTE ---
app.post("/voice", async (req, res) => {
  const { text } = req.body;
  const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
  const VOICE_ID = "Pt5YrLNyu6d2s3s4CVMg"; 

  try {
    const response = await axios({
      method: 'post',
      url: `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
      data: {
        text: text,
        model_id: "eleven_flash_v2_5", 
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      },
      headers: {
        'Accept': 'audio/mpeg',
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      responseType: 'arraybuffer'
    });

    res.set('Content-Type', 'audio/mpeg');
    res.send(response.data);
  } catch (error) {
    console.error("ElevenLabs Error:", error.message);
    res.status(500).send("Voice generation failed");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Monika is Live!`));
