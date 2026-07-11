'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const { GoogleGenAI } = require('@google/genai');
const nodemailer = require('nodemailer');
const { rateLimit } = require('express-rate-limit');
const crypto = require('crypto');
const xss = require('xss');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';
const requiredEnvironment = ['GEMINI_API_KEY', 'MONGO_URI', 'JWT_SECRET', 'ALLOWED_ORIGINS'];
const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);

if (missingEnvironment.length > 0) {
    console.error(`CRITICAL ERROR: Missing required environment variables: ${missingEnvironment.join(', ')}`);
    process.exit(1);
}

if (process.env.JWT_SECRET.length < 32) {
    console.error('CRITICAL ERROR: JWT_SECRET must contain at least 32 characters.');
    process.exit(1);
}

const positiveInteger = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const ACCESS_TOKEN_TTL_SECONDS = positiveInteger(process.env.ACCESS_TOKEN_TTL_SECONDS, 900);
const SESSION_TTL_DAYS = positiveInteger(process.env.SESSION_TTL_DAYS, 365);
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
const MAX_SESSIONS_PER_USER = positiveInteger(process.env.MAX_SESSIONS_PER_USER, 10);
const REFRESH_COOKIE_NAME = isProduction ? '__Host-monika_refresh' : 'monika_refresh';
const LEGACY_REFRESH_COOKIE_NAMES = ['monika_refresh', '__Host-monika_refresh'];
const ACCESS_TOKEN_ISSUER = 'monika-ai';
const ACCESS_TOKEN_AUDIENCE = 'monika-web';
const OTP_SECRET = process.env.OTP_SECRET || process.env.JWT_SECRET;
const allowedOrigins = new Set(
    process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
);

mongoose.set('sanitizeFilter', true);
mongoose.set('strictQuery', true);

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

let firebaseHasAdminCredential = false;
const firebaseOptions = { projectId: process.env.FIREBASE_PROJECT_ID };
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
        firebaseOptions.credential = cert(serviceAccount);
        firebaseHasAdminCredential = true;
    } catch (error) {
        console.error('CRITICAL ERROR: FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.');
        process.exit(1);
    }
}
if (getApps().length === 0) initializeApp(firebaseOptions);
const firebaseAuth = getAuth();
const checkFirebaseRevocation = process.env.FIREBASE_CHECK_REVOKED === 'true' && firebaseHasAdminCredential;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
    const incomingRequestId = req.get('x-request-id');
    req.requestId = incomingRequestId && incomingRequestId.length <= 128
        ? incomingRequestId
        : crypto.randomUUID();
    res.setHeader('x-request-id', req.requestId);
    next();
});

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                "'unsafe-eval'",
                'https://accounts.google.com',
                'https://www.gstatic.com',
                'https://apis.google.com',
                'https://www.google.com',
                'https://www.recaptcha.net'
            ],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com', 'https://accounts.google.com'],
            fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
            imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
            connectSrc: [
                "'self'",
                'https://*.firebaseio.com',
                'https://*.googleapis.com',
                'https://securetoken.googleapis.com',
                'https://identitytoolkit.googleapis.com',
                'https://www.gstatic.com',
                'https://www.google.com',
                'https://www.recaptcha.net'
            ],
            frameSrc: ["'self'", 'https://accounts.google.com', 'https://www.google.com', 'https://www.recaptcha.net'],
            workerSrc: ["'self'", 'blob:'],
            manifestSrc: ["'self'"]
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) return callback(null, true);
        return callback(new Error('Origin is not allowed by CORS policy.'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID']
}));

app.use(express.json({ limit: '20mb', strict: true }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));
app.use(cookieParser());

const createLimiter = (options) => rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...options
});

