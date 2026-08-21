# 🤖 Monika AI v3.0.2

Monika AI is a full-stack AI companion built with **Node.js, Express, MongoDB, Google Gemini, Firebase, Google Sign-In, email OTP, speech, camera support, reminders, and PWA features**.

Version 3.0.2 keeps the existing Monika visual style while adding conversation management, editable memory, streaming responses, device controls, attachments, personalization, feedback, reminders, and usage limits.

### v3.0.2 update

- Production-grade, branded HTML + plain-text templates for the sign-in code and new-sign-in alert emails
- Clean, bookmarkable URLs for login, OTP verification, chat, and settings
- New **About** tab in Settings with an app overview, a contact email, and a link to contribute

### v3.0.1 maintenance update

- Smooth typewriter rendering for streamed replies
- No login-page flash while a secure session is restored
- Preferences return directly to chat after saving
- Updated PWA cache for reliable rollout

---

## ✨ Main features

### 💬 Conversations

- Create multiple conversations
- Rename and pin conversations
- Delete one conversation or clear all history
- Search across messages
- Export a conversation as TXT, Markdown, or PDF
- Automatically migrate existing v2 chat history

### ⚡ AI messaging

- Streaming Gemini responses
- Stop generation
- Regenerate a response
- Continue a response
- Edit and resend a previous user message
- Copy responses
- Like, dislike, or report responses
- Accurate date and time using the browser's timezone

### 🧠 Editable memory

- View remembered facts
- Add memories manually
- Edit incorrect memories
- Delete individual memories
- Clear all memories
- Disable automatic memory entirely
- Store source and confidence metadata

### 📎 Attachments

- Images: JPEG, PNG, and WebP
- Documents: PDF, TXT, and Markdown
- Attachment preview and removal before sending
- Server-side MIME type and size validation
- Camera capture support

Attachment contents are processed only for the current AI request. MongoDB stores message text and safe attachment metadata, not raw Base64 file contents.

### 🎙️ Voice and personalization

- Speech-to-text input
- Optional hands-free mode
- Automatic text-to-speech playback
- Voice and language selection
- Preferred name
- Response length
- Persona mode
- Theme and text size
- Sound and typing-animation controls

### 🔐 Authentication and devices

- Google Sign-In
- Firebase phone authentication
- Email OTP login
- Persistent login across Chrome restarts
- Short-lived access tokens
- Rotating `HttpOnly` refresh cookies
- Server-side session revocation
- Active-device list
- Current-device indicator
- Logout from one device
- Logout from all other devices
- Refresh-token reuse detection
- Branded OTP and login-notification emails

### ⏰ Reminders and journal

- Create, list, edit, and delete reminders
- Parse natural reminder requests with Gemini
- Daily and weekly recurrence
- In-app due-reminder delivery
- Optional Web Push notifications
- Opt-in daily or weekly conversation recap

### 🛡️ Production controls

- Per-user daily message and image limits
- Request IDs and structured logs
- Request latency and Gemini duration logs
- Health and readiness endpoints
- CSRF protection for authenticated mutations
- Exact CORS allowlist
- Zod request validation
- Rate limiting
- Graceful shutdown
- MongoDB connection-pool settings
- Security audit events

---

## 📁 Project structure

```text
Monika-AI-Production-v3/
├── backend/
│   ├── email-templates.js
│   ├── models.js
│   ├── server.js
│   ├── utils.js
│   ├── validation.js
│   ├── package.json
│   ├── package-lock.json
│   └── test/
│       ├── unit.test.js
│       ├── smoke.test.js
│       └── integration.test.js
├── public/
│   ├── index.html
│   ├── style.css
│   ├── script.js
│   ├── manifest.json
│   ├── sw.js
│   ├── robots.txt
│   └── sitemap.xml
├── Dockerfile
├── SECURITY.md
├── CHANGELOG.md
├── VALIDATION.md
```

---

## 🧰 Requirements

- Node.js 22 or newer
- MongoDB Atlas or compatible MongoDB deployment
- Google Gemini API key
- HTTPS for production

Depending on the login methods you enable, you may also need:

- Google OAuth client ID
- Firebase web configuration
- Firebase Admin service account
- SMTP credentials

Web Push reminders additionally require VAPID keys.

---

## 🚀 Local installation

### 1. Open the backend directory

```bash
cd backend
```

### 2. Install dependencies

```bash
npm ci
```

### 3. Validate the project

```bash
npm test
```

### 4. Start the server

```bash
npm start
```

Open:

```text
http://localhost:10000
```

> ⚠️ Never commit `backend/.env`, private keys, OTP values, access tokens, or service-account JSON.

---

## 🔐 Authentication settings

