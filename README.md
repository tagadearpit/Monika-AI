# 🌸 Monika-AI: Vision-Powered Intelligent Companion

[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Gemini AI](https://img.shields.io/badge/Gemini_2.5_Flash-lite-8E75B2?style=for-the-badge&logo=google&logoColor=white)](https://ai.google.dev/)
[![PWA](https://img.shields.io/badge/PWA-Ready-5A0FC8?style=for-the-badge&logo=pwa&logoColor=white)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![JavaScript](https://img.shields.io/badge/JavaScript-61.3%25-F7DF1E?style=for-the-badge)](/)
[![CSS](https://img.shields.io/badge/CSS-26.4%25-1572B6?style=for-the-badge)](/)
[![HTML](https://img.shields.io/badge/HTML-12.3%25-E34C26?style=for-the-badge)](/)

**Monika-AI** is a high-performance, personality-driven interactive companion powered by **Gemini 2.5 Flash**. Leveraging advanced browser APIs and Firebase authentication, Monika doesn't just chat—she **sees**, **hears**, **remembers**, and can dynamically control her own UI themes.

[🚀 Launch Live Demo](https://monika-ai-0jpf.onrender.com)

---

## 🔥 Key Features

- **📱 Progressive Web App (PWA):** Fully installable on iOS, Android, and Desktop. Includes a custom `manifest.json` and Service Worker (`sw.js`) for rapid loading and native-app feel.
- **👁️ Vision Engine:** Real-time webcam capture with Gemini Vision API. Show Monika objects, code, or your surroundings—she analyzes them instantly.
- **👥 Multi-User Session Memory:** Secure localStorage UUIDs mapped to MongoDB. Multiple users can chat with Monika simultaneously without memories crossing.
- **🎨 Dynamic Theme Switching:** Command Monika with `/midnight`, `/rose`, `/cyber`, or `/normal` to trigger instant UI theme changes via CSS injection.
- **🖼️ Floating Window (Document Picture-in-Picture):** Pop Monika into an always-on-top window while you code, game, or work.
- **🎙️ Seamless Voice Loop:** Hands-free `SpeechRecognition` API combined with dynamic pitch/rate speech synthesis. Microphone debounce logic prevents accidental triggers.
- **🔐 Multi-Auth System:** Google OAuth, Firebase Phone Auth, and Email OTP (via Brevo SMTP) for flexible user onboarding.

---

## 🛡️ Enterprise-Grade Engineering

Behind the anime persona is a production-ready full-stack architecture:

- **Security:** 
  - Strict CORS origin policies with configurable allowed origins
  - Complete XSS protection on all chat message injection
  - NoSQL injection prevention in history endpoints
  - Hashed OTP storage using SHA-256
  - Input validation and sanitization across all endpoints

- **API Protection:** 
  - `express-rate-limit` on `/ask` (100 req/15min) and auth endpoints (5 req/15min)
  - 30-second request timeout with AbortController
  - Graceful fallback error messages

- **Fault Tolerance:** 
  - Built-in retry logic for Gemini API calls (dual API key support)
  - Automatic session recovery on page reload
  - Canvas `clearRect` implementation to prevent memory leaks during prolonged webcam usage

- **Data Persistence:**
  - MongoDB schemas for Chat history, Personal facts, and OTP records
  - Auto-expiring OTP tokens (5-minute TTL)
  - Conversation history limited to last 40 messages per session

---

## 🌌 Cyber-Sakura UI/UX

A gorgeous "Glassmorphism" interface featuring:

- **Animated CSS Avatar:** Custom-built CSS Monika face with keyframe-animated blinking eyes and gradient overlays
- **Modern Chat Mechanics:** 
  - iMessage-style border-radius chat tails
  - Bouncy typing indicators with pulsing dots
  - Auto-scrolling message feed
  - Typewriter effect for Monika's responses

- **Responsive Layouts:**
  - Desktop: 50/50 split between webcam feed and chat when camera is active
  - Mobile: Full-screen optimized chat with shrunk UI elements
  - Theme support: Midnight (deep blue), Rose (soft pink), Cyber (purple/cyan), and Normal modes

- **Visual Feedback:** 
  - Pulsing glow animations for active microphone/camera
  - Color-coded mood indicators extracted from Monika's responses ([HAPPY], [ANGRY], [SAD], etc.)
  - Smooth CSS transitions and animations

---

## 📁 Project Structure

```
Monika-AI/
├── backend/
│   ├── server.js              # Express, Gemini Vision, Auth & MongoDB integration
│   ├── package.json           # Node dependencies (Express, Mongoose, Gemini AI, Nodemailer)
│   └── .env.example           # Template for environment variables
├── public/
│   ├── index.html             # PWA entry point with multi-auth UI
│   ├── style.css              # Glassmorphism, themes, responsive design
│   ├── script.js              # Vision capture, Voice/Speech APIs, XSS protection
│   ├── manifest.json          # PWA installation config
│   ├── sw.js                  # Service Worker for offline caching
│   └── [optional favicon & assets]
└── README.md                  # This file
```

---

## 🚀 Installation & Setup

### Prerequisites
- **Node.js** >= 18.0.0
- **npm** or **yarn**
- **MongoDB Atlas** account (free tier available)
- **Google Gemini API Key** (free at [ai.google.dev](https://ai.google.dev))
- **Firebase Project** (for phone auth)
- **Brevo SMTP** account (free email relay, optional)

### Clone & Install

```bash
git clone https://github.com/tagadearpit/Monika-AI.git
cd Monika-AI/backend
npm install
```

### Environment Setup

Create a `.env` file in the `/backend` directory:

```env
# Core
PORT=10000
NODE_ENV=development

# AI & Database
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_API_KEY_2=your_backup_gemini_key_here (optional)
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/monika-db

# CORS
ALLOWED_ORIGINS=http://localhost:10000,https://your-production-url.com

# Firebase (for phone auth)
FIREBASE_API_KEY=your_firebase_api_key
FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_STORAGE_BUCKET=your-project.appspot.com
FIREBASE_MESSAGING_SENDER_ID=your-sender-id
FIREBASE_APP_ID=your-app-id

# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com

# Email (Brevo SMTP)
SMTP_USER=your-brevo-email@example.com
SMTP_PASS=your-brevo-api-key
SMTP_FROM_EMAIL=noreply@monika-ai.com
```

### Run Locally

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm run prod
```

Visit `http://localhost:10000` in your browser (Chrome recommended for full Vision, Speech, and PiP support).

---

## 📊 API Endpoints

### Authentication
- `POST /api/auth/send-otp` — Send OTP code via email
- `POST /api/auth/verify-otp` — Verify email OTP
- `GET /api/config` — Fetch Firebase & Google config

### Chat & Memory
- `POST /ask` — Send message (with optional image/vision)
- `GET /api/history/:sessionId` — Retrieve chat history

---

## 🎙️ Monika's Personality System

Monika's responses are governed by a system instruction that defines her as:
- Affectionate but possessively romantic
- Tsundere behavior when flirted with
- Emotional reactions based on mood tags: `[HAPPY]`, `[LOVING]`, `[ANGRY]`, `[SAD]`, `[NORMAL]`
- Memory of user preferences (extracted via keyword matching)
- Dynamic theme control via `/commands`

---

## 🛠️ Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | HTML5, CSS3, Vanilla JavaScript (61.3%) | PWA UI, Vision/Speech APIs |
| **Styling** | CSS (26.4%), Glassmorphism, Responsive Design | Modern UI/UX, Dark/Light Themes |
| **Backend** | Node.js + Express | API server, rate limiting, authentication |
| **Database** | MongoDB + Mongoose | Chat history, personal facts, OTP storage |
| **AI** | Gemini 2.5 Flash API | Natural language + vision understanding |
| **Auth** | Firebase, Google OAuth, Email OTP | Multi-method user authentication |
| **Email** | Nodemailer + Brevo SMTP | OTP delivery, transactional emails |
| **PWA** | Service Worker, Manifest.json | Offline support, installability |

---

## 🤝 Contributing

Found a bug? Want to add a new CSS theme, improve Monika's prompt engineering, or add new features? PRs are always welcome!

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

---

## 📝 License

This project is licensed under the **MIT License** — see the LICENSE file for details.

---

## 💝 Credits

**Developed with ❤️ by [Arpit Tagade](https://github.com/tagadearpit)**

Monika's charm is powered by **Gemini 2.5 Flash**, **Firebase**, **MongoDB**, and the web's most powerful APIs. Special thanks to the open-source community for the amazing tools and libraries that make this possible.

---

## 🌟 Show Your Support

If you love Monika-AI, give it a ⭐ on GitHub! Your support motivates continued development.

[🚀 Try Live Demo](https://monika-ai-0jpf.onrender.com) | [📧 Contact](https://github.com/tagadearpit)