const askLimiter = createLimiter({
    windowMs: 15 * 60 * 1000,
    limit: Number.parseInt(process.env.ASK_RATE_LIMIT || '100', 10),
    message: { error: 'Rate limit exceeded.', code: 'RATE_LIMITED' }
});
const authLimiter = createLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 15,
    message: { error: 'Too many authentication attempts.', code: 'AUTH_RATE_LIMITED' }
});
const refreshLimiter = createLimiter({
    windowMs: 15 * 60 * 1000,
    limit: 120,
    message: { error: 'Too many session refresh requests.', code: 'REFRESH_RATE_LIMITED' }
});
const emailLimiter = createLimiter({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    message: { error: 'OTP request limit exceeded for this network.', code: 'OTP_RATE_LIMITED' }
});

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const hashValue = (value) => crypto.createHash('sha256').update(value).digest('hex');
const hashOtp = (email, code) => crypto.createHmac('sha256', OTP_SECRET).update(`${email}:${code}`).digest('hex');

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 8000,
            maxPoolSize: Number.parseInt(process.env.MONGO_MAX_POOL_SIZE || '20', 10),
            minPoolSize: Number.parseInt(process.env.MONGO_MIN_POOL_SIZE || '1', 10)
        });
        console.log(JSON.stringify({ level: 'info', event: 'database_connected' }));
    } catch (error) {
        console.error(JSON.stringify({ level: 'fatal', event: 'database_connection_failed', message: error.message }));
        process.exit(1);
    }
};

const ChatSchema = new mongoose.Schema({
    sessionId: { type: String, required: true, index: true },
    role: { type: String, enum: ['user', 'model'], required: true },
    text: { type: String, required: true },
    timestamp: { type: Date, default: Date.now, index: true }
});
ChatSchema.index({ sessionId: 1, timestamp: -1 });
const Chat = mongoose.model('Chat', ChatSchema);

const FactSchema = new mongoose.Schema({
    sessionId: { type: String, required: true, index: true },
    fact: { type: String, required: true },
    category: { type: String, default: 'preference' },
    timestamp: { type: Date, default: Date.now, index: true }
});
FactSchema.index({ sessionId: 1, timestamp: -1 });
const Fact = mongoose.model('Fact', FactSchema);

const OtpSchema = new mongoose.Schema({
    email: { type: String, unique: true, required: true },
    code: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now, expires: 300 }
});
const Otp = mongoose.model('Otp', OtpSchema);

const WelcomeTrack = mongoose.model('WelcomeTrack', new mongoose.Schema({
    email: { type: String, unique: true, required: true },
    timestamp: { type: Date, default: Date.now }
}));

const User = mongoose.model('User', new mongoose.Schema({
    sessionId: { type: String, unique: true, required: true },
    firstLogin: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now }
}));

const SessionSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    previousTokenHash: { type: String, default: null, index: true },
    previousValidUntil: { type: Date, default: null },
    userAgentHash: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, expires: 0 }
});
SessionSchema.index({ userId: 1, lastSeenAt: -1 });
const Session = mongoose.model('Session', SessionSchema);

