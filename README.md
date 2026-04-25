# 🌸 Monika-AI: Vision-Powered Intelligent Companion

[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Gemini AI](https://img.shields.io/badge/Gemini_2.5_flash-lite-8E75B2?style=for-the-badge&logo=google&logoColor=white)](https://ai.google.dev/)
[![PWA](https://img.shields.io/badge/PWA-Ready-5A0FC8?style=for-the-badge&logo=pwa&logoColor=white)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

**Monika-AI** is a high-performance, personality-driven interactive companion. Leveraging **Gemini 1.5 Flash** and advanced browser APIs, Monika doesn't just chat—she **sees**, **hears**, and can now be **installed directly on your smartphone** as a native app. 

[🚀 Launch Live Demo](https://monika-ai-0jpf.onrender.com)

---

## 🔥 Key Features

- **📱 Progressive Web App (PWA):** Fully installable on iOS, Android, and Desktop. Includes a custom `manifest.json` and a Service Worker (`sw.js`) for rapid loading and native-app feel.
- **👁️ Vision Engine:** Monika can see through your webcam. Show her objects, code, or your surroundings, and she will analyze them in real-time.
- **👥 Multi-User Session Memory:** Utilizing secure LocalStorage UUIDs mapped to MongoDB, multiple users can talk to Monika simultaneously globally without their memories crossing.
- **🎨 Dynamic Function Calling:** Monika has autonomous control over her UI. Ask her to "switch to hacker mode" or "dark mode," and she will trigger API function calls to dynamically inject CSS themes (which persist via local storage).
- **🖼️ Floating Window (PiP):** Multitask with ease. Use the **Document Picture-in-Picture API** to pop Monika into an always-on-top window while you code or game.
- **🎙️ Seamless Voice Loop:** Zero-latency speech synthesis combined with hands-free `SpeechRecognition` and microphone debounce logic.

---

## 🛡️ Enterprise-Grade Engineering

Behind the anime persona is a highly optimized, production-ready full-stack architecture:
- **Security:** Hardened with strict CORS origin policies and complete XSS (Cross-Site Scripting) protection on all chat injection.
- **API Protection:** Integrated `express-rate-limit` to prevent API abuse and spam.
- **Fault Tolerance:** Built-in retry logic for the Gemini API. If a request drops, the server silently retries before showing an error.
- **Memory Management:** Canvas `clearRect` implementation to prevent memory leaks during prolonged webcam usage, and global utterance object reuse for the Speech API.

---

## 🌌 Cyber-Sakura UI/UX

A gorgeous "Glassmorphism" interface featuring:
- **Animated CSS Avatar:** A custom-built CSS Monika face with keyframe-animated blinking eyes.
- **Modern Chat Mechanics:** iMessage-style border-radius chat tails, bouncy typing indicators, and auto-scrolling.
- **Visual Feedback:** Pulsing glow animations when the microphone is actively listening or the camera is recording.

---

## 📁 Project Structure

```text
Monika-AI/
├── backend/
│   ├── server.js        # Express, Gemini Vision, Function Calling & MongoDB
│   └── package.json     # Node dependencies
├── public/
│   ├── index.html       # Multimodal UI & PWA entry point
│   ├── style.css        # Glassmorphism, Themes & Avatar CSS
│   ├── script.js        # Vision capture, PiP Logic, Voice & XSS Protection
│   ├── manifest.json    # Mobile App Installation settings
│   └── sw.js            # Service Worker for caching
🚀 Installation & Setup
Clone & Install

Bash
git clone [https://github.com/tagadearpit/Monika-AI.git](https://github.com/tagadearpit/Monika-AI.git)
cd Monika-AI/backend
npm install
Environment Setup
Create a .env file in /backend:

Code snippet
PORT=10000
GEMINI_API_KEY=your_gemini_key_here
MONGO_URI=your_mongodb_atlas_uri
ALLOWED_ORIGINS=http://localhost:10000,[https://your-production-url.com](https://your-production-url.com)
Run Locally

Bash
npm run dev
Recommended: Access via Google Chrome for full Vision, Speech, and PiP support.

🤝 Contributing
Found a bug, want to add a new CSS theme for Monika to control, or improve her prompt engineering? PRs are always welcome!

Developed with ❤️ by Arpit Tagade