```env
ACCESS_TOKEN_TTL_SECONDS=900
SESSION_TTL_DAYS=365
MAX_SESSIONS_PER_USER=10
LOGIN_NOTIFICATION_EMAILS=false
```

`SESSION_TTL_DAYS` uses rolling expiration. A successful session refresh extends the session. Users still need to log in again after manual logout, cookie deletion, account deletion, or session expiry.

---

## 🗣️ Text-to-Speech settings

```env
TTS_RATE_LIMIT=30
```

`TTS_RATE_LIMIT` sets the maximum TTS generation requests per 15 minutes per user.

---

## 📧 Email OTP configuration

```env
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=2525
SMTP_SECURE=false
SMTP_USER=your_smtp_username
SMTP_PASS=your_smtp_password
SMTP_FROM_EMAIL=noreply@your-domain.example
APP_URL=https://your-domain.example
```

`APP_URL` is used to build the links inside the OTP and login-notification emails, and should match your deployed domain exactly (no trailing slash). It is required at startup. Email OTP and login notifications remain unavailable when SMTP is not configured.

---

## 🔔 Optional Web Push reminders

Generate VAPID keys:

```bash
npx web-push generate-vapid-keys
```

Add them to the environment:

```env
VAPID_PUBLIC_KEY=your_public_key
VAPID_PRIVATE_KEY=your_private_key
VAPID_SUBJECT=mailto:your-support-address@your-domain.example
```

The included reminder worker runs inside the web process every 30 seconds. On a sleeping or frequently restarted hosting instance, notification delivery may be delayed. For strict delivery guarantees, move reminders to a dedicated worker and queue.

---

## ☁️ Render deployment

The included `render.yaml` uses:

- Node.js 22
- Build command: `cd backend && npm ci --omit=dev --no-audit --no-fund`
- Start command: `node backend/server.js`
- Health check: `/api/health`

Deployment steps:

1. Push the project to GitHub.
2. Create or update the Render Web Service.
3. Add every required environment variable.
4. Set `ALLOWED_ORIGINS` to each exact HTTPS origin, separated by commas.
5. Do not include trailing slashes.
6. Deploy and inspect runtime logs.

Example:

```env
ALLOWED_ORIGINS=https://monika-ai-0jpf.onrender.com
```

---

## 🐳 Docker deployment

```bash
docker build -t monika-ai:3.0 .
docker run --rm -p 10000:10000 --env-file backend/.env monika-ai:3.0
```

---

## ✅ Validation commands

```bash
cd backend
npm ci
npm test
npm audit --omit=dev
```

The MongoDB integration suite is opt-in because it downloads a temporary MongoDB binary:

```bash
RUN_DB_INTEGRATION_TESTS=true npm test
```

Use a CI runner with network access when enabling that suite.

---

## 🧪 Production test checklist

After deployment, verify:

- Google, phone, and email login methods you enabled
- Login persistence after closing and reopening Chrome
- Refresh and logout across multiple tabs
- Conversation create, rename, pin, search, export, and delete
- Streaming, stop, regenerate, edit, continue, and copy actions
- Memory add, edit, delete, disable, and clear
- Image, PDF, and text attachments
- Speech input and output permissions
- Device revocation
- Reminder delivery and notification permissions
- User quotas and rate limits
- Account deletion
- `/api/health` and `/api/ready`
- Browser console and Render runtime logs

---

## ⚠️ Known operational limits

- Attachments are transient and are not stored in external object storage.
- The reminder worker is process-local rather than BullMQ/Redis-backed.
- Rate limiting is process-local; use a shared store before horizontal scaling.
- The Content Security Policy still permits inline scripts/styles required by the current interface and third-party login widgets. `unsafe-eval` has been removed.
- Sentry, full two-factor authentication, account recovery, encrypted object storage, and a distributed background queue are not included in this release.

---

## 🤝 Contributing

Monika AI is open source, and contributions are genuinely welcome — bug fixes, new features, documentation improvements, or even just a clearly written issue all help.

1. Fork the repository: [github.com/tagadearpit/Monika-AI](https://github.com/tagadearpit/Monika-AI.git)
2. Create a feature branch: `git checkout -b feature/your-idea`
3. Make your changes and run the validation commands above before opening a pull request
4. Open a pull request describing what changed and why

Working on a live, production-shaped codebase — real auth, streaming, rate limiting, request validation — is also just a solid way to build genuine full-stack and AI-integration experience.

---

## 📬 Contact & feedback

Found a bug, have a feature idea, or just want to share feedback? Reach out at **tagadearpit@gmail.com** — feedback from people actually using Monika AI is what shapes what gets built next.

---

## 📄 License

Released under the MIT License. See [`LICENSE`](LICENSE).