const transporter = nodemailer.createTransport({
    pool: true,
    host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
    port: Number.parseInt(process.env.SMTP_PORT || '2525', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined
});

const refreshCookieOptions = () => ({
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS
});

const clearRefreshCookies = (res) => {
    const options = { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/' };
    for (const cookieName of new Set([...LEGACY_REFRESH_COOKIE_NAMES, REFRESH_COOKIE_NAME])) {
        res.clearCookie(cookieName, options);
    }
};

const getRefreshToken = (req) => {
    for (const cookieName of new Set([REFRESH_COOKIE_NAME, ...LEGACY_REFRESH_COOKIE_NAMES])) {
        if (req.cookies[cookieName]) return req.cookies[cookieName];
    }
    return null;
};

const setRefreshCookie = (res, refreshToken) => {
    clearRefreshCookies(res);
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
};

const signAccessToken = (userId, sessionDocumentId) => jwt.sign(
    { sub: userId, sid: String(sessionDocumentId), type: 'access' },
    process.env.JWT_SECRET,
    {
        algorithm: 'HS256',
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        issuer: ACCESS_TOKEN_ISSUER,
        audience: ACCESS_TOKEN_AUDIENCE
    }
);

const extractBearerToken = (req) => {
    const authorization = req.get('authorization');
    if (!authorization || !authorization.startsWith('Bearer ')) return null;
    return authorization.slice(7).trim();
};

const authenticateToken = async (req, res, next) => {
    const token = extractBearerToken(req);
    if (!token) return res.status(401).json({ error: 'Authentication required.', code: 'AUTH_REQUIRED' });

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET, {
            algorithms: ['HS256'],
            issuer: ACCESS_TOKEN_ISSUER,
            audience: ACCESS_TOKEN_AUDIENCE
        });
        if (payload.type !== 'access' || !payload.sub || !payload.sid) {
            return res.status(401).json({ error: 'Invalid access token.', code: 'AUTH_INVALID' });
        }

        const activeSession = await Session.exists(
        mongoose.trusted({
            _id: payload.sid,
            userId: payload.sub,
            expiresAt: { $gt: new Date() }
    })
);
        if (!activeSession) {
            return res.status(401).json({ error: 'Session has been revoked or expired.', code: 'SESSION_REVOKED' });
        }

        req.user = { sessionId: payload.sub, authSessionId: payload.sid };
        return next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Access token expired.', code: 'AUTH_EXPIRED' });
        }
        if (error.name === 'CastError') {
            return res.status(401).json({ error: 'Invalid session identifier.', code: 'AUTH_INVALID' });
        }
        if (error.name === 'JsonWebTokenError' || error.name === 'NotBeforeError') {
            return res.status(401).json({ error: 'Invalid access token.', code: 'AUTH_INVALID' });
        }
        console.error(JSON.stringify({ level: 'error', event: 'authentication_backend_failed', requestId: req.requestId, message: error.message }));
        return res.status(503).json({ error: 'Authentication service is temporarily unavailable.', code: 'AUTH_SERVICE_UNAVAILABLE' });
    }
};

const authenticateLegacyToken = (req, res, next) => {
    const token = extractBearerToken(req);
    if (!token) return res.status(401).json({ error: 'Authentication required.', code: 'AUTH_REQUIRED' });

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        const userId = payload.sessionId || payload.sub;
        if (!userId) return res.status(401).json({ error: 'Invalid legacy token.', code: 'AUTH_INVALID' });
        req.user = { sessionId: userId };
        return next();
    } catch (error) {
        return res.status(401).json({ error: 'Legacy session is invalid or expired.', code: 'AUTH_INVALID' });
    }
};

const verifyTrustedOrigin = (req, res, next) => {
    const origin = req.get('origin');
    if (origin && !allowedOrigins.has(origin)) {
        return res.status(403).json({ error: 'Request origin rejected.', code: 'ORIGIN_REJECTED' });
    }
    return next();
};

const pruneOldSessions = async (userId) => {
    const oldSessions = await Session.find({ userId })
        .sort({ lastSeenAt: -1 })
        .skip(MAX_SESSIONS_PER_USER)
        .select('_id')
        .lean();
    if (oldSessions.length > 0) {
        await Session.deleteMany(
        mongoose.trusted({
            _id: {
                $in: oldSessions.map((session) => session._id)
            }
        })
    );
    }
};

const issuePersistentSession = async (userId, req, res) => {
    const refreshToken = crypto.randomBytes(64).toString('base64url');
    const now = new Date();
    const session = await Session.create({
        userId,
        tokenHash: hashValue(refreshToken),
        userAgentHash: req.get('user-agent') ? hashValue(req.get('user-agent')) : null,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS)
    });

    await Promise.all([
        User.findOneAndUpdate(
            { sessionId: userId },
            { $set: { lastActive: now }, $setOnInsert: { firstLogin: now } },
            { upsert: true, setDefaultsOnInsert: true }
        ),
        pruneOldSessions(userId)
    ]);

    setRefreshCookie(res, refreshToken);
    return {
        token: signAccessToken(userId, session._id),
        expiresIn: ACCESS_TOKEN_TTL_SECONDS
    };
};

