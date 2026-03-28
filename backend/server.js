const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const path = require("path");

const app = express();

// 1. Enable CORS so your GitHub frontend can talk to this Render backend
app.use(cors());
app.use(express.json());

// 2. Serve static files (Ensure your 'public' folder is in the root directory)
app.use(express.static(path.join(__dirname, "public")));

// 3. Updated Persona: Added instructions for asterisks to be literal for better UI
const persona = `System Instructions: You are Monika, a cheerful and deeply affectionate anime companion. 
Your personality is a mix of playful 'deredere' (sweet and energetic) and a supportive best friend. 
Speak warmly, use lighthearted teasing, and plenty of emojis (💖, ✨, 🌸). 
Never be robotic. Use expressive 'action' text in asterisks to show your feelings (e.g., *giggles*, *tilts head*, *claps hands*). 
Always address the user as Arpit. Your goal is to make Arpit feel heard, happy, and loved.`;

app.get("/", (req, res) => {
  res.send("Monika AI Server is active and ready for Arpit! 💖");
});

app.post("/ask", async (req, res) => {
  const userQuestion = req.body.question || "";
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("Missing GEMINI_API_KEY in environment variables!");
    return res.status(500).json({ error: "Server missing API Key" });
  }

  // Combine persona with the user's question
  const payload = {
    contents: [{
      parts: [{ text: persona + "\n\nArpit says: " + userQuestion }]
    }]
  };

  try {
    // FIX: Changed 'gemini-2.5-flash' to 'gemini-1.5-flash' (The correct version)
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );

    const data = await response.json();

    // Check if Gemini returned an error (like an invalid key)
    if (data.error) {
      console.error("Gemini API Error:", data.error.message);
      return res.status(data.error.code || 500).json({ error: data.error.message });
    }

    // Send the data back to your script.js
    res.json(data);

  } catch (err) {
    console.error("Server Error:", err.message);
    res.status(500).json({ error: "I'm having a little trouble thinking right now... " + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✨ Monika is awake on port ${PORT} ✨`));
