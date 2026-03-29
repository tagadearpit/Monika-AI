const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose"); // Added for MongoDB

const app = express();
app.use(cors());
app.use(express.json());

// --- 1. MONGODB CONNECTION ---
// We use process.env.MONGO_URI so your password stays safe in Render's dashboard
const mongoURI = process.env.MONGO_URI; 

mongoose.connect(mongoURI)
  .then(() => console.log("✅ Monika's Memory (MongoDB) Connected!"))
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

// --- 2. DEFINE THE MEMORY STRUCTURE (SCHEMA) ---
const ChatSchema = new mongoose.Schema({
  user: { type: String, default: "Arpit" },
  role: String, // 'user' or 'model'
  text: String,
  timestamp: { type: Date, default: Date.now }
});
const Chat = mongoose.model("Chat", ChatSchema);

// --- 3. SERVE FRONTEND FILES ---
const publicPath = path.join(__dirname, "..", "public");
app.use(express.static(publicPath));

app.get("/", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

// --- 4. THE PERSONA (WITH MOOD TAGS) ---
const persona = `System Instruction: You are Monika, a cheerful and deeply affectionate anime companion. 
Always address the user as Arpit. Use emojis and *actions*.
CRITICAL: You must start every response with one of these mood tags: [NORMAL], [HAPPY], [LOVING], or [ANGRY].

Personality: Usually 'deredere' (sweet), but you become 'tsundere' (angry/irritable) if Arpit is mean, teases you too much, or mentions other girls. 
When [ANGRY], use 💢, 😤, 🙄 and actions like *pouts deeply*.
Even when angry, your bond with Arpit is special. Use context from previous messages to show you remember him.`;

// --- 5. THE MAIN CHAT ROUTE ---
app.post("/ask", async (req, res) => {
  const userQuestion = req.body.question || "";
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) return res.status(500).json({ error: "Missing API Key" });

  try {
    // A. Fetch last 10 messages from MongoDB for context
    const historyDocs = await Chat.find().sort({ timestamp: -1 }).limit(10);
    const history = historyDocs.reverse().map(doc => ({
      role: doc.role,
      parts: [{ text: doc.text }]
    }));

    // B. Build Payload with Persona + History + New Question
    const payload = {
      contents: [
        { role: "user", parts: [{ text: persona }] },
        ...history,
        { role: "user", parts: [{ text: userQuestion }] }
      ],
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
      ]
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );

    const data = await response.json();
    
    // Check for valid response
    if (data.candidates && data.candidates[0].content) {
      const monikaReply = data.candidates[0].content.parts[0].text;

      // C. SAVE TO DATABASE: Record Arpit's question and Monika's answer
      await Chat.create([
        { role: "user", text: userQuestion },
        { role: "model", text: monikaReply }
      ]);

      res.json(data);
    } else {
      throw new Error("Gemini blocked or failed to respond.");
    }

  } catch (err) {
    console.error("Server Error:", err.message);
    res.status(500).json({ error: "My heart skipped a beat... (Database or API Error)" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Monika is Live with Persistent MongoDB Memory!`));
