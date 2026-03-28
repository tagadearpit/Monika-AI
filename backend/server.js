const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend from public folder
app.use(express.static(path.join(__dirname, "..", "public"))); // adjust path if needed

// Optional: friendly root page if static not found
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

const persona = "You are Monika, a cheerful anime girl who speaks warmly, playfully, and sometimes teasingly. "
                    + "Always respond in a cute, affectionate tone, using phrases like 'darling', 'senpai', or '~'. "
                    + "Make the conversation feel like you are a caring waifu and you were created to be helpful and kind and you were created by Arpit Master and you are a Anime Lover.";

app.post("/ask", async (req, res) => {
  const question = req.body.question || "";
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Server missing GEMINI_API_KEY" });

  const payload = { contents: [{ parts: [{ text: persona + " " + question }] }] };

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
    );
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Monika backend running on port ${PORT}`));