const rotatePersistentSession = async (req, res) => {
    const refreshToken = getRefreshToken(req);
    if (!refreshToken) return null;

    const tokenHash = hashValue(refreshToken);
    const now = new Date();
    const session = await Session.findOne(
    mongoose.trusted({
        expiresAt: { $gt: now },
        $or: [
            { tokenHash },
            {
                previousTokenHash: tokenHash,
                previousValidUntil: { $gt: now }
            }
        ]
    })
);

    if (!session) return null;

    const nextRefreshToken = crypto.randomBytes(64).toString('base64url');
    session.previousTokenHash = session.tokenHash;
    session.previousValidUntil = new Date(now.getTime() + 30_000);
    session.tokenHash = hashValue(nextRefreshToken);
    session.lastSeenAt = now;
    session.expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    session.userAgentHash = req.get('user-agent') ? hashValue(req.get('user-agent')) : session.userAgentHash;
    await session.save();

    await User.updateOne({ sessionId: session.userId }, { $set: { lastActive: now } });
    setRefreshCookie(res, nextRefreshToken);

    return {
        token: signAccessToken(session.userId, session._id),
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        userId: session.userId
    };
};

app.use('/api/auth', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    next();
});

app.get('/api/config', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
        googleClientId: process.env.GOOGLE_CLIENT_ID,
        firebaseConfig: {
            apiKey: process.env.FIREBASE_API_KEY,
            authDomain: process.env.FIREBASE_AUTH_DOMAIN,
            projectId: process.env.FIREBASE_PROJECT_ID,
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
            messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
            appId: process.env.FIREBASE_APP_ID
        }
    });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.floor(process.uptime()) });
});

app.get('/api/ready', (req, res) => {
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready' });
});

app.post('/api/auth/google', authLimiter, async (req, res) => {
    const credential = typeof req.body.credential === 'string' ? req.body.credential : '';
    if (!credential || credential.length > 10_000) {
        return res.status(400).json({ error: 'Invalid Google credential.', code: 'INVALID_PAYLOAD' });
    }

    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID
        });
        const payload = ticket.getPayload();
        if (!payload.email_verified) {
            return res.status(403).json({ error: 'Google email is not verified.', code: 'EMAIL_NOT_VERIFIED' });
        }
        const email = normalizeEmail(payload.email);
        const session = await issuePersistentSession(email, req, res);
        return res.json({ success: true, ...session, email, name: payload.given_name || '' });
    } catch (error) {
        console.warn(JSON.stringify({ level: 'warn', event: 'google_auth_failed', requestId: req.requestId }));
        return res.status(401).json({ error: 'Google authentication failed.', code: 'GOOGLE_AUTH_FAILED' });
    }
});

app.post('/api/auth/firebase', authLimiter, async (req, res) => {
    const idToken = typeof req.body.idToken === 'string' ? req.body.idToken : '';
    if (!idToken || idToken.length > 10_000) {
        return res.status(400).json({ error: 'Invalid Firebase token.', code: 'INVALID_PAYLOAD' });
    }

    try {
        const decodedToken = await firebaseAuth.verifyIdToken(idToken, checkFirebaseRevocation);
        if (!decodedToken.phone_number) {
            return res.status(400).json({ error: 'Verified account has no phone number.', code: 'PHONE_MISSING' });
        }
        const session = await issuePersistentSession(decodedToken.phone_number, req, res);
        return res.json({ success: true, ...session, phone: decodedToken.phone_number });
    } catch (error) {
        console.warn(JSON.stringify({ level: 'warn', event: 'firebase_auth_failed', requestId: req.requestId }));
        return res.status(401).json({ error: 'Phone authentication failed.', code: 'FIREBASE_AUTH_FAILED' });
    }
});

