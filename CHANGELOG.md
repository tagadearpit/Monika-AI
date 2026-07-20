# Changelog


## 3.0.1 - 2026-07-19

### Fixed
- Added a real client-side typewriter renderer for streamed responses, including a visible caret and an immediate fallback when animations are disabled.
- Prevented blank temporary Monika bubbles when a stream is stopped or fails.
- Closed the settings modal and returned keyboard focus to chat after saving preferences.
- Replaced the initial login-page flash with a secure session-restoration screen while the HttpOnly refresh cookie is checked.
- Bumped the PWA cache version so browsers receive the updated frontend immediately.

### Security
- Persistent authentication remains in a revocable HttpOnly cookie; no access token or raw session credential is stored in localStorage.

## 3.0.0 - 2026-07-13

### Conversations

- Added separate `Conversation` and `Message` collections.
- Added automatic migration of legacy chat records.
- Added create, rename, pin, delete, clear-all, search, and export operations.
- Added TXT, Markdown, and PDF export.

### AI experience

- Added Gemini response streaming over Server-Sent Events.
- Added stop, regenerate, continue, edit-and-resend, and copy controls.
- Added accurate user-timezone date and time context.
- Added response feedback and report records.

### Memory and personalization

- Added editable memory with source and confidence fields.
- Added memory disable and clear controls.
- Added preferred name, persona, response length, language, speech voice, theme, text size, sound, auto-read, typing animation, journal, and hands-free settings.

### Attachments and voice

- Added validated image, PDF, text, and Markdown attachments.
- Added attachment preview/removal and camera capture.
- Added hands-free speech mode and response playback controls.

### Sessions and security

- Added active-device management and current-device detection.
- Added revoke-one and revoke-other-device operations.
- Added refresh-token reuse detection and security audit events.
- Added CSRF protection and Zod request validation.
- Removed `unsafe-eval` from Content Security Policy.
- Added optional login notification emails.

### Reminders and journal

- Added reminders with one-time, daily, and weekly recurrence.
- Added natural-language reminder parsing.
- Added in-app reminder polling and optional Web Push delivery.
- Added opt-in daily and weekly recaps.

### Administration and operations

- Added a backend-authorized administrator dashboard.
- Added usage, session, report, and failure metrics.
- Added user suspension controls.
- Added per-user daily message and image quotas.
- Added request duration and Gemini latency logs.
- Added smoke tests and optional MongoDB integration tests.

## 2.0.0 - 2026-07-10

- Added persistent MongoDB-backed authentication sessions.
- Added rotating secure refresh cookies and short-lived access tokens.
- Added multi-tab authentication synchronization.
- Added OTP hardening, health checks, graceful shutdown, Docker, and Render configuration.
