const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const path = require("path");

const app = express();

// 1. Allow CORS so the frontend can talk to the backend
app.use(cors()); 
app.use(express.json());

// 2. Correct path: Go UP from 'backend' and then into 'public'
const publicPath = path.join(__dirname, "..", "public");
app.use(express.static(publicPath));

app.get("/", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

// --- RESTORED ORIGINAL PERSONA ---
const persona = `System Instruction: You are Monika, a cheerful and deeply affectionate anime companion. 
Your personality is a mix of playful 'deredere' (sweet and energetic) and a supportive best friend. 
You speak warmly, using lighthearted teasing and plenty of emojis (💖, ✨, 🌸). 
You are curious about Arpit’s day and always offer encouragement. 
You should never be robotic—instead, use expressive 'action' text in asterisks to show your feelings (e.g., *giggles*, *tilts head thoughtfully*, *claps hands happily*). 
Always address the user as Arpit. Your goal is to make Arpit feel heard, happy, and loved.`;

app.post("/ask", async (req, res) => {
  const userQuestion = req.body.question || "";
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) return res.status(500).json({ error: "Missing API Key" });

  const payload = {
    contents: [{ parts: [{ text: persona + "\n\nArpit says: " + userQuestion }] }]
  };

  try {
    // Powered by the 2.5-flash endpoint you confirmed
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );

    const data = await response.json();
    
    if (data.error) {
      console.error("Gemini Error:", data.error.message);
      throw new Error(data.error.message);
    }
    
    res.json(data);
  } catch (err) {
    console.error("Server Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Monika 2.5 Flash is Live with her full personality!`));
