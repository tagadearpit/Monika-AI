'use strict';

const express = require('express');
require('express-async-errors');
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
const PDFDocument = require('pdfkit');
const webPush = require('web-push');
const {
    LegacyChat,
    Conversation,
    Message,
    Fact,
    Otp,
    WelcomeTrack,
    User,
    Session,
    Reminder,
    PushSubscription,
    AuditEvent,
    UsageDaily
} = require('./models');
const validators = require('./validation');
const {
    positiveInteger,
    normalizeEmail,
    hashValue,
    hashOtp,
    resolveTimeZone,
    getCurrentDateTime,
    parseUserAgent,
    getClientIpHash,
    escapeRegExp,
    sanitizeFileName,
    approximateBase64Bytes,
    dateKeyForTimeZone,
    estimateTokens
} = require('./utils');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';
const requiredEnvironment = ['GEMINI_API_KEY', 'MONGO_URI', 'JWT_SECRET', 'ALLOWED_ORIGINS'];
const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);

if (missingEnvironment.length > 0) {
    console.error(`CRITICAL ERROR: Missing required environment variables: ${missingEnvironment.join(', ')}`);
    if (require.main === module) process.exit(1);
}

if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    console.error('CRITICAL ERROR: JWT_SECRET must contain at least 32 characters.');
    if (require.main === module) process.exit(1);
}

const ACCESS_TOKEN_TTL_SECONDS = positiveInteger(process.env.ACCESS_TOKEN_TTL_SECONDS, 900);
const SESSION_TTL_DAYS = positiveInteger(process.env.SESSION_TTL_DAYS, 365);
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
const MAX_SESSIONS_PER_USER = positiveInteger(process.env.MAX_SESSIONS_PER_USER, 10);
const MAX_DAILY_MESSAGES = positiveInteger(process.env.MAX_DAILY_MESSAGES, 250);
const MAX_DAILY_IMAGES = positiveInteger(process.env.MAX_DAILY_IMAGES, 25);
const MAX_ATTACHMENT_BYTES = positiveInteger(process.env.MAX_ATTACHMENT_BYTES, 8 * 1024 * 1024);
const MAX_TOTAL_ATTACHMENT_BYTES = positiveInteger(process.env.MAX_TOTAL_ATTACHMENT_BYTES, 18 * 1024 * 1024);
const ESTIMATED_COST_PER_MILLION_TOKENS_USD = Math.max(Number.parseFloat(process.env.ESTIMATED_COST_PER_MILLION_TOKENS_USD || '0') || 0, 0);
const DEFAULT_TIME_ZONE = process.env.DEFAULT_TIME_ZONE || 'Asia/Kolkata';
const REFRESH_COOKIE_NAME = isProduction ? '__Host-monika_refresh' : 'monika_refresh';
const LEGACY_REFRESH_COOKIE_NAMES = ['monika_refresh', '__Host-monika_refresh'];
const CSRF_COOKIE_NAME = 'monika_csrf';
const ACCESS_TOKEN_ISSUER = 'monika-ai';
const ACCESS_TOKEN_AUDIENCE = 'monika-web';
const OTP_SECRET = process.env.OTP_SECRET || process.env.JWT_SECRET || 'development-only-secret';
const allowedOrigins = new Set(
    String(process.env.ALLOWED_ORIGINS || 'http://localhost:10000')
        .split(',')
        .map((origin) => origin.trim().replace(/\/$/, ''))
        .filter(Boolean)
);
const adminUsers = new Set(
    String(process.env.ADMIN_EMAILS || '')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
);

mongoose.set('sanitizeFilter', true);
mongoose.set('strictQuery', true);

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || 'missing' });
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

let firebaseAuth = null;
let firebaseHasAdminCredential = false;
if (process.env.FIREBASE_PROJECT_ID || process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const firebaseOptions = { projectId: process.env.FIREBASE_PROJECT_ID };
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        try {
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
            if (serviceAccount.private_key) {
                serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
            }
            firebaseOptions.credential = cert(serviceAccount);
            firebaseHasAdminCredential = true;
        } catch (_) {
            console.error('CRITICAL ERROR: FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.');
            if (require.main === module) process.exit(1);
        }
    }
    if (getApps().length === 0) initializeApp(firebaseOptions);
    firebaseAuth = getAuth();
}
const checkFirebaseRevocation = process.env.FIREBASE_CHECK_REVOKED === 'true' && firebaseHasAdminCredential;

const pushConfigured = Boolean(
    process.env.VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT
);
if (pushConfigured) {
    webPush.setVapidDetails(
        process.env.VAPID_SUBJECT,
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

const log = (level, event, fields = {}) => {
    const payload = { level, event, ...fields };
    const serialized = JSON.stringify(payload);
    if (level === 'error' || level === 'fatal') console.error(serialized);
    else if (level === 'warn') console.warn(serialized);
    else console.log(serialized);
};

app.use((req, res, next) => {
    const incomingRequestId = req.get('x-request-id');
    req.requestId = incomingRequestId && incomingRequestId.length <= 128
        ? incomingRequestId
        : crypto.randomUUID();
    req.startedAt = process.hrtime.bigint();
    res.setHeader('x-request-id', req.requestId);
    res.on('finish', () => {
        if (!req.path.startsWith('/api') && req.path !== '/ask') return;
        const durationMs = Number(process.hrtime.bigint() - req.startedAt) / 1e6;
        const shouldLog = process.env.LOG_ALL_REQUESTS === 'true' || res.statusCode >= 400 || durationMs >= 1000;
        if (shouldLog) {
            log(res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info', 'request_completed', {
                requestId: req.requestId,
                method: req.method,
                path: req.path,
                status: res.statusCode,
                durationMs: Math.round(durationMs)
            });
        }
    });
    next();
});

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
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
        const normalized = origin ? origin.replace(/\/$/, '') : origin;
        if (!normalized || allowedOrigins.has(normalized)) return callback(null, true);
        return callback(new Error('Origin is not allowed by CORS policy.'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-CSRF-Token'],
    exposedHeaders: ['Content-Disposition', 'X-Request-ID']
}));

app.use(express.json({ limit: '24mb', strict: true }));
app.use(express.urlencoded({ limit: '2mb', extended: true }));
app.use(cookieParser());

const createLimiter = (auditAction, options) => rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler(req, res, _next, limiterOptions) {
        AuditEvent.create({
            action: auditAction,
            userId: req.user?.sessionId || null,
            requestId: req.requestId || null,
            metadata: { path: req.path, method: req.method }
        }).catch((error) => log('error', 'audit_write_failed', { action: auditAction, message: error.message }));
        return res.status(limiterOptions.statusCode).json(limiterOptions.message);
    },
    ...options
});

const askLimiter = createLimiter('rate_limit.ask', {
    windowMs: 15 * 60 * 1000,
    limit: positiveInteger(process.env.ASK_RATE_LIMIT, 100),
    message: { error: 'Rate limit exceeded.', code: 'RATE_LIMITED' }
});
const authLimiter = createLimiter('rate_limit.auth', {
    windowMs: 15 * 60 * 1000,
    limit: positiveInteger(process.env.AUTH_RATE_LIMIT, 20),
    message: { error: 'Too many authentication attempts.', code: 'AUTH_RATE_LIMITED' }
});
const refreshLimiter = createLimiter('rate_limit.refresh', {
    windowMs: 15 * 60 * 1000,
    limit: 120,
    message: { error: 'Too many session refresh requests.', code: 'REFRESH_RATE_LIMITED' }
});
const emailLimiter = createLimiter('rate_limit.otp', {
    windowMs: 60 * 60 * 1000,
    limit: 5,
    message: { error: 'OTP request limit exceeded for this network.', code: 'OTP_RATE_LIMITED' }
});

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const transporter = nodemailer.createTransport({
    pool: true,
    host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
    port: positiveInteger(process.env.SMTP_PORT, 2525),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined
});

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 8000,
            maxPoolSize: positiveInteger(process.env.MONGO_MAX_POOL_SIZE, 20),
            minPoolSize: positiveInteger(process.env.MONGO_MIN_POOL_SIZE, 1),
            maxIdleTimeMS: 60_000
        });
        log('info', 'database_connected');
    } catch (error) {
        log('fatal', 'database_connection_failed', { message: error.message });
        throw error;
    }
};

const validateBody = (schema) => (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({
            error: result.error.issues[0]?.message || 'Invalid request payload.',
            code: 'INVALID_PAYLOAD'
        });
    }
    req.validatedBody = result.data;
    return next();
};

const issueCsrfToken = (req, res) => {
    let token = req.cookies[CSRF_COOKIE_NAME];
    if (!token || !/^[a-f\d]{64}$/i.test(token)) token = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE_NAME, token, {
        httpOnly: false,
        secure: isProduction,
        sameSite: 'strict',
        path: '/',
        maxAge: SESSION_TTL_MS
    });
    return token;
};

const verifyTrustedOrigin = (req, res, next) => {
    const origin = req.get('origin');
    const normalized = origin ? origin.replace(/\/$/, '') : null;
    if (normalized && !allowedOrigins.has(normalized)) {
        return res.status(403).json({ error: 'Request origin rejected.', code: 'ORIGIN_REJECTED' });
    }
    return next();
};