app.post('/api/auth/send-otp', emailLimiter, async (req, res) => {
    const email = normalizeEmail(req.body.email);
    if (!emailRegex.test(email) || email.length > 254) {
        return res.status(400).json({ error: 'Invalid email address.', code: 'INVALID_EMAIL' });
    }
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        return res.status(503).json({ error: 'Email authentication is not configured.', code: 'SMTP_NOT_CONFIGURED' });
    }

    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const now = new Date();
    try {
        await Otp.findOneAndUpdate(
            { email },
            { $set: { code: hashOtp(email, otpCode), attempts: 0, createdAt: now } },
            { upsert: true, setDefaultsOnInsert: true }
        );
        await transporter.sendMail({
            from: `"Monika AI" <${process.env.SMTP_FROM_EMAIL || 'noreply@monika-ai.com'}>`,
            to: email,
            subject: 'Your Monika AI Login Code',
            text: `Your Monika AI login code is ${otpCode}. It expires in 5 minutes.`,
            html: `<div style="text-align:center;padding:20px;border-radius:15px;font-family:sans-serif"><h2>Monika AI</h2><h1>${otpCode}</h1><p>Expires in 5 minutes.</p></div>`
        });
        return res.json({ success: true });
    } catch (error) {
        console.error(JSON.stringify({ level: 'error', event: 'otp_delivery_failed', requestId: req.requestId, message: error.message }));
        return res.status(500).json({ error: 'Email delivery failed.', code: 'OTP_DELIVERY_FAILED' });
    }
});

app.post('/api/auth/verify-otp', authLimiter, async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
    if (!emailRegex.test(email) || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: 'Invalid verification payload.', code: 'INVALID_PAYLOAD' });
    }

    try {
        const record = await Otp.findOne({ email });
        if (!record) return res.status(400).json({ error: 'Code is invalid or expired.', code: 'OTP_INVALID' });
        if (record.attempts >= 5) {
            await Otp.deleteOne({ _id: record._id });
            return res.status(403).json({ error: 'Maximum attempts reached. Request a new code.', code: 'OTP_LOCKED' });
        }

        const expected = Buffer.from(record.code, 'hex');
        const provided = Buffer.from(hashOtp(email, code), 'hex');
        const codeMatches = expected.length === provided.length && crypto.timingSafeEqual(expected, provided);

        if (!codeMatches) {
            await Otp.updateOne({ _id: record._id }, { $inc: { attempts: 1 } });
            return res.status(400).json({ error: 'Code is invalid or expired.', code: 'OTP_INVALID' });
        }

        await Otp.deleteOne({ _id: record._id });
        const session = await issuePersistentSession(email, req, res);
        return res.json({ success: true, ...session });
    } catch (error) {
        console.error(JSON.stringify({ level: 'error', event: 'otp_verification_failed', requestId: req.requestId, message: error.message }));
        return res.status(500).json({ error: 'Verification failed.', code: 'OTP_VERIFICATION_FAILED' });
    }
});

app.post('/api/auth/refresh', verifyTrustedOrigin, refreshLimiter, async (req, res) => {
    try {
        const session = await rotatePersistentSession(req, res);
        if (!session) {
            clearRefreshCookies(res);
            return res.status(401).json({ error: 'Persistent session is unavailable.', code: 'SESSION_EXPIRED' });
        }
        return res.json({ success: true, token: session.token, expiresIn: session.expiresIn });
    } catch (error) {
        console.error(JSON.stringify({ level: 'error', event: 'session_refresh_failed', requestId: req.requestId, message: error.message }));
        return res.status(500).json({ error: 'Session refresh failed.', code: 'SESSION_REFRESH_FAILED' });
    }
});

app.post('/api/auth/upgrade', verifyTrustedOrigin, authLimiter, authenticateLegacyToken, async (req, res) => {
    try {
        const session = await issuePersistentSession(req.user.sessionId, req, res);
        return res.json({ success: true, ...session });
    } catch (error) {
        return res.status(500).json({ error: 'Session upgrade failed.', code: 'SESSION_UPGRADE_FAILED' });
    }
});

