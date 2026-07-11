# 🤖 Monika AI v2.0

Monika AI is a production-ready AI chatbot built with **Node.js, Express, MongoDB, Google Gemini, Firebase, Google Sign-In, email OTP authentication, speech features, camera vision, themes, Picture-in-Picture, and PWA support**.

Version 2.0 keeps the existing UI/UX while adding secure persistent login and stronger production safeguards.

---

## ✨ Main Features

- 💬 AI chat powered by Google Gemini
- 🧠 MongoDB-backed chat history and memory
- 🔐 Persistent login across browser restarts
- 🌐 Google Sign-In
- 📱 Firebase phone authentication
- 📧 Email OTP login
- 🎤 Speech input
- 🔊 Text-to-speech output
- 📷 Camera vision support
- 🎨 Theme persistence
- 🪟 Picture-in-Picture mode
- 📲 Progressive Web App support
- 🔄 Multi-tab login and logout synchronization
- 📝 Message draft recovery
- ❤️ Health and readiness endpoints
- 🧾 Structured production logs
- 🛡️ Secure, revocable server sessions

---

## 🔐 How Persistent Login Works

Monika AI v2.0 no longer depends only on `sessionStorage`.

The authentication system now uses:

- Short-lived access tokens stored only in browser memory
- A secure `HttpOnly` refresh cookie
- Rotating refresh credentials
- Hashed session tokens stored in MongoDB
- Automatic token refresh
- Immediate session revocation on logout
- Rolling session expiration
- Multi-tab session synchronization

By default, users remain signed in for up to **365 days of inactivity**.

A user will need to log in again if:

- They manually log out
- They clear browser cookies
- Cookies are blocked
- Their account is deleted
- Their session is revoked
- They remain inactive longer than the configured session lifetime

---

## 🆕 What Changed in v2.0

- ✅ Persistent login after closing Chrome
- ✅ Secure server-managed sessions
- ✅ Automatic token refresh
- ✅ Logout synchronization across tabs
- ✅ Message draft recovery
- ✅ Saved theme preference
- ✅ Safer PWA caching
- ✅ Request IDs and structured logs
- ✅ Graceful server shutdown
- ✅ MongoDB connection-pool controls
- ✅ Stronger OTP protection
- ✅ Current Firebase Admin modular imports
- ✅ Node.js 22 support
- ✅ Render deployment configuration
- ✅ Docker deployment support
- ✅ Zero known npm vulnerabilities at packaging time

The visual layout and CSS design remain unchanged.

---

## 📁 Project Structure

```text
Monika-AI-main/
├── backend/
│   ├── .env.example
│   ├── package.json
│   ├── package-lock.json
│   └── server.js
├── public/
│   ├── index.html
│   ├── style.css
│   ├── script.js
│   ├── manifest.json
│   ├── sw.js
│   └── icons/
├── Dockerfile
├── render.yaml
├── SECURITY.md
├── CHANGELOG.md
└── README.md
```

---

## 🧰 Requirements

Before running the project, make sure you have:

- Node.js 22 or newer
- MongoDB Atlas or another MongoDB deployment
- Gemini API key
- Google OAuth client ID
- Firebase project configuration
- Firebase service-account JSON for stronger token revocation checks
- SMTP account for email OTP login
- HTTPS for production deployment

---

## 🚀 Local Installation

### 1. Open the backend folder

```bash
cd backend
```

### 2. Create the environment file

```bash
cp .env.example .env
```

### 3. Install dependencies

```bash
npm ci
```

### 4. Validate the project

```bash
npm run check
```

### 5. Start the server

```bash
npm start
```

Open:

```text
http://localhost:10000
```

> ⚠️ Never commit the `.env` file to GitHub.

---

## 🔑 Required Environment Variables

Create `backend/.env` and add your real credentials:

```env
NODE_ENV=production
PORT=10000

GEMINI_API_KEY=your_gemini_api_key
MONGO_URI=your_mongodb_connection_string

JWT_SECRET=use_a_long_random_secret
OTP_SECRET=use_a_different_long_random_secret

ALLOWED_ORIGINS=https://your-domain.com

GOOGLE_CLIENT_ID=your_google_client_id

FIREBASE_API_KEY=your_firebase_api_key
FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_STORAGE_BUCKET=your_project.appspot.com
FIREBASE_MESSAGING_SENDER_ID=your_sender_id
FIREBASE_APP_ID=your_firebase_app_id

SMTP_USER=your_email
SMTP_PASS=your_email_app_password
SMTP_FROM_EMAIL=your_email
```