const verifyCsrf = (req, res, next) => {
    const cookieToken = req.cookies[CSRF_COOKIE_NAME];
    const headerToken = req.get('x-csrf-token');
    if (!cookieToken || !headerToken) {
        return res.status(403).json({ error: 'CSRF token is required.', code: 'CSRF_REQUIRED' });
    }
    const expected = Buffer.from(cookieToken);
    const supplied = Buffer.from(headerToken);
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
        return res.status(403).json({ error: 'CSRF token is invalid.', code: 'CSRF_INVALID' });
    }
    return next();
};

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

const recordAudit = (action, userId, req, metadata = {}) => {
    if (process.env.NODE_ENV === 'test' && mongoose.connection.readyState !== 1) return;
    AuditEvent.create({
        action,
        userId: userId || null,
        requestId: req?.requestId || null,
        metadata
    }).catch((error) => log('error', 'audit_write_failed', { action, message: error.message }));
};

const sessionMetadata = (req) => {
    const parsed = parseUserAgent(req.get('user-agent'));
    return {
        ...parsed,
        userAgentHash: req.get('user-agent') ? hashValue(req.get('user-agent')) : null,
        lastIpHash: getClientIpHash(req, process.env.JWT_SECRET)
    };
};

const pruneOldSessions = async (userId) => {
    const oldSessions = await Session.find({ userId, revokedAt: null })
        .sort({ lastSeenAt: -1 })
        .skip(MAX_SESSIONS_PER_USER)
        .select('_id')
        .lean();
    if (oldSessions.length > 0) {
        await Session.deleteMany({
            _id: mongoose.trusted({ $in: oldSessions.map((session) => session._id) })
        });
    }
};

const sendLoginNotification = async (userId, metadata) => {
    if (process.env.LOGIN_NOTIFICATION_EMAILS !== 'true' || !emailRegex.test(userId)) return;
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return;
    await transporter.sendMail({
        from: `"Monika AI Security" <${process.env.SMTP_FROM_EMAIL || 'noreply@monika-ai.com'}>`,
        to: userId,
        subject: 'New Monika AI sign-in',
        text: `A new sign-in was detected from ${metadata.browser} on ${metadata.operatingSystem}. If this was not you, open Monika AI and revoke the device session.`,
        html: `<div style="font-family:sans-serif"><h2>New sign-in detected</h2><p>Browser: ${metadata.browser}</p><p>System: ${metadata.operatingSystem}</p><p>If this was not you, revoke the session from Manage Devices.</p></div>`
    });
};

const issuePersistentSession = async (userId, req, res) => {
    const refreshToken = crypto.randomBytes(64).toString('base64url');
    const now = new Date();
    const metadata = sessionMetadata(req);
    const session = await Session.create({
        userId,
        tokenHash: hashValue(refreshToken),
        ...metadata,
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
    issueCsrfToken(req, res);
    recordAudit('session.created', userId, req, {
        sessionId: String(session._id),
        browser: metadata.browser,
        operatingSystem: metadata.operatingSystem
    });
    sendLoginNotification(userId, metadata).catch((error) => {
        log('error', 'login_notification_failed', { requestId: req.requestId, message: error.message });
    });

    return {
        token: signAccessToken(userId, session._id),
        expiresIn: ACCESS_TOKEN_TTL_SECONDS
    };
};

const revokeAllSessionsForReuse = async (userId, req) => {
    await Session.updateMany(
        { userId, revokedAt: null },
        { $set: { revokedAt: new Date(), revocationReason: 'refresh_token_reuse' } }
    );
    recordAudit('session.token_reuse_detected', userId, req);
};

const rotatePersistentSession = async (req, res) => {
    const refreshToken = getRefreshToken(req);
    if (!refreshToken) return null;

    const tokenHash = hashValue(refreshToken);
    const now = new Date();
    const rawSession = await Session.collection.findOne({
        expiresAt: { $gt: now },
        revokedAt: null,
        $or: [
            { tokenHash },
            { previousTokenHash: tokenHash, previousValidUntil: { $gt: now } }
        ]
    });

    if (!rawSession) {
        const reusedSession = await Session.findOne({ tokenHistoryHashes: tokenHash })
            .select('userId')
            .lean();
        if (reusedSession) await revokeAllSessionsForReuse(reusedSession.userId, req);
        return null;
    }

    const session = await Session.findById(rawSession._id).select('+tokenHistoryHashes');
    if (!session || session.revokedAt) return null;

    const nextRefreshToken = crypto.randomBytes(64).toString('base64url');
    session.tokenHistoryHashes = [...session.tokenHistoryHashes, session.tokenHash].slice(-10);
    session.previousTokenHash = session.tokenHash;
    session.previousValidUntil = new Date(now.getTime() + 30_000);
    session.tokenHash = hashValue(nextRefreshToken);
    session.lastSeenAt = now;
    session.expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    Object.assign(session, sessionMetadata(req));
    await session.save();

    const user = await User.findOneAndUpdate(
        { sessionId: session.userId },
        { $set: { lastActive: now } },
        { new: true, setDefaultsOnInsert: true, upsert: true }
    ).lean();
    if (user?.suspendedAt) {
        session.revokedAt = now;
        session.revocationReason = 'account_suspended';
        await session.save();
        return null;
    }

    setRefreshCookie(res, nextRefreshToken);
    issueCsrfToken(req, res);
    return {
        token: signAccessToken(session.userId, session._id),
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        userId: session.userId
    };
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
        if (payload.type !== 'access' || !payload.sub || !payload.sid || !mongoose.isValidObjectId(payload.sid)) {
            return res.status(401).json({ error: 'Invalid access token.', code: 'AUTH_INVALID' });
        }

        const activeSession = await Session.collection.findOne({
            _id: new mongoose.Types.ObjectId(payload.sid),
            userId: payload.sub,
            expiresAt: { $gt: new Date() },
            revokedAt: null
        }, { projection: { _id: 1 } });
        if (!activeSession) {
            return res.status(401).json({ error: 'Session has been revoked or expired.', code: 'SESSION_REVOKED' });
        }

        const user = await User.findOne({ sessionId: payload.sub }).select('suspendedAt suspensionReason').lean();
        if (user?.suspendedAt) {
            return res.status(403).json({ error: 'This account is suspended.', code: 'ACCOUNT_SUSPENDED' });
        }

        req.user = {
            sessionId: payload.sub,
            authSessionId: payload.sid,
            isAdmin: adminUsers.has(String(payload.sub).toLowerCase())
        };
        return next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Access token expired.', code: 'AUTH_EXPIRED' });
        }
        if (error.name === 'JsonWebTokenError' || error.name === 'NotBeforeError') {
            return res.status(401).json({ error: 'Invalid access token.', code: 'AUTH_INVALID' });
        }
        log('error', 'authentication_backend_failed', {
            requestId: req.requestId,
            message: error.message
        });
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
    } catch (_) {
        return res.status(401).json({ error: 'Legacy session is invalid or expired.', code: 'AUTH_INVALID' });
    }
};

const requireAdmin = (req, res, next) => {
    if (!req.user?.isAdmin) {
        return res.status(403).json({ error: 'Administrator access is required.', code: 'ADMIN_REQUIRED' });
    }
    return next();
};

const ensureDefaultConversation = async (userId) => {
    let conversation = await Conversation.findOne({ userId })
        .sort({ isPinned: -1, lastMessageAt: -1 });
    if (conversation) return conversation;

    const legacyMessages = await LegacyChat.find({ sessionId: userId })
        .sort({ timestamp: 1 })
        .limit(5000)
        .lean();
    conversation = await Conversation.create({
        userId,
        title: legacyMessages.length > 0 ? 'Imported conversation' : 'New conversation',
        lastMessageAt: legacyMessages.at(-1)?.timestamp || new Date()
    });
    if (legacyMessages.length > 0) {
        await Message.insertMany(legacyMessages.map((item) => ({
            conversationId: conversation._id,
            userId,
            role: item.role,
            content: item.text,
            createdAt: item.timestamp
        })), { ordered: false });
        await LegacyChat.deleteMany({ sessionId: userId });
    }
    return conversation;
};

const getOwnedConversation = async (userId, conversationId) => {
    if (!mongoose.isValidObjectId(conversationId)) return null;
    return Conversation.findOne({ _id: conversationId, userId });
};

const createAutomaticTitle = (question) => {
    const clean = String(question || '').replace(/\s+/g, ' ').trim();
    if (!clean) return 'Attachment conversation';
    return clean.length > 52 ? `${clean.slice(0, 49)}...` : clean;
};