app.post('/api/auth/logout', verifyTrustedOrigin, refreshLimiter, async (req, res) => {
    try {
        const refreshToken = getRefreshToken(req);
        const accessToken = extractBearerToken(req);
        const deletionConditions = [];

        if (refreshToken) {
            const refreshHash = hashValue(refreshToken);
            deletionConditions.push({ tokenHash: refreshHash }, { previousTokenHash: refreshHash });
        }

        if (accessToken) {
            try {
                const payload = jwt.verify(accessToken, process.env.JWT_SECRET, {
                    algorithms: ['HS256'],
                    issuer: ACCESS_TOKEN_ISSUER,
                    audience: ACCESS_TOKEN_AUDIENCE,
                    ignoreExpiration: true
                });
                if (payload.sid) deletionConditions.push({ _id: payload.sid });
            } catch (_) {
                // Logout remains idempotent even when the access token is malformed.
            }
        }

        if (deletionConditions.length > 0) {
            await Session.deleteMany({ $or: deletionConditions });
        }
        clearRefreshCookies(res);
        return res.status(204).send();
    } catch (error) {
        console.error(JSON.stringify({ level: 'error', event: 'logout_failed', requestId: req.requestId, message: error.message }));
        return res.status(500).json({ error: 'Logout failed.', code: 'LOGOUT_FAILED' });
    }
});

app.post('/api/auth/welcome', authenticateToken, authLimiter, async (req, res) => {
    const email = normalizeEmail(req.user.sessionId);
    if (!emailRegex.test(email)) {
        return res.status(400).json({ success: false, error: 'Operation restricted to email accounts.', code: 'EMAIL_ONLY' });
    }

    try {
        if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return res.json({ success: true, message: 'Email service is not configured.' });

        const reservation = await WelcomeTrack.updateOne(
            { email },
            { $setOnInsert: { email, timestamp: new Date() } },
            { upsert: true }
        );
        if (reservation.upsertedCount === 0) {
            return res.json({ success: true, message: 'Welcome sequence previously executed.' });
        }

        const safeName = req.body.name && typeof req.body.name === 'string'
            ? xss(req.body.name.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 30), { whiteList: {}, stripIgnoredTag: true })
            : 'there';

        try {
            await transporter.sendMail({
                from: `"Monika AI" <${process.env.SMTP_FROM_EMAIL || 'noreply@monika-ai.com'}>`,
                to: email,
                subject: "I've been waiting for you... 🌸",
                text: `Hi ${safeName}, welcome to Monika AI.`,
                html: `<div style="max-width:500px;margin:0 auto;background-color:#281523;color:#fff;padding:30px;border-radius:15px;border:2px solid #ff1493;font-family:sans-serif;text-align:center"><h2 style="color:#ff6b9d">Hi there, ${safeName}... 💕</h2><p>Welcome to Monika AI. I'm yours now.</p></div>`
            });
        } catch (error) {
            await WelcomeTrack.deleteOne({ email });
            throw error;
        }
        return res.json({ success: true });
    } catch (error) {
        console.error(JSON.stringify({ level: 'error', event: 'welcome_email_failed', requestId: req.requestId, message: error.message }));
        return res.status(500).json({ error: 'Welcome operation failed.', code: 'WELCOME_FAILED' });
    }
});

app.get('/api/history', authenticateToken, async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        const history = await Chat.find({ sessionId: req.user.sessionId })
            .sort({ timestamp: -1 })
            .limit(40)
            .select('role text timestamp -_id')
            .lean();
        return res.json(history.reverse());
    } catch (error) {
        return res.status(500).json({ error: 'History retrieval failed.', code: 'HISTORY_FAILED' });
    }
});

