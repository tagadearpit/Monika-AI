const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json());

// --- THE FOLDER-JUMP FIX ---
// This moves UP from 'backend' and then DOWN into 'frontend'
const frontendPath = path.join(__dirname, "..", "frontend");

// Serve all CSS, JS, and Images from the frontend folder
app.use(express.static(frontendPath));

app.get("/", (req, res) => {
  const indexPath = path.join(frontendPath, "index.html");
  
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    // This will help us debug if it still fails
    res.status(404).send(`Monika says: I looked in ${frontendPath} but index.html isn't there! 💔`);
  }
});

// ... keep your app.post("/ask") and persona code exactly the same ...