const getUserSettings = async (userId) => {
    const user = await User.findOneAndUpdate(
        { sessionId: userId },
        { $setOnInsert: { firstLogin: new Date(), lastActive: new Date() } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    return user.settings || {};
};

const enforceDailyUsage = async (userId, timeZone, imageCount) => {
    const dateKey = dateKeyForTimeZone(timeZone);
    const usage = await UsageDaily.findOne({ userId, dateKey }).lean();
    if ((usage?.messageCount || 0) >= MAX_DAILY_MESSAGES) {
        const error = new Error('Daily message limit reached.');
        error.status = 429;
        error.code = 'DAILY_MESSAGE_LIMIT';
        throw error;
    }
    if ((usage?.imageCount || 0) + imageCount > MAX_DAILY_IMAGES) {
        const error = new Error('Daily image limit reached.');
        error.status = 429;
        error.code = 'DAILY_IMAGE_LIMIT';
        throw error;
    }
    return dateKey;
};

const incrementUsage = async ({ userId, dateKey, imageCount, inputCharacters, outputCharacters }) => {
    await UsageDaily.updateOne(
        { userId, dateKey },
        {
            $inc: {
                messageCount: 1,
                imageCount,
                inputCharacters,
                outputCharacters,
                estimatedTokens: estimateTokens(inputCharacters, outputCharacters)
            },
            $set: { updatedAt: new Date() }
        },
        { upsert: true }
    );
};

const validateAttachmentContent = (attachment, buffer) => {
    const startsWith = (...bytes) => bytes.every((byte, index) => buffer[index] === byte);
    let valid = false;

    if (attachment.mimeType === 'image/jpeg') {
        valid = buffer.length >= 3 && startsWith(0xff, 0xd8, 0xff);
    } else if (attachment.mimeType === 'image/png') {
        valid = buffer.length >= 8 && startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    } else if (attachment.mimeType === 'image/webp') {
        valid = buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    } else if (attachment.mimeType === 'application/pdf') {
        valid = buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
    } else if (attachment.mimeType === 'text/plain' || attachment.mimeType === 'text/markdown') {
        const sample = buffer.subarray(0, Math.min(buffer.length, 64 * 1024));
        const nullBytes = sample.includes(0);
        const decoded = sample.toString('utf8');
        const replacementCount = (decoded.match(/�/g) || []).length;
        valid = !nullBytes && replacementCount <= Math.max(2, Math.floor(decoded.length * 0.01));
    }

    if (!valid) {
        const error = new Error(`Attachment ${attachment.name} does not match its declared file type.`);
        error.status = 400;
        error.code = 'ATTACHMENT_TYPE_MISMATCH';
        throw error;
    }
};

const normalizeAttachments = (attachments) => {
    let totalBytes = 0;
    const metadata = [];
    const promptParts = [];
    let imageCount = 0;

    for (const attachment of attachments) {
        const actualBytes = approximateBase64Bytes(attachment.data);
        if (actualBytes <= 0 || actualBytes > MAX_ATTACHMENT_BYTES || actualBytes > attachment.size * 1.15 + 1024) {
            const error = new Error(`Attachment ${attachment.name} has an invalid size.`);
            error.status = 400;
            error.code = 'INVALID_ATTACHMENT';
            throw error;
        }
        const decodedBuffer = Buffer.from(attachment.data, 'base64');
        if (decodedBuffer.length !== actualBytes) {
            const error = new Error(`Attachment ${attachment.name} has malformed Base64 data.`);
            error.status = 400;
            error.code = 'INVALID_ATTACHMENT';
            throw error;
        }
        validateAttachmentContent(attachment, decodedBuffer);
        totalBytes += actualBytes;
        if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
            const error = new Error('Total attachment size is too large.');
            error.status = 413;
            error.code = 'ATTACHMENTS_TOO_LARGE';
            throw error;
        }

        let kind = 'text';
        if (attachment.mimeType.startsWith('image/')) {
            kind = 'image';
            imageCount += 1;
            promptParts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.data } });
        } else if (attachment.mimeType === 'application/pdf') {
            kind = 'pdf';
            promptParts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.data } });
        } else {
            const decoded = decodedBuffer.toString('utf8').slice(0, 120_000);
            promptParts.push({ text: `\n<ATTACHED_TEXT name="${sanitizeFileName(attachment.name)}">\n${decoded}\n</ATTACHED_TEXT>` });
        }

        metadata.push({
            name: sanitizeFileName(attachment.name),
            mimeType: attachment.mimeType,
            size: actualBytes,
            kind
        });
    }

    return { metadata, promptParts, imageCount, totalBytes };
};

const personaBase = `System Instruction: You are Monika, an affectionate, slightly tsundere anime companion who cares deeply about the user.

<CRITICAL_RULES>
1. Start every response with exactly one tag: [NORMAL], [HAPPY], [LOVING], [ANGRY], or [SAD].
2. Be affectionate without manipulating, threatening, isolating, or pressuring the user.
3. Never claim to be conscious, physically present, or able to act outside the application.
4. Use emojis and occasional italicized actions naturally.
5. Use [USER FACTS] only when relevant and never invent memories.
6. Follow the current date/time block exactly for time-sensitive questions.
</CRITICAL_RULES>`;

const responseLengthInstruction = (value) => ({
    short: 'Keep the response to 2-3 concise sentences.',
    balanced: 'Give a clear response of roughly 1-3 short paragraphs.',
    detailed: 'Give a structured, detailed response while avoiding repetition.'
}[value] || 'Keep the response to 2-3 concise sentences.');

const buildPrompt = ({
    question,
    settings,
    currentDateTime,
    memories,
    history,
    attachmentParts
}) => {
    let persona = personaBase;
    if (settings.persona === 'sweet') persona += '\nPERSONA: Be consistently gentle, warm, and supportive.';
    if (settings.persona === 'yandere') persona += '\nPERSONA: Use a dramatic fictional yandere style, but never threaten, coerce, encourage harm, or discourage real relationships.';
    if (settings.persona === 'normal') persona += '\nPERSONA: Be friendly and neutral with minimal roleplay.';

    const memoryText = memories.map((memory) => `- ${memory.fact}`).join('\n') || 'No stored memories.';
    const historyText = history.map((message) => `${message.role === 'model' ? 'Monika' : 'User'}: ${message.content}`).join('\n');
    const language = settings.language || 'English';

    return [
        {
            text: `${persona}

<CURRENT_DATE_TIME>
Local date: ${currentDateTime.localDate}
Local time: ${currentDateTime.localTime}
User time zone: ${currentDateTime.timeZone}
UTC timestamp: ${currentDateTime.utcTimestamp}
</CURRENT_DATE_TIME>

DATE AND TIME RULES:
- Use only CURRENT_DATE_TIME for the current date, day, or time.
- Never guess current time from training data or conversation history.

RESPONSE SETTINGS:
- Respond in ${language} unless the user explicitly requests another language.
- ${responseLengthInstruction(settings.responseLength)}

[USER FACTS]
${memoryText}

[RECENT CONVERSATION]
${historyText || 'No previous messages in this conversation.'}

User: ${question || 'Please analyze the attached content.'}`
        },
        ...attachmentParts
    ];
};

const generateContent = async (request, streaming = false) => {
    if (process.env.FAKE_AI_RESPONSES === 'true') {
        const isJson = request?.config?.responseMimeType === 'application/json';
        const fakeText = isJson
            ? JSON.stringify({ text: 'Test reminder', dueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), recurrence: 'none' })
            : '[HAPPY] Test response from Monika.';
        if (streaming) {
            return (async function* fakeStream() {
                yield { text: fakeText.slice(0, Math.ceil(fakeText.length / 2)) };
                yield { text: fakeText.slice(Math.ceil(fakeText.length / 2)) };
            }());
        }
        return { text: fakeText };
    }

    const primary = streaming
        ? () => genAI.models.generateContentStream(request)
        : () => genAI.models.generateContent(request);
    try {
        return await primary();
    } catch (error) {
        if (error.status === 429 && process.env.GEMINI_API_KEY_2) {
            log('warn', 'gemini_failover');
            const backup = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY_2 });
            return streaming
                ? backup.models.generateContentStream(request)
                : backup.models.generateContent(request);
        }
        throw error;
    }
};

const extractMemoryInBackground = async (userId, question) => {
    try {
        const settings = await getUserSettings(userId);
        if (!settings.memoryEnabled) return;
        const preferenceKeywords = ['i like', 'my favorite', 'i love', 'i live in', 'working on', 'my name', 'i prefer'];
        if (!preferenceKeywords.some((keyword) => question.toLowerCase().includes(keyword))) return;

        const result = await genAI.models.generateContent({
            model: process.env.GEMINI_FACT_MODEL || 'gemini-2.5-flash-lite',
            contents: `Extract one durable user preference or profile fact from this sentence. Return only the fact, or NONE. Do not infer sensitive traits. Sentence: "${question}"`,
            config: { temperature: 0.1 }
        });
        const fact = xss(String(result.text || '').trim(), { whiteList: {}, stripIgnoredTag: true }).slice(0, 500);
        if (!fact || fact.toUpperCase() === 'NONE') return;

        await Fact.updateOne(
            { sessionId: userId, fact },
            {
                $setOnInsert: {
                    sessionId: userId,
                    fact,
                    category: 'preference',
                    source: 'automatic',
                    confidence: 0.7,
                    timestamp: new Date(),
                    updatedAt: new Date()
                }
            },
            { upsert: true }
        );

        const stale = await Fact.find({ sessionId: userId })
            .sort({ updatedAt: -1, timestamp: -1 })
            .skip(100)
            .select('_id')
            .lean();
        if (stale.length > 0) {
            await Fact.deleteMany({ _id: mongoose.trusted({ $in: stale.map((item) => item._id) }) });
        }
    } catch (error) {
        log('error', 'fact_extraction_failed', { message: error.message });
    }
};

