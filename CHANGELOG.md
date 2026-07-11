# Changelog

## 2.0.0 - 2026-07-10

### Authentication

- Replaced `sessionStorage`-only JWT persistence with MongoDB-backed persistent sessions.
- Added rotating opaque refresh cookies with `HttpOnly`, `Secure`, and `SameSite=Lax` controls.
- Added short-lived in-memory access tokens and automatic refresh/retry.
- Added legacy v1 token upgrade.
- Added session revocation on logout and all-session revocation on account deletion.
- Added multi-tab refresh locking and login/logout synchronization.
- Added explicit Firebase `LOCAL` browser persistence for phone authentication.

### Security

- Added OTP HMAC hashing, timing-safe comparison, normalized email identities, and reliable TTL reset.
- Added request IDs, stricter CORS handling, no-store auth responses, origin checks for cookie-authenticated mutations, and improved security headers.
- Removed unused HTTP dependencies.
- Upgraded Nodemailer and resolved all npm audit findings.
- Migrated Firebase Admin usage to modular imports for v14.

### Reliability and operations

- Added health/readiness endpoints and graceful shutdown.
- Added MongoDB pool configuration.
- Added safer transient-network behavior for history and authentication.
- Added Dockerfile, Render blueprint, `.env.example`, and deployment documentation.

### Client features

- Added message draft recovery.
- Added persisted theme selection.
- Added a versioned PWA cache that excludes APIs.
- Added camera and speech resource cleanup.

### UI

- Existing HTML structure and CSS design were retained.