Use `backend/.env.example` for the complete list.

---

## ⏳ Session Settings

```env
ACCESS_TOKEN_TTL_SECONDS=900
SESSION_TTL_DAYS=365
MAX_SESSIONS_PER_USER=10
```

Meaning:

- `ACCESS_TOKEN_TTL_SECONDS=900` — access tokens last 15 minutes.
- `SESSION_TTL_DAYS=365` — users can stay signed in for up to 365 days of inactivity.
- `MAX_SESSIONS_PER_USER=10` — one account can have up to 10 active device sessions.

Increasing the session lifetime improves convenience but also increases the risk of a stolen device session remaining valid.

---

## 🔥 Firebase Production Credentials

For stronger Firebase phone-auth checks, add:

```env
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
FIREBASE_CHECK_REVOKED=true
```

Keep the full JSON on one line.

Without this value, Firebase ID tokens are still verified, but revoked-user checks are not performed.

---

## ☁️ Deploy on Render

The included `render.yaml` is configured for:

- Root directory: `backend`
- Build command: `npm ci --omit=dev`
- Start command: `npm start`
- Health check: `/api/health`
- Node.js version: 22

### Render steps

1. Push the project to GitHub
2. Create a new Render Web Service
3. Connect the GitHub repository
4. Add all environment variables in Render
5. Deploy the service

Set `ALLOWED_ORIGINS` to the exact production URL.

Example:

```env
ALLOWED_ORIGINS=https://monika-ai.duckdns.org
```

Do not add a trailing slash.

---

## 🐳 Docker Deployment

Build the image:

```bash
docker build -t monika-ai:2.0 .
```

Run the container:

```bash
docker run --rm -p 10000:10000 --env-file backend/.env monika-ai:2.0
```

---

## 🔌 API Endpoints

| Endpoint | Method | Authentication | Purpose |
|---|---|---|---|
| `/api/config` | GET | Public | Returns browser authentication configuration |
| `/api/auth/google` | POST | Google credential | Creates a persistent session |
| `/api/auth/firebase` | POST | Firebase ID token | Creates a persistent session |
| `/api/auth/send-otp` | POST | Public | Sends an email OTP |
| `/api/auth/verify-otp` | POST | OTP | Verifies OTP and creates a session |
| `/api/auth/refresh` | POST | Refresh cookie | Rotates the session and returns a new access token |
| `/api/auth/logout` | POST | Session | Revokes the current session |
| `/api/history` | GET | Bearer token | Loads the authenticated user's chat history |
| `/ask` | POST | Bearer token | Sends a message to the AI |
| `/api/user/delete` | POST | Bearer token | Deletes the user account and all sessions |
| `/api/health` | GET | Public | Confirms the server process is running |
| `/api/ready` | GET | Public | Confirms MongoDB is ready |

---

## 🛡️ Production Notes

- Always deploy behind HTTPS
- Never expose `.env` or private keys
- Keep `JWT_SECRET` and `OTP_SECRET` different
- Use long, random secrets
- Keep MongoDB backups enabled
- Add every legitimate frontend URL to `ALLOWED_ORIGINS`
- Do not use `*` for production CORS
- Monitor Render logs regularly
- Replace the built-in rate limiter with Redis when running multiple backend instances
- Use separate credentials for development and production

Production cookies use the `Secure` flag and will not work correctly over plain HTTP.

---

## ✅ Validation Commands

Run these before deployment:

```bash
cd backend
npm ci
npm run check
npm audit --omit=dev
```

Expected result:

```text
0 vulnerabilities
```

---

## 🧪 Recommended Production Tests

After deployment, test:

- Login with Google
- Login with Firebase phone authentication
- Login with email OTP
- Close and reopen Chrome
- Refresh the page
- Open the app in multiple tabs
- Log out from one tab
- Delete the account
- Send AI messages
- Load chat history
- Test microphone and speech output
- Install the PWA
- Test the health endpoint
- Check Render logs

---

## 📌 Important Files

- `backend/.env.example` — environment variable template
- `backend/server.js` — backend server
- `public/script.js` — frontend application logic
- `public/style.css` — current UI design
- `render.yaml` — Render deployment configuration
- `Dockerfile` — Docker deployment configuration
- `SECURITY.md` — security notes
- `CHANGELOG.md` — version history

---

## 📄 License

Add your preferred license before publicly distributing the project.