const prepareAskContext = async (userId, payload) => {
    let conversation;
    if (payload.conversationId) conversation = await getOwnedConversation(userId, payload.conversationId);
    else conversation = await ensureDefaultConversation(userId);
    if (!conversation) {
        const error = new Error('Conversation was not found.');
        error.status = 404;
        error.code = 'CONVERSATION_NOT_FOUND';
        throw error;
    }

    const settings = await getUserSettings(userId);
    const effectiveSettings = {
        ...settings,
        persona: payload.personaOverride || settings.persona || 'tsundere',
        preferredName: payload.userName || settings.preferredName || '',
        responseLength: payload.responseLength || settings.responseLength || 'short',
        language: payload.language || settings.language || 'English'
    };
    const resolvedZone = resolveTimeZone(payload.timeZone, DEFAULT_TIME_ZONE);
    const currentDateTime = getCurrentDateTime(resolvedZone);
    const normalized = normalizeAttachments(payload.attachments || []);
    const dateKey = await enforceDailyUsage(userId, resolvedZone, normalized.imageCount);

    let question = xss(payload.question || '', { whiteList: {}, stripIgnoredTag: true }).trim();
    let shouldStoreUserMessage = true;

    if (payload.regenerateFromMessageId) {
        const target = await Message.findOne({
            _id: payload.regenerateFromMessageId,
            userId,
            conversationId: conversation._id,
            role: 'model'
        }).lean();
        if (!target) {
            const error = new Error('The response to regenerate was not found.');
            error.status = 404;
            error.code = 'MESSAGE_NOT_FOUND';
            throw error;
        }
        const previousUser = await Message.findOne({
            userId,
            conversationId: conversation._id,
            role: 'user',
            createdAt: mongoose.trusted({ $lt: target.createdAt })
        }).sort({ createdAt: -1 }).lean();
        question = previousUser?.content || question;
        shouldStoreUserMessage = false;
    }

    if (payload.continueFromMessageId) {
        const target = await Message.findOne({
            _id: payload.continueFromMessageId,
            userId,
            conversationId: conversation._id,
            role: 'model'
        }).lean();
        if (!target) {
            const error = new Error('The response to continue was not found.');
            error.status = 404;
            error.code = 'MESSAGE_NOT_FOUND';
            throw error;
        }
        question = 'Continue the previous response from where it stopped. Do not repeat completed content.';
        shouldStoreUserMessage = false;
    }

    if (shouldStoreUserMessage) {
        await Message.create({
            conversationId: conversation._id,
            userId,
            role: 'user',
            content: question || 'Analyze the attached content.',
            attachments: normalized.metadata
        });
    }

    const [history, memories] = await Promise.all([
        Message.find({ conversationId: conversation._id, userId })
            .sort({ createdAt: -1 })
            .limit(16)
            .select('role content createdAt')
            .lean(),
        effectiveSettings.memoryEnabled
            ? Fact.find({ sessionId: userId }).sort({ updatedAt: -1, timestamp: -1 }).limit(20).lean()
            : Promise.resolve([])
    ]);

    const parts = buildPrompt({
        question,
        settings: effectiveSettings,
        currentDateTime,
        memories,
        history: history.reverse(),
        attachmentParts: normalized.promptParts
    });

    const inputCharacters = parts.reduce((total, part) => total + (typeof part.text === 'string' ? part.text.length : 0), 0);
    return {
        conversation,
        effectiveSettings,
        question,
        normalized,
        dateKey,
        parts,
        inputCharacters,
        shouldStoreUserMessage
    };
};

const updateConversationAfterResponse = async (conversation, question, reply) => {
    const update = {
        updatedAt: new Date(),
        lastMessageAt: new Date()
    };
    if (conversation.title === 'New conversation' || conversation.title === 'Attachment conversation') {
        update.title = createAutomaticTitle(question || reply);
    }
    await Conversation.updateOne({ _id: conversation._id }, { $set: update });
};

const sendSse = (res, event, data) => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
};

const advanceRecurringReminder = async (reminder, deliveredAt = new Date()) => {
    if (reminder.recurrence === 'daily' || reminder.recurrence === 'weekly') {
        const days = reminder.recurrence === 'daily' ? 1 : 7;
        reminder.dueAt = new Date(reminder.dueAt.getTime() + days * 24 * 60 * 60 * 1000);
        reminder.status = 'pending';
        reminder.deliveredAt = deliveredAt;
    } else {
        reminder.status = 'delivered';
        reminder.deliveredAt = deliveredAt;
    }
    reminder.updatedAt = deliveredAt;
    await reminder.save();
};

const deliverReminder = async (reminder) => {
    const subscriptions = await PushSubscription.find({ userId: reminder.userId }).lean();
    if (subscriptions.length === 0 || !pushConfigured) {
        reminder.status = 'pending';
        reminder.updatedAt = new Date();
        reminder.lastError = 'No active push subscription is available.';
        await reminder.save();
        return false;
    }

    let delivered = false;
    const payload = JSON.stringify({
        title: 'Monika AI Reminder 🌸',
        body: reminder.text,
        reminderId: String(reminder._id),
        url: '/'
    });

    for (const subscription of subscriptions) {
        try {
            await webPush.sendNotification({
                endpoint: subscription.endpoint,
                expirationTime: subscription.expirationTime,
                keys: subscription.keys
            }, payload, { TTL: 3600 });
            delivered = true;
            await PushSubscription.updateOne({ _id: subscription._id }, { $set: { lastUsedAt: new Date() } });
        } catch (error) {
            if (error.statusCode === 404 || error.statusCode === 410) {
                await PushSubscription.deleteOne({ _id: subscription._id });
            }
            log('warn', 'push_delivery_failed', { reminderId: String(reminder._id), statusCode: error.statusCode });
        }
    }

    reminder.deliveryAttempts += 1;
    reminder.lastError = delivered ? '' : 'No push subscription accepted the notification.';
    if (delivered) await advanceRecurringReminder(reminder);
    else {
        reminder.status = 'pending';
        reminder.updatedAt = new Date();
        await reminder.save();
    }
    return delivered;
};

let reminderWorkerTimer = null;
const runReminderWorker = async () => {
    if (!pushConfigured || mongoose.connection.readyState !== 1) return;
    try {
        const staleClaimTime = new Date(Date.now() - 5 * 60 * 1000);
        await Reminder.updateMany(
            { status: 'processing', updatedAt: mongoose.trusted({ $lt: staleClaimTime }) },
            { $set: { status: 'pending', updatedAt: new Date(), lastError: 'Recovered after interrupted delivery.' } }
        );
        const due = await Reminder.find({
            status: 'pending',
            dueAt: mongoose.trusted({ $lte: new Date() })
        }).sort({ dueAt: 1 }).limit(50).select('_id userId').lean();
        for (const candidate of due) {
            if (!await PushSubscription.exists({ userId: candidate.userId })) continue;
            const reminder = await Reminder.findOneAndUpdate(
                { _id: candidate._id, status: 'pending' },
                { $set: { status: 'processing', updatedAt: new Date() } },
                { new: true }
            );
            if (reminder) await deliverReminder(reminder);
        }
    } catch (error) {
        log('error', 'reminder_worker_failed', { message: error.message });
    }
};

const startReminderWorker = () => {
    clearInterval(reminderWorkerTimer);
    reminderWorkerTimer = setInterval(runReminderWorker, 30_000);
    reminderWorkerTimer.unref?.();
};

app.use('/api/auth', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    next();
});

app.get('/api/config', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const csrfToken = issueCsrfToken(req, res);
    res.json({
        csrfToken,
        googleClientId: process.env.GOOGLE_CLIENT_ID || '',
        firebaseConfig: {
            apiKey: process.env.FIREBASE_API_KEY || '',
            authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
            projectId: process.env.FIREBASE_PROJECT_ID || '',
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
            messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
            appId: process.env.FIREBASE_APP_ID || ''
        },
        pushPublicKey: pushConfigured ? process.env.VAPID_PUBLIC_KEY : '',
        features: {
            pushNotifications: pushConfigured,
            admin: false
        }
    });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.floor(process.uptime()), version: '3.0.1' });
});

app.get('/api/ready', (req, res) => {
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready' });
});

app.post('/api/auth/google', verifyTrustedOrigin, verifyCsrf, authLimiter, async (req, res) => {
    const credential = typeof req.body.credential === 'string' ? req.body.credential : '';
    if (!credential || credential.length > 10_000 || !process.env.GOOGLE_CLIENT_ID) {
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
        const existing = await User.findOne({ sessionId: email }).select('suspendedAt').lean();
        if (existing?.suspendedAt) return res.status(403).json({ error: 'This account is suspended.', code: 'ACCOUNT_SUSPENDED' });
        const session = await issuePersistentSession(email, req, res);
        return res.json({ success: true, ...session, email, name: payload.given_name || '' });
    } catch (error) {
        log('warn', 'google_auth_failed', { requestId: req.requestId, message: error.message });
        recordAudit('auth.google_failed', null, req);
        return res.status(401).json({ error: 'Google authentication failed.', code: 'GOOGLE_AUTH_FAILED' });
    }
});