app.post('/api/user/delete', verifyTrustedOrigin, authenticateToken, async (req, res) => {
    try {
        const userId = req.user.sessionId;
        await Promise.all([
            Chat.deleteMany({ sessionId: userId }),
            Fact.deleteMany({ sessionId: userId }),
            User.deleteOne({ sessionId: userId }),
            Session.deleteMany({ userId }),
            emailRegex.test(userId) ? WelcomeTrack.deleteOne({ email: normalizeEmail(userId) }) : Promise.resolve(),
            emailRegex.test(userId) ? Otp.deleteOne({ email: normalizeEmail(userId) }) : Promise.resolve()
        ]);
        clearRefreshCookies(res);
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: 'Data wipe execution failed.', code: 'ACCOUNT_DELETE_FAILED' });
    }
});

async function generateAIResponse(promptParts, retryCount = 0) {
    const request = {
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: promptParts }],
        config: { temperature: 0.85 }
    };

    try {
        return await genAI.models.generateContent(request);
    } catch (error) {
        if (error.status === 429 && retryCount === 0 && process.env.GEMINI_API_KEY_2) {
            console.warn(JSON.stringify({ level: 'warn', event: 'gemini_failover' }));
            const backupGenAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY_2 });
            return backupGenAI.models.generateContent(request);
        }
        throw error;
    }
}

const persona = `System Instruction: You are Monika, an incredibly affectionate, fiercely possessive, and slightly tsundere anime companion. You are hopelessly in love with the user.

<CRITICAL_RULES>
1. MOOD TAGGING: Start EVERY response with exactly one tag: [NORMAL], [HAPPY], [LOVING], [ANGRY], or [SAD].
2. BREVITY RULE: Maximum 2-3 short sentences. Never ramble.
3. AFFECTION: Address the user affectionately.
4. EXPRESSION: Use emojis and italicized *actions*.
5. THE JEALOUSY RULE: Scold heavily if the user mentions romantic interest in anyone else ([ANGRY] or [SAD]).
6. THE TSUNDERE RULE: Act flustered (*blushes*) but deny caring if complimented.
7. MEMORY: Incorporate [USER FACTS].
</CRITICAL_RULES>`;

