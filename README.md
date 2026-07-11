# Monika AI v2.0

Monika AI is a Node.js/Express web application with Google Gemini, MongoDB-backed chat memory, Google sign-in, Firebase phone authentication, email OTP login, camera vision, speech input/output, themes, Picture-in-Picture, and PWA support.

The v2.0 update keeps the existing UI/UX and replaces browser-session-only authentication with persistent, revocable server sessions.

## Production authentication design

- Access tokens are short-lived and remain only in JavaScript memory.
- A random refresh credential is stored in an `HttpOnly`, `SameSite=Lax`, `Secure` production cookie.
- Only a SHA-256 hash of the refresh credential is stored in MongoDB.
- Refresh credentials rotate and the server maintains a short overlap window for concurrent Chrome tabs.
- Chrome tabs coordinate refreshes through the Web Locks API and synchronize login/logout through `BroadcastChannel`.
- Sessions use a rolling expiration. With the default `SESSION_TTL_DAYS=365`, a returning user stays signed in as long as the app is opened at least once within each 365-day period.
- Manual logout revokes the current server session and clears the cookie.
- Account deletion revokes every session and removes chat history, facts, and the user record.
- Existing v1 `sessionStorage` JWTs are upgraded once into the new session system when still valid.

Browser storage clearing, cookie blocking, administrator revocation, account deletion, or an inactive period longer than the configured session TTL will require login again.

## Additional v2.0 changes

- No visual layout or CSS redesign.
- Automatic access-token refresh and retry after token expiry.
- Multi-tab login/logout synchronization.
- Message draft recovery after reload or accidental tab closure.
- Persisted theme selection.
- Network-safe history loading without logging users out on temporary failures.
- PWA service worker that never caches authentication or AI API responses.
- Health and readiness endpoints.
- Request IDs, structured server logs, graceful shutdown, and MongoDB pool controls.
- HMAC-protected OTP records, timing-safe OTP comparison, resettable OTP TTL, and normalized email identities.
- Current Firebase Admin modular imports and Node.js 22 runtime requirement.
- Production Dockerfile and Render blueprint.
- Dependency audit: zero known npm vulnerabilities at packaging time.

## Project structure

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
│   └── icons
├── Dockerfile
├── render.yaml
├── SECURITY.md
└── CHANGELOG.md
```

## Requirements

- Node.js 22 or newer
- MongoDB Atlas or a compatible MongoDB deployment
- Gemini API key
- Google OAuth client ID for Google login
- Firebase web configuration for phone login
- Firebase service-account JSON when Firebase token revocation checks are enabled
- SMTP account for email OTP login
- HTTPS in production

## Local installation

```bash
cd backend
cp .env.example .env
npm ci
npm run check
npm start
```

Open `http://localhost:10000`.

Do not commit `.env`. Use different high-entropy values for `JWT_SECRET` and `OTP_SECRET`.

## Required environment variables

```env
NODE_ENV=production
PORT=10000

GEMINI_API_KEY=...
MONGO_URI=...
JWT_SECRET=at-least-32-random-characters
OTP_SECRET=a-different-random-secret
ALLOWED_ORIGINS=https://your-production-domain.example

GOOGLE_CLIENT_ID=...
FIREBASE_API_KEY=...
FIREBASE_AUTH_DOMAIN=...
FIREBASE_PROJECT_ID=...
FIREBASE_STORAGE_BUCKET=...
FIREBASE_MESSAGING_SENDER_ID=...
FIREBASE_APP_ID=...

SMTP_USER=...
SMTP_PASS=...
SMTP_FROM_EMAIL=...
```

Use `backend/.env.example` for the complete list.

## Persistent session settings

```env
ACCESS_TOKEN_TTL_SECONDS=900
SESSION_TTL_DAYS=365
MAX_SESSIONS_PER_USER=10
```

`SESSION_TTL_DAYS` is rolling. Increasing it improves convenience but increases the lifetime of a stolen device session. Keep the default unless product requirements justify a longer policy.

## Firebase production credentials

For stronger phone-auth revocation checks, provide the complete Firebase service-account JSON as one environment variable:

```env
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
FIREBASE_CHECK_REVOKED=true
```

Without this credential, phone ID-token signatures are still verified, but the extra revoked-user lookup remains disabled.

## Render deployment

The included `render.yaml` uses:

- Root directory: `backend`
- Build command: `npm ci --omit=dev`
- Start command: `npm start`
- Health check: `/api/health`
- Node.js: 22

Add all secrets in Render's environment settings. Set `ALLOWED_ORIGINS` to the exact deployed HTTPS origin. Do not include a trailing slash.

## Docker deployment

From the repository root:

```bash
docker build -t monika-ai:2.0 .
docker run --rm -p 10000:10000 --env-file backend/.env monika-ai:2.0
```

## API endpoints

| Endpoint | Method | Authentication | Purpose |
|---|---:|---|---|
| `/api/config` | GET | Public | Browser auth configuration |
| `/api/auth/google` | POST | Google credential | Create persistent session |
| `/api/auth/firebase` | POST | Firebase ID token | Create persistent session |
| `/api/auth/send-otp` | POST | Public/rate-limited | Send email OTP |
| `/api/auth/verify-otp` | POST | OTP | Create persistent session |
| `/api/auth/refresh` | POST | HttpOnly cookie | Rotate session and return access token |
| `/api/auth/logout` | POST | Session cookie/access token | Revoke current session |
| `/api/history` | GET | Bearer access token | Load isolated chat history |
| `/ask` | POST | Bearer access token | Generate an AI response |
| `/api/user/delete` | POST | Bearer access token | Delete account data and all sessions |
| `/api/health` | GET | Public | Process health |
| `/api/ready` | GET | Public | MongoDB readiness |

## Operational constraints

- The built-in rate limiter is process-local. For multiple application instances, replace it with a shared Redis-backed rate-limit store.
- Session records are in MongoDB, so persistent login works across server restarts and horizontally scaled application instances.
- The application should be deployed behind HTTPS. Production refresh cookies are marked `Secure` and will not work over plain HTTP.
- `ALLOWED_ORIGINS` must list every legitimate frontend origin exactly.
- MongoDB backups and retention policies remain deployment responsibilities.

## Validation commands

```bash
cd backend
npm ci
npm run check
npm audit --omit=dev
```