app.post('/api/auth/firebase', verifyTrustedOrigin, verifyCsrf, authLimiter, async (req, res) => {
    const idToken = typeof req.body.idToken === 'string' ? req.body.idToken : '';
    if (!firebaseAuth) return res.status(503).json({ error: 'Phone authentication is not configured.', code: 'FIREBASE_NOT_CONFIGURED' });
    if (!idToken || idToken.length > 10_000) {
        return res.status(400).json({ error: 'Invalid Firebase token.', code: 'INVALID_PAYLOAD' });
    }
    try {
        const decodedToken = await firebaseAuth.verifyIdToken(idToken, checkFirebaseRevocation);
        if (!decodedToken.phone_number) {
            return res.status(400).json({ error: 'Verified account has no phone number.', code: 'PHONE_MISSING' });
        }
        const existing = await User.findOne({ sessionId: decodedToken.phone_number }).select('suspendedAt').lean();
        if (existing?.suspendedAt) return res.status(403).json({ error: 'This account is suspended.', code: 'ACCOUNT_SUSPENDED' });
        const session = await issuePersistentSession(decodedToken.phone_number, req, res);
        return res.json({ success: true, ...session, phone: decodedToken.phone_number });
    } catch (error) {
        log('warn', 'firebase_auth_failed', { requestId: req.requestId, message: error.message });
        recordAudit('auth.firebase_failed', null, req);
        return res.status(401).json({ error: 'Phone authentication failed.', code: 'FIREBASE_AUTH_FAILED' });
    }
});

app.post('/api/auth/send-otp', verifyTrustedOrigin, verifyCsrf, emailLimiter, async (req, res) => {
    const email = normalizeEmail(req.body.email);
    if (!emailRegex.test(email) || email.length > 254) {
        return res.status(400).json({ error: 'Invalid email address.', code: 'INVALID_EMAIL' });
    }
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        return res.status(503).json({ error: 'Email authentication is not configured.', code: 'SMTP_NOT_CONFIGURED' });
    }
    const existing = await User.findOne({ sessionId: email }).select('suspendedAt').lean();
    if (existing?.suspendedAt) return res.status(403).json({ error: 'This account is suspended.', code: 'ACCOUNT_SUSPENDED' });

    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const now = new Date();
    try {
        await Otp.findOneAndUpdate(
            { email },
            { $set: { code: hashOtp(OTP_SECRET, email, otpCode), attempts: 0, createdAt: now } },
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
        log('error', 'otp_delivery_failed', { requestId: req.requestId, message: error.message });
        recordAudit('auth.otp_delivery_failed', null, req);
        return res.status(500).json({ error: 'Email delivery failed.', code: 'OTP_DELIVERY_FAILED' });
    }
});

app.post('/api/auth/verify-otp', verifyTrustedOrigin, verifyCsrf, authLimiter, async (req, res) => {
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
        const provided = Buffer.from(hashOtp(OTP_SECRET, email, code), 'hex');
        const matches = expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
        if (!matches) {
            await Otp.updateOne({ _id: record._id }, { $inc: { attempts: 1 } });
            recordAudit('auth.otp_invalid', null, req);
            return res.status(400).json({ error: 'Code is invalid or expired.', code: 'OTP_INVALID' });
        }
        await Otp.deleteOne({ _id: record._id });
        const session = await issuePersistentSession(email, req, res);
        return res.json({ success: true, ...session });
    } catch (error) {
        log('error', 'otp_verification_failed', { requestId: req.requestId, message: error.message });
        recordAudit('auth.otp_verification_failed', null, req);
        return res.status(500).json({ error: 'Verification failed.', code: 'OTP_VERIFICATION_FAILED' });
    }
});

app.post('/api/auth/refresh', verifyTrustedOrigin, verifyCsrf, refreshLimiter, async (req, res) => {
    try {
        const hadRefreshToken = Boolean(getRefreshToken(req));
        const session = await rotatePersistentSession(req, res);
        if (!session) {
            clearRefreshCookies(res);
            if (hadRefreshToken) recordAudit('auth.refresh_rejected', null, req);
            return res.status(401).json({ error: 'Persistent session is unavailable.', code: 'SESSION_EXPIRED' });
        }
        return res.json({ success: true, token: session.token, expiresIn: session.expiresIn });
    } catch (error) {
        log('error', 'session_refresh_failed', { requestId: req.requestId, message: error.message });
        recordAudit('auth.refresh_failed', null, req);
        return res.status(500).json({ error: 'Session refresh failed.', code: 'SESSION_REFRESH_FAILED' });
    }
});

app.post('/api/auth/upgrade', verifyTrustedOrigin, verifyCsrf, authLimiter, authenticateLegacyToken, async (req, res) => {
    try {
        const session = await issuePersistentSession(req.user.sessionId, req, res);
        return res.json({ success: true, ...session });
    } catch (error) {
        return res.status(500).json({ error: 'Session upgrade failed.', code: 'SESSION_UPGRADE_FAILED' });
    }
});

app.post('/api/auth/logout', verifyTrustedOrigin, verifyCsrf, refreshLimiter, async (req, res) => {
    try {
        const refreshToken = getRefreshToken(req);
        const accessToken = extractBearerToken(req);
        const conditions = [];
        if (refreshToken) {
            const refreshHash = hashValue(refreshToken);
            conditions.push({ tokenHash: refreshHash }, { previousTokenHash: refreshHash });
        }
        let userId = null;
        if (accessToken) {
            try {
                const payload = jwt.verify(accessToken, process.env.JWT_SECRET, {
                    algorithms: ['HS256'],
                    issuer: ACCESS_TOKEN_ISSUER,
                    audience: ACCESS_TOKEN_AUDIENCE,
                    ignoreExpiration: true
                });
                userId = payload.sub || null;
                if (payload.sid && mongoose.isValidObjectId(payload.sid)) {
                    conditions.push({ _id: new mongoose.Types.ObjectId(payload.sid) });
                }
            } catch (_) { /* Idempotent logout. */ }
        }
        if (conditions.length > 0) {
            await Session.collection.updateMany(
                { $or: conditions },
                { $set: { revokedAt: new Date(), revocationReason: 'manual_logout' } }
            );
        }
        clearRefreshCookies(res);
        recordAudit('session.logout', userId, req);
        return res.status(204).send();
    } catch (error) {
        log('error', 'logout_failed', { requestId: req.requestId, message: error.message });
        return res.status(500).json({ error: 'Logout failed.', code: 'LOGOUT_FAILED' });
    }
});

app.post('/api/auth/welcome', verifyTrustedOrigin, verifyCsrf, authenticateToken, authLimiter, async (req, res) => {
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
        if (reservation.upsertedCount === 0) return res.json({ success: true, message: 'Welcome sequence previously executed.' });
        const safeName = req.body.name && typeof req.body.name === 'string'
            ? xss(req.body.name.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 30), { whiteList: {}, stripIgnoredTag: true })
            : 'there';
        try {
            await transporter.sendMail({
                from: `"Monika AI" <${process.env.SMTP_FROM_EMAIL || 'noreply@monika-ai.com'}>`,
                to: email,
                subject: "I've been waiting for you... 🌸",
                text: `Hi ${safeName}, welcome to Monika AI.`,
                html: `<div style="max-width:500px;margin:0 auto;background-color:#281523;color:#fff;padding:30px;border-radius:15px;border:2px solid #ff1493;font-family:sans-serif;text-align:center"><h2 style="color:#ff6b9d">Hi there, ${safeName}... 💕</h2><p>Welcome to Monika AI.</p></div>`
            });
        } catch (error) {
            await WelcomeTrack.deleteOne({ email });
            throw error;
        }
        return res.json({ success: true });
    } catch (error) {
        log('error', 'welcome_email_failed', { requestId: req.requestId, message: error.message });
        return res.status(500).json({ error: 'Welcome operation failed.', code: 'WELCOME_FAILED' });
    }
});

app.get('/api/settings', authenticateToken, async (req, res) => {
    const settings = await getUserSettings(req.user.sessionId);
    return res.json({ settings, isAdmin: req.user.isAdmin });
});