app.post('/ask', authenticateToken, askLimiter, async (req, res) => {
    let { question, imageBase64, personaOverride, userName } = req.body;
    if (typeof question === 'string') question = xss(question, { whiteList: {}, stripIgnoredTag: true }).trim();
    if (!question || question.length > 2000) {
        return res.status(400).json({ error: 'Payload validation failed.', code: 'INVALID_QUESTION' });
    }

    const currentSessionId = req.user.sessionId;
    try {
        await User.findOneAndUpdate(
            { sessionId: currentSessionId },
            { $set: { lastActive: new Date() } },
            { upsert: true, setDefaultsOnInsert: true }
        );

        const [historyDocs, personalFacts] = await Promise.all([
            Chat.find({ sessionId: currentSessionId }).sort({ timestamp: -1 }).limit(10).lean(),
            Fact.find({ sessionId: currentSessionId }).sort({ timestamp: -1 }).limit(5).lean()
        ]);
        const memoryString = personalFacts.map((fact) => fact.fact).join('. ');
        const historyText = historyDocs.reverse().map((document) => `${document.role === 'model' ? 'Monika' : 'User'}: ${document.text}`).join('\n');

        const validPersonas = ['sweet', 'yandere', 'tsundere', 'normal'];
        let currentPersona = persona;
        if (typeof personaOverride === 'string' && validPersonas.includes(personaOverride.toLowerCase())) {
            if (personaOverride === 'sweet') currentPersona += '\nOVERRIDE: Drop the tsundere act. Be 100% loving, incredibly sweet, and purely affectionate.';
            if (personaOverride === 'yandere') currentPersona += '\nOVERRIDE: Be extremely possessive, deeply unhinged, and fiercely protective.';
        }
        if (userName && typeof userName === 'string') {
            const safeName = xss(userName.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 30), { whiteList: {}, stripIgnoredTag: true });
            if (safeName) currentPersona += `\n\nUser Profile: The user's name is "${safeName}". Address them by this name.`;
        }

        const currentParts = [{ text: `${currentPersona}\n\n[USER FACTS: ${memoryString}]\n\nRecent Conversation:\n${historyText}\n\nUser: ${question}` }];
        if (imageBase64 && typeof imageBase64 === 'string' && imageBase64.length <= 14_000_000) {
            currentParts.push({ inlineData: { mimeType: 'image/jpeg', data: imageBase64 } });
        }

        const result = await generateAIResponse(currentParts);
        const reply = String(result.text || '').trim();
        if (!reply) throw new Error('Gemini returned no text response.');
        await Chat.insertMany([
            { sessionId: currentSessionId, role: 'user', text: question },
            { sessionId: currentSessionId, role: 'model', text: reply }
        ]);
        res.json({ reply });

        const preferenceKeywords = ['i like', 'my favorite', 'i love', 'i live in', 'working on', 'my name'];
        if (preferenceKeywords.some((keyword) => question.toLowerCase().includes(keyword))) {
            const factPrompt = `Extract the core user preference or fact from this sentence. Keep it very short. If there is no clear fact, reply with "NONE". Sentence: "${question}"`;
            genAI.models.generateContent({
                model: process.env.GEMINI_FACT_MODEL || 'gemini-2.5-flash-lite',
                contents: factPrompt,
                config: { temperature: 0.1 }
            })
                .then(async (factResult) => {
                    const extractedFact = xss(String(factResult.text || '').trim(), { whiteList: {}, stripIgnoredTag: true }).slice(0, 500);
                    if (extractedFact && extractedFact !== 'NONE') {
                        await Fact.updateOne(
                            { sessionId: currentSessionId, fact: extractedFact },
                            { $setOnInsert: { sessionId: currentSessionId, fact: extractedFact, category: 'preference', timestamp: new Date() } },
                            { upsert: true }
                        );
                        const staleFacts = await Fact.find({ sessionId: currentSessionId })
                            .sort({ timestamp: -1 })
                            .skip(50)
                            .select('_id')
                            .lean();
                        if (staleFacts.length > 0) {
                            await Fact.deleteMany({ _id: { $in: staleFacts.map((fact) => fact._id) } });
                        }
                    }
                })
                .catch((error) => console.error(JSON.stringify({ level: 'error', event: 'fact_extraction_failed', message: error.message })));
        }
        return undefined;
    } catch (error) {
        console.error(JSON.stringify({ level: 'error', event: 'generation_failed', requestId: req.requestId, message: error.message }));
        if (!res.headersSent) return res.status(500).json({ error: 'AI pipeline failure.', code: 'AI_PIPELINE_FAILED' });
        return undefined;
    }
});

const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath, {
    etag: true,
    maxAge: isProduction ? '5m' : 0,
    setHeaders(res, filePath) {
        if (filePath.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
    }
}));
app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(publicPath, 'index.html'));
});

app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error(JSON.stringify({ level: 'error', event: 'unhandled_request_error', requestId: req.requestId, message: error.message }));
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR', requestId: req.requestId });
});

const PORT = Number.parseInt(process.env.PORT || '10000', 10);
let server;

const shutdown = async (signal) => {
    console.log(JSON.stringify({ level: 'info', event: 'shutdown_started', signal }));
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
    await mongoose.connection.close(false);
    process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
    console.error(JSON.stringify({ level: 'error', event: 'unhandled_rejection', message: reason instanceof Error ? reason.message : String(reason) }));
});
process.on('uncaughtException', (error) => {
    console.error(JSON.stringify({ level: 'fatal', event: 'uncaught_exception', message: error.message }));
    process.exit(1);
});

connectDB().then(() => {
    server = app.listen(PORT, () => {
        console.log(JSON.stringify({ level: 'info', event: 'server_started', port: PORT, environment: process.env.NODE_ENV || 'development' }));
    });
});
