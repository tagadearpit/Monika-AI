# Security Policy

## Supported version

| Version | Supported |
|---|---|
| 2.x | Yes |
| 1.x and older | No |

## Security controls

Monika AI v2 uses short-lived access tokens, hashed server-side refresh sessions, `HttpOnly`/`Secure`/`SameSite` cookies, strict CORS allowlists, Helmet security headers, input limits, rate limiting, OTP attempt limits, HMAC-protected OTP records, timing-safe OTP comparison, and MongoDB isolation by authenticated user identity.

## Deployment requirements

- Use HTTPS in production.
- Use Node.js 22 or newer.
- Keep `JWT_SECRET`, `OTP_SECRET`, SMTP credentials, MongoDB credentials, Gemini keys, and Firebase service-account material outside source control.
- Use at least 32 random characters for each secret and do not reuse secrets.
- Set `ALLOWED_ORIGINS` to exact trusted origins only.
- Restrict MongoDB network access and use a least-privilege database user.
- Rotate credentials after any suspected disclosure.
- Use a shared rate-limit store when running multiple server instances.

## Reporting a vulnerability

Do not open a public issue containing credentials, exploit details, private user data, or active production endpoints. Report privately to the repository owner with:

- affected version and commit
- reproduction steps
- expected and actual behavior
- impact assessment
- relevant logs with secrets removed

Do not test against production accounts or data without explicit authorization.