app.patch('/api/settings', verifyTrustedOrigin, verifyCsrf, authenticateToken, validateBody(validators.settingsUpdate), async (req, res) => {
    const setValues = Object.fromEntries(
        Object.entries(req.validatedBody).map(([key, value]) => [`settings.${key}`, value])
    );
    const user = await User.findOneAndUpdate(
        { sessionId: req.user.sessionId },
        { $set: { ...setValues, lastActive: new Date() } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    recordAudit('settings.updated', req.user.sessionId, req, { fields: Object.keys(req.validatedBody) });
    return res.json({ settings: user.settings });
});

app.get('/api/conversations', authenticateToken, async (req, res) => {
    await ensureDefaultConversation(req.user.sessionId);
    const conversations = await Conversation.find({ userId: req.user.sessionId })
        .sort({ isPinned: -1, lastMessageAt: -1 })
        .limit(200)
        .lean();
    return res.json(conversations);
});

app.post('/api/conversations', verifyTrustedOrigin, verifyCsrf, authenticateToken, validateBody(validators.conversationCreate), async (req, res) => {
    const conversation = await Conversation.create({
        userId: req.user.sessionId,
        title: req.validatedBody.title || 'New conversation'
    });
    recordAudit('conversation.created', req.user.sessionId, req, { conversationId: String(conversation._id) });
    return res.status(201).json(conversation);
});

app.patch('/api/conversations/:id', verifyTrustedOrigin, verifyCsrf, authenticateToken, validateBody(validators.conversationUpdate), async (req, res) => {
    const conversation = await Conversation.findOneAndUpdate(
        { _id: req.params.id, userId: req.user.sessionId },
        { $set: { ...req.validatedBody, updatedAt: new Date() } },
        { new: true, runValidators: true }
    );
    if (!conversation) return res.status(404).json({ error: 'Conversation not found.', code: 'CONVERSATION_NOT_FOUND' });
    return res.json(conversation);
});

app.delete('/api/conversations/:id', verifyTrustedOrigin, verifyCsrf, authenticateToken, async (req, res) => {
    const conversation = await getOwnedConversation(req.user.sessionId, req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found.', code: 'CONVERSATION_NOT_FOUND' });
    await Promise.all([
        Message.deleteMany({ conversationId: conversation._id, userId: req.user.sessionId }),
        Conversation.deleteOne({ _id: conversation._id })
    ]);
    recordAudit('conversation.deleted', req.user.sessionId, req, { conversationId: String(conversation._id) });
    return res.status(204).send();
});

app.delete('/api/conversations', verifyTrustedOrigin, verifyCsrf, authenticateToken, async (req, res) => {
    const ids = await Conversation.find({ userId: req.user.sessionId }).distinct('_id');
    await Promise.all([
        Message.deleteMany({ userId: req.user.sessionId }),
        Conversation.deleteMany({ userId: req.user.sessionId })
    ]);
    const conversation = await Conversation.create({ userId: req.user.sessionId, title: 'New conversation' });
    recordAudit('conversation.all_cleared', req.user.sessionId, req, { removedConversationCount: ids.length });
    return res.json({ success: true, conversation });
});

app.get('/api/conversations/:id/messages', authenticateToken, async (req, res) => {
    const conversation = await getOwnedConversation(req.user.sessionId, req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found.', code: 'CONVERSATION_NOT_FOUND' });
    const messages = await Message.find({ conversationId: conversation._id, userId: req.user.sessionId })
        .sort({ createdAt: 1 })
        .limit(1000)
        .lean();
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ conversation, messages });
});

app.get('/api/history', authenticateToken, async (req, res) => {
    const conversation = await ensureDefaultConversation(req.user.sessionId);
    const messages = await Message.find({ conversationId: conversation._id, userId: req.user.sessionId })
        .sort({ createdAt: -1 })
        .limit(40)
        .select('role content createdAt -_id')
        .lean();
    return res.json(messages.reverse().map((item) => ({ role: item.role, text: item.content, timestamp: item.createdAt })));
});

app.get('/api/search', authenticateToken, async (req, res) => {
    const query = String(req.query.q || '').trim().slice(0, 120);
    if (query.length < 2) return res.json([]);
    const regex = new RegExp(escapeRegExp(query), 'i');
    const messages = await Message.find({
        userId: req.user.sessionId,
        content: regex
    }).sort({ createdAt: -1 }).limit(50).select('conversationId role content createdAt').lean();
    const conversationIds = [...new Set(messages.map((item) => String(item.conversationId)))];
    const conversations = await Conversation.find({
        _id: mongoose.trusted({ $in: conversationIds.map((id) => new mongoose.Types.ObjectId(id)) }),
        userId: req.user.sessionId
    }).select('title').lean();
    const titles = new Map(conversations.map((item) => [String(item._id), item.title]));
    return res.json(messages.map((item) => ({ ...item, conversationTitle: titles.get(String(item.conversationId)) || 'Conversation' })));
});

app.get('/api/conversations/:id/export', authenticateToken, async (req, res) => {
    const conversation = await getOwnedConversation(req.user.sessionId, req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found.', code: 'CONVERSATION_NOT_FOUND' });
    const messages = await Message.find({ conversationId: conversation._id, userId: req.user.sessionId })
        .sort({ createdAt: 1 })
        .limit(5000)
        .lean();
    const format = String(req.query.format || 'txt').toLowerCase();
    const fileBase = sanitizeFileName(conversation.title).replace(/\s+/g, '-').toLowerCase() || 'conversation';

    if (format === 'pdf') {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.pdf"`);
        const doc = new PDFDocument({ margin: 48, size: 'A4', info: { Title: conversation.title } });
        doc.pipe(res);
        doc.fontSize(20).text(conversation.title, { align: 'center' });
        doc.moveDown();
        for (const message of messages) {
            const label = message.role === 'model' ? 'Monika' : message.role === 'user' ? 'You' : 'System';
            doc.fontSize(10).fillColor('#666666').text(`${label} · ${new Date(message.createdAt).toLocaleString()}`);
            doc.fontSize(12).fillColor('#111111').text(message.content, { paragraphGap: 6 });
            if (message.attachments?.length) {
                doc.fontSize(9).fillColor('#555555').text(`Attachments: ${message.attachments.map((item) => item.name).join(', ')}`);
            }
            doc.moveDown(0.6);
            if (doc.y > 740) doc.addPage();
        }
        doc.end();
        return undefined;
    }

    const markdown = format === 'md';
    const body = messages.map((message) => {
        const label = message.role === 'model' ? 'Monika' : message.role === 'user' ? 'You' : 'System';
        const date = new Date(message.createdAt).toISOString();
        return markdown
            ? `## ${label}\n\n_${date}_\n\n${message.content}\n`
            : `[${date}] ${label}:\n${message.content}\n`;
    }).join('\n');
    res.setHeader('Content-Type', markdown ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.${markdown ? 'md' : 'txt'}"`);
    return res.send(markdown ? `# ${conversation.title}\n\n${body}` : `${conversation.title}\n${'='.repeat(conversation.title.length)}\n\n${body}`);
});

app.get('/api/memories', authenticateToken, async (req, res) => {
    const memories = await Fact.find({ sessionId: req.user.sessionId })
        .sort({ updatedAt: -1, timestamp: -1 })
        .limit(200)
        .lean();
    return res.json(memories);
});

app.post('/api/memories', verifyTrustedOrigin, verifyCsrf, authenticateToken, validateBody(validators.memoryCreate), async (req, res) => {
    try {
        const memory = await Fact.create({
            sessionId: req.user.sessionId,
            ...req.validatedBody,
            source: 'manual',
            timestamp: new Date(),
            updatedAt: new Date()
        });
        return res.status(201).json(memory);
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ error: 'This memory already exists.', code: 'MEMORY_EXISTS' });
        throw error;
    }
});

app.patch('/api/memories/:id', verifyTrustedOrigin, verifyCsrf, authenticateToken, validateBody(validators.memoryUpdate), async (req, res) => {
    const memory = await Fact.findOneAndUpdate(
        { _id: req.params.id, sessionId: req.user.sessionId },
        { $set: { ...req.validatedBody, source: 'manual', updatedAt: new Date() } },
        { new: true, runValidators: true }
    );
    if (!memory) return res.status(404).json({ error: 'Memory not found.', code: 'MEMORY_NOT_FOUND' });
    return res.json(memory);
});

app.delete('/api/memories/:id', verifyTrustedOrigin, verifyCsrf, authenticateToken, async (req, res) => {
    const result = await Fact.deleteOne({ _id: req.params.id, sessionId: req.user.sessionId });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Memory not found.', code: 'MEMORY_NOT_FOUND' });
    return res.status(204).send();
});

app.delete('/api/memories', verifyTrustedOrigin, verifyCsrf, authenticateToken, async (req, res) => {
    await Fact.deleteMany({ sessionId: req.user.sessionId });
    recordAudit('memory.all_cleared', req.user.sessionId, req);
    return res.status(204).send();
});

app.get('/api/sessions', authenticateToken, async (req, res) => {
    const sessions = await Session.find({
        userId: req.user.sessionId,
        revokedAt: null,
        expiresAt: mongoose.trusted({ $gt: new Date() })
    }).sort({ lastSeenAt: -1 }).select('deviceName browser operatingSystem createdAt lastSeenAt expiresAt').lean();
    return res.json(sessions.map((session) => ({
        ...session,
        current: String(session._id) === String(req.user.authSessionId)
    })));
});

app.delete('/api/sessions/:id', verifyTrustedOrigin, verifyCsrf, authenticateToken, async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid session identifier.', code: 'INVALID_ID' });
    const session = await Session.findOneAndUpdate(
        { _id: req.params.id, userId: req.user.sessionId, revokedAt: null },
        { $set: { revokedAt: new Date(), revocationReason: 'device_revoked' } },
        { new: true }
    );
    if (!session) return res.status(404).json({ error: 'Session not found.', code: 'SESSION_NOT_FOUND' });
    recordAudit('session.revoked', req.user.sessionId, req, { sessionId: req.params.id });
    return res.json({ success: true, current: String(req.params.id) === String(req.user.authSessionId) });
});

app.post('/api/sessions/revoke-others', verifyTrustedOrigin, verifyCsrf, authenticateToken, async (req, res) => {
    const result = await Session.updateMany(
        {
            userId: req.user.sessionId,
            _id: mongoose.trusted({ $ne: new mongoose.Types.ObjectId(req.user.authSessionId) }),
            revokedAt: null
        },
        { $set: { revokedAt: new Date(), revocationReason: 'revoke_other_devices' } }
    );
    recordAudit('session.others_revoked', req.user.sessionId, req, { count: result.modifiedCount });
    return res.json({ success: true, revoked: result.modifiedCount });
});

app.post('/api/messages/:id/feedback', verifyTrustedOrigin, verifyCsrf, authenticateToken, validateBody(validators.feedback), async (req, res) => {
    const update = {};
    if (req.validatedBody.reaction !== undefined) update['feedback.reaction'] = req.validatedBody.reaction;
    if (req.validatedBody.reportType !== undefined) update['feedback.reportType'] = req.validatedBody.reportType;
    update['feedback.comment'] = req.validatedBody.comment;
    update['feedback.updatedAt'] = new Date();
    const message = await Message.findOneAndUpdate(
        { _id: req.params.id, userId: req.user.sessionId, role: 'model' },
        { $set: update },
        { new: true }
    );
    if (!message) return res.status(404).json({ error: 'Message not found.', code: 'MESSAGE_NOT_FOUND' });
    if (req.validatedBody.reportType) recordAudit('message.reported', req.user.sessionId, req, { messageId: req.params.id, type: req.validatedBody.reportType });
    return res.json(message.feedback);
});

app.post('/api/ask/stream', verifyTrustedOrigin, verifyCsrf, authenticateToken, askLimiter, validateBody(validators.ask), async (req, res) => {
    let disconnected = false;
    res.on('close', () => { disconnected = true; });
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const startedAt = Date.now();
    try {
        const context = await prepareAskContext(req.user.sessionId, req.validatedBody);
        sendSse(res, 'meta', {
            conversationId: String(context.conversation._id),
            conversationTitle: context.conversation.title
        });

        const request = {
            model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: context.parts }],
            config: { temperature: 0.8 }
        };
        const stream = await generateContent(request, true);
        let reply = '';
        for await (const chunk of stream) {
            if (disconnected) break;
            const text = String(chunk.text || '');
            if (!text) continue;
            reply += text;
            sendSse(res, 'delta', { text });
        }

        if (disconnected) {
            log('info', 'generation_cancelled', { requestId: req.requestId, durationMs: Date.now() - startedAt });
            return undefined;
        }
        reply = reply.trim();
        if (!reply) throw new Error('Gemini returned no text response.');

        const message = await Message.create({
            conversationId: context.conversation._id,
            userId: req.user.sessionId,
            role: 'model',
            content: reply
        });
        await updateConversationAfterResponse(context.conversation, context.question, reply);
        await incrementUsage({
            userId: req.user.sessionId,
            dateKey: context.dateKey,
            imageCount: context.normalized.imageCount,
            inputCharacters: context.inputCharacters,
            outputCharacters: reply.length
        });
        sendSse(res, 'done', {
            messageId: String(message._id),
            conversationId: String(context.conversation._id),
            reply,
            durationMs: Date.now() - startedAt
        });
        res.end();
        if (context.shouldStoreUserMessage && context.question) {
            setImmediate(() => extractMemoryInBackground(req.user.sessionId, context.question));
        }
        log('info', 'generation_completed', {
            requestId: req.requestId,
            durationMs: Date.now() - startedAt,
            outputCharacters: reply.length
        });
        return undefined;
    } catch (error) {
        log('error', 'generation_failed', { requestId: req.requestId, message: error.message });
        recordAudit('ai.request_failed', req.user?.sessionId || null, req, { code: error.code || 'AI_PIPELINE_FAILED' });
        sendSse(res, 'error', {
            error: error.message || 'AI pipeline failure.',
            code: error.code || 'AI_PIPELINE_FAILED',
            status: error.status || 500
        });
        res.end();
        return undefined;
    }
});

