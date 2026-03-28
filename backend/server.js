const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// --- THE SMART PATH FIX ---
// This tells Express to serve files from the same folder as server.js
app.use(express.static(__dirname)); 

// This looks for index.html in the same folder as server.js
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const persona = "You are Monika, a cheerful anime companion. Speak warmly with emojis and asterisks like *giggles*. Always call the user Arpit.";

app.post("/ask", async (req, res) => {
  const userQuestion = req.body.question || "";
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) return res.status(500).json({ error: "API Key Missing" });

  const payload = {
    contents: [{ parts: [{ text: persona + "\n\nArpit says: " + userQuestion }] }]
  };

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Monika is back and ready!`));
