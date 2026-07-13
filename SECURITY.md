# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 3.x | Yes |
| 2.x | Security fixes only |
| 1.x and older | No |

## Included controls

Monika AI v3 includes:

- short-lived access tokens
- rotating opaque refresh credentials
- hashed MongoDB session records
- `HttpOnly`, `Secure`, and `SameSite=Lax` production cookies
- refresh-token reuse detection
- device-level session revocation
- CSRF double-submit protection
- exact CORS origin allowlists
- Helmet security headers
- request-size limits
- schema validation with Zod
- IP and per-user rate/usage limits
- HMAC-protected OTP records
- timing-safe OTP comparison
- authenticated ownership checks
- backend role authorization for administration
- structured security audit events
- account-wide session revocation on deletion

## Deployment requirements

- Use HTTPS in production.
- Use Node.js 22 or newer.
- Keep `.env`, database credentials, Gemini keys, SMTP credentials, VAPID private keys, JWT secrets, OTP secrets, and Firebase service-account data outside source control.
- Generate `JWT_SECRET` and `OTP_SECRET` independently with strong randomness.
- Set `ALLOWED_ORIGINS` to exact trusted origins only.
- Never use `*` with credentialed CORS.
- Restrict MongoDB network access and use a least-privilege database user.
- Configure backups and retention policies.
- Use a shared rate-limit store and dedicated job queue before horizontal scaling.
- Review `ADMIN_EMAILS` and active sessions regularly.
- Rotate credentials after any suspected disclosure.

## Privacy and logging

The server must not log:

- access or refresh tokens
- OTP values
- passwords or API keys
- Firebase service-account JSON
- full private chat content by default
- raw attachment data

IP addresses are not stored directly for sessions. A keyed hash is used for security correlation.

## Remaining hardening work

The current UI still requires inline script/style compatibility for some third-party widgets. `unsafe-eval` is removed, but removing all inline allowances requires a nonce/hash migration and frontend refactor.

Web Push and reminder processing are optional. For strong delivery guarantees, run them through a dedicated queue and worker rather than the web process.

## Reporting a vulnerability

Do not open a public issue containing credentials, exploit details, private user data, or active production endpoints. Report privately to the repository owner with:

- affected version and commit
- reproduction steps
- expected and actual behavior
- impact assessment
- sanitized logs

Do not test against production accounts or data without explicit authorization.