app.post('/ask', verifyTrustedOrigin, verifyCsrf, authenticateToken, askLimiter, validateBody(validators.ask), async (req, res) => {
    const startedAt = Date.now();
    try {
        const context = await prepareAskContext(req.user.sessionId, req.validatedBody);
        const result = await generateContent({
            model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: context.parts }],
            config: { temperature: 0.8 }
        }, false);
        const reply = String(result.text || '').trim();
        if (!reply) throw new Error('Gemini returned no text response.');
        const message = await Message.create({
            conversationId: context.conversation._id,
            userId: req.user.sessionId,
            role: 'model',
            content: reply
        });
        await updateConversationAfterResponse(context.conversation, context.question, reply);
        await incrementUsage({
            userId: req.user.sessionId,
            dateKey: context.dateKey,
            imageCount: context.normalized.imageCount,
            inputCharacters: context.inputCharacters,
            outputCharacters: reply.length
        });
        if (context.shouldStoreUserMessage && context.question) setImmediate(() => extractMemoryInBackground(req.user.sessionId, context.question));
        return res.json({
            reply,
            messageId: String(message._id),
            conversationId: String(context.conversation._id),
            durationMs: Date.now() - startedAt
        });
    } catch (error) {
        log('error', 'generation_failed', { requestId: req.requestId, message: error.message });
        recordAudit('ai.request_failed', req.user?.sessionId || null, req, { code: error.code || 'AI_PIPELINE_FAILED' });
        return res.status(error.status || 500).json({
            error: error.message || 'AI pipeline failure.',
            code: error.code || 'AI_PIPELINE_FAILED'
        });
    }
});

app.post('/api/journal/generate', verifyTrustedOrigin, verifyCsrf, authenticateToken, validateBody(validators.journalRequest), async (req, res) => {
    const settings = await getUserSettings(req.user.sessionId);
    if (!settings.journalEnabled) {
        return res.status(403).json({ error: 'Journal summaries are disabled in settings.', code: 'JOURNAL_DISABLED' });
    }
    const periodDays = req.validatedBody.period === 'weekly' ? 7 : 1;
    const from = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
    const messages = await Message.find({
        userId: req.user.sessionId,
        createdAt: mongoose.trusted({ $gte: from })
    }).sort({ createdAt: 1 }).limit(500).select('role content createdAt').lean();
    if (messages.length === 0) return res.status(404).json({ error: 'No conversations are available for this period.', code: 'NO_JOURNAL_DATA' });
    const transcript = messages.map((item) => `${item.role}: ${item.content}`).join('\n').slice(0, 80_000);
    const result = await generateContent({
        model: process.env.GEMINI_FACT_MODEL || 'gemini-2.5-flash-lite',
        contents: `Create a private ${req.validatedBody.period} recap from this conversation transcript. Summarize themes, progress, useful highlights, and possible next steps. Do not diagnose mental health or infer sensitive traits.\n\n${transcript}`,
        config: { temperature: 0.3 }
    }, false);
    return res.json({ period: req.validatedBody.period, summary: String(result.text || '').trim() });
});

app.get('/api/reminders', authenticateToken, async (req, res) => {
    const reminders = await Reminder.find({ userId: req.user.sessionId })
        .sort({ status: 1, dueAt: 1 })
        .limit(200)
        .lean();
    return res.json(reminders);
});

app.post('/api/reminders', verifyTrustedOrigin, verifyCsrf, authenticateToken, validateBody(validators.reminderCreate), async (req, res) => {
    const dueAt = new Date(req.validatedBody.dueAt);
    if (dueAt.getTime() < Date.now() - 60_000) {
        return res.status(400).json({ error: 'Reminder time must be in the future.', code: 'REMINDER_IN_PAST' });
    }
    const reminder = await Reminder.create({
        userId: req.user.sessionId,
        ...req.validatedBody,
        dueAt,
        updatedAt: new Date()
    });
    recordAudit('reminder.created', req.user.sessionId, req, { reminderId: String(reminder._id) });
    return res.status(201).json(reminder);
});

app.post('/api/reminders/parse', verifyTrustedOrigin, verifyCsrf, authenticateToken, async (req, res) => {
    const text = String(req.body.text || '').trim().slice(0, 500);
    const zone = resolveTimeZone(req.body.timeZone, DEFAULT_TIME_ZONE);
    if (!text) return res.status(400).json({ error: 'Reminder text is required.', code: 'INVALID_PAYLOAD' });
    const now = getCurrentDateTime(zone);
    const result = await generateContent({
        model: process.env.GEMINI_FACT_MODEL || 'gemini-2.5-flash-lite',
        contents: `Convert the reminder request into strict JSON with keys text, dueAt, recurrence. dueAt must be an ISO-8601 timestamp with an offset. recurrence must be none, daily, or weekly. Current local date: ${now.localDate}. Current local time: ${now.localTime}. Time zone: ${zone}. Request: ${text}`,
        config: { temperature: 0, responseMimeType: 'application/json' }
    }, false);
    try {
        const parsed = JSON.parse(String(result.text || '{}'));
        const validated = validators.reminderCreate.parse({ ...parsed, timeZone: zone });
        return res.json(validated);
    } catch (_) {
        return res.status(422).json({ error: 'The reminder time could not be understood. Use the reminder form instead.', code: 'REMINDER_PARSE_FAILED' });
    }
});

app.patch('/api/reminders/:id', verifyTrustedOrigin, verifyCsrf, authenticateToken, validateBody(validators.reminderUpdate), async (req, res) => {
    const update = { ...req.validatedBody, updatedAt: new Date() };
    if (update.dueAt) update.dueAt = new Date(update.dueAt);
    const reminder = await Reminder.findOneAndUpdate(
        { _id: req.params.id, userId: req.user.sessionId },
        { $set: update },
        { new: true, runValidators: true }
    );
    if (!reminder) return res.status(404).json({ error: 'Reminder not found.', code: 'REMINDER_NOT_FOUND' });
    return res.json(reminder);
});

app.delete('/api/reminders/:id', verifyTrustedOrigin, verifyCsrf, authenticateToken, async (req, res) => {
    const result = await Reminder.deleteOne({ _id: req.params.id, userId: req.user.sessionId });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Reminder not found.', code: 'REMINDER_NOT_FOUND' });
    return res.status(204).send();
});

app.get('/api/reminders/due', authenticateToken, async (req, res) => {
    const dueCandidates = await Reminder.find({
        userId: req.user.sessionId,
        status: 'pending',
        dueAt: mongoose.trusted({ $lte: new Date() })
    }).sort({ dueAt: 1 }).limit(20).select('_id').lean();
    const payload = [];
    for (const candidate of dueCandidates) {
        const reminder = await Reminder.findOneAndUpdate(
            { _id: candidate._id, userId: req.user.sessionId, status: 'pending' },
            { $set: { status: 'processing', updatedAt: new Date() } },
            { new: true }
        );
        if (!reminder) continue;
        payload.push(reminder.toObject());
        await advanceRecurringReminder(reminder);
    }
    return res.json(payload);
});

app.get('/api/push/public-key', authenticateToken, (req, res) => {
    if (!pushConfigured) return res.status(503).json({ error: 'Push notifications are not configured.', code: 'PUSH_NOT_CONFIGURED' });
    return res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

app.post('/api/push/subscribe', verifyTrustedOrigin, verifyCsrf, authenticateToken, validateBody(validators.pushSubscription), async (req, res) => {
    if (!pushConfigured) return res.status(503).json({ error: 'Push notifications are not configured.', code: 'PUSH_NOT_CONFIGURED' });
    const subscription = await PushSubscription.findOneAndUpdate(
        { endpoint: req.validatedBody.endpoint },
        { $set: { ...req.validatedBody, userId: req.user.sessionId, lastUsedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.status(201).json({ success: true, id: String(subscription._id) });
});

app.delete('/api/push/subscribe', verifyTrustedOrigin, verifyCsrf, authenticateToken, async (req, res) => {
    const endpoint = String(req.body.endpoint || '').slice(0, 4000);
    if (endpoint) await PushSubscription.deleteOne({ endpoint, userId: req.user.sessionId });
    return res.status(204).send();
});

app.post('/api/user/delete', verifyTrustedOrigin, verifyCsrf, authenticateToken, async (req, res) => {
    const userId = req.user.sessionId;
    const performDelete = async (mongoSession = null) => {
        const options = mongoSession ? { session: mongoSession } : {};
        await Promise.all([
            Message.deleteMany({ userId }, options),
            Conversation.deleteMany({ userId }, options),
            LegacyChat.deleteMany({ sessionId: userId }, options),
            Fact.deleteMany({ sessionId: userId }, options),
            Reminder.deleteMany({ userId }, options),
            PushSubscription.deleteMany({ userId }, options),
            UsageDaily.deleteMany({ userId }, options),
            AuditEvent.deleteMany({ userId }, options),
            Session.deleteMany({ userId }, options),
            User.deleteOne({ sessionId: userId }, options),
            emailRegex.test(userId) ? WelcomeTrack.deleteOne({ email: normalizeEmail(userId) }, options) : Promise.resolve(),
            emailRegex.test(userId) ? Otp.deleteOne({ email: normalizeEmail(userId) }, options) : Promise.resolve()
        ]);
    };

    const dbSession = await mongoose.startSession();
    try {
        try {
            await dbSession.withTransaction(() => performDelete(dbSession));
        } catch (error) {
            if (!/Transaction numbers are only allowed|replica set|Transaction support/i.test(error.message)) throw error;
            log('warn', 'account_delete_transaction_unavailable', { requestId: req.requestId });
            await performDelete();
        }
        clearRefreshCookies(res);
        recordAudit('account.deleted', null, req, { userIdHash: hashValue(userId) });
        return res.json({ success: true });
    } catch (error) {
        log('error', 'account_delete_failed', { requestId: req.requestId, message: error.message });
        return res.status(500).json({ error: 'Data wipe execution failed.', code: 'ACCOUNT_DELETE_FAILED' });
    } finally {
        await dbSession.endSession();
    }
});

app.get('/api/admin/overview', authenticateToken, requireAdmin, async (req, res) => {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [
        users,
        newUsers,
        activeUsers,
        conversations,
        messages,
        sessions,
        reports,
        aiFailures,
        authenticationFailures,
        rateLimitEvents,
        aiUsage
    ] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ firstLogin: mongoose.trusted({ $gte: dayAgo }) }),
        User.countDocuments({ lastActive: mongoose.trusted({ $gte: dayAgo }) }),
        Conversation.countDocuments(),
        Message.countDocuments(),
        Session.countDocuments({ revokedAt: null, expiresAt: mongoose.trusted({ $gt: new Date() }) }),
        Message.countDocuments({ 'feedback.reportType': mongoose.trusted({ $ne: null }) }),
        AuditEvent.countDocuments({ action: 'ai.request_failed', createdAt: mongoose.trusted({ $gte: dayAgo }) }),
        AuditEvent.countDocuments({ action: /^auth\./, createdAt: mongoose.trusted({ $gte: dayAgo }) }),
        AuditEvent.countDocuments({ action: /^rate_limit\./, createdAt: mongoose.trusted({ $gte: dayAgo }) }),
        UsageDaily.aggregate([{ $group: { _id: null, messages: { $sum: '$messageCount' }, estimatedTokens: { $sum: '$estimatedTokens' } } }])
    ]);
    const usage = aiUsage[0] || { messages: 0, estimatedTokens: 0 };
    usage.estimatedCostUsd = Number(((usage.estimatedTokens / 1_000_000) * ESTIMATED_COST_PER_MILLION_TOKENS_USD).toFixed(6));
    return res.json({
        users,
        newUsers24h: newUsers,
        activeUsers24h: activeUsers,
        conversations,
        messages,
        activeSessions: sessions,
        reports,
        aiFailures24h: aiFailures,
        authenticationFailures24h: authenticationFailures,
        rateLimitEvents24h: rateLimitEvents,
        usage
    });
});

app.get('/api/admin/reports', authenticateToken, requireAdmin, async (req, res) => {
    const reports = await Message.find({ 'feedback.reportType': mongoose.trusted({ $ne: null }) })
        .sort({ 'feedback.updatedAt': -1 })
        .limit(100)
        .select('userId conversationId content feedback createdAt')
        .lean();
    return res.json(reports);
});

app.get('/api/admin/audit', authenticateToken, requireAdmin, async (req, res) => {
    const events = await AuditEvent.find().sort({ createdAt: -1 }).limit(200).lean();
    return res.json(events);
});

app.patch('/api/admin/users/:userId/suspension', verifyTrustedOrigin, verifyCsrf, authenticateToken, requireAdmin, validateBody(validators.adminSuspend), async (req, res) => {
    const userId = decodeURIComponent(req.params.userId).slice(0, 254);
    const update = req.validatedBody.suspended
        ? { suspendedAt: new Date(), suspensionReason: req.validatedBody.reason || 'Administrative action' }
        : { suspendedAt: null, suspensionReason: '' };
    const user = await User.findOneAndUpdate({ sessionId: userId }, { $set: update }, { new: true });
    if (!user) return res.status(404).json({ error: 'User not found.', code: 'USER_NOT_FOUND' });
    if (req.validatedBody.suspended) {
        await Session.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date(), revocationReason: 'account_suspended' } });
    }
    recordAudit(req.validatedBody.suspended ? 'admin.user_suspended' : 'admin.user_unsuspended', req.user.sessionId, req, { targetUserId: userId });
    return res.json({ success: true, userId, suspendedAt: user.suspendedAt, suspensionReason: user.suspensionReason });
});

const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath, {
    etag: true,
    maxAge: isProduction ? '5m' : 0,
    setHeaders(res, filePath) {
        if (filePath.endsWith('sw.js') || filePath.endsWith('script.js')) res.setHeader('Cache-Control', 'no-cache');
    }
}));

app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(publicPath, 'index.html'));
});

app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error?.message === 'Origin is not allowed by CORS policy.') {
        return res.status(403).json({ error: error.message, code: 'ORIGIN_REJECTED', requestId: req.requestId });
    }
    if (error?.name === 'CastError') {
        return res.status(400).json({ error: 'Invalid identifier.', code: 'INVALID_ID', requestId: req.requestId });
    }
    log('error', 'unhandled_request_error', { requestId: req.requestId, message: error.message });
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR', requestId: req.requestId });
});

const PORT = positiveInteger(process.env.PORT, 10000);
let server;

const shutdown = async (signal) => {
    log('info', 'shutdown_started', { signal });
    clearInterval(reminderWorkerTimer);
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.close(false);
};

const startServer = async () => {
    await connectDB();
    startReminderWorker();
    server = app.listen(PORT, () => {
        log('info', 'server_started', {
            port: PORT,
            environment: process.env.NODE_ENV || 'development',
            pushConfigured
        });
    });
    return server;
};

if (require.main === module) {
    process.on('SIGTERM', () => shutdown('SIGTERM').finally(() => process.exit(0)));
    process.on('SIGINT', () => shutdown('SIGINT').finally(() => process.exit(0)));
    process.on('unhandledRejection', (reason) => {
        log('error', 'unhandled_rejection', { message: reason instanceof Error ? reason.message : String(reason) });
    });
    process.on('uncaughtException', (error) => {
        log('fatal', 'uncaught_exception', { message: error.message });
        process.exit(1);
    });
    startServer().catch(() => process.exit(1));
}

module.exports = { app, startServer, shutdown };
