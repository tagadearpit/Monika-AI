'use strict';

const crypto = require('crypto');

const positiveInteger = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const hashValue = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const hashOtp = (secret, email, code) => crypto.createHmac('sha256', secret).update(`${email}:${code}`).digest('hex');

const resolveTimeZone = (value, fallback = 'Asia/Kolkata') => {
    const candidate = typeof value === 'string' ? value.trim() : '';
    if (!candidate || candidate.length > 64) return fallback;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
        return candidate;
    } catch (_) {
        return fallback;
    }
};

const getCurrentDateTime = (timeZone) => {
    const now = new Date();
    return {
        localDate: new Intl.DateTimeFormat('en-IN', {
            timeZone,
            weekday: 'long',
            day: '2-digit',
            month: 'long',
            year: 'numeric'
        }).format(now),
        localTime: new Intl.DateTimeFormat('en-IN', {
            timeZone,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true,
            timeZoneName: 'short'
        }).format(now),
        timeZone,
        utcTimestamp: now.toISOString()
    };
};

const parseUserAgent = (value) => {
    const ua = String(value || '');
    let browser = 'Unknown browser';
    let operatingSystem = 'Unknown OS';
    let deviceName = 'Unknown device';

    if (/Edg\//i.test(ua)) browser = 'Microsoft Edge';
    else if (/OPR\//i.test(ua)) browser = 'Opera';
    else if (/Chrome\//i.test(ua)) browser = 'Google Chrome';
    else if (/Firefox\//i.test(ua)) browser = 'Mozilla Firefox';
    else if (/Safari\//i.test(ua)) browser = 'Safari';

    if (/Windows NT 10/i.test(ua)) operatingSystem = 'Windows 10/11';
    else if (/Android/i.test(ua)) operatingSystem = 'Android';
    else if (/iPhone|iPad|iPod/i.test(ua)) operatingSystem = 'iOS/iPadOS';
    else if (/Mac OS X/i.test(ua)) operatingSystem = 'macOS';
    else if (/Linux/i.test(ua)) operatingSystem = 'Linux';

    if (/Mobile/i.test(ua) && /Android/i.test(ua)) deviceName = 'Android phone';
    else if (/iPhone/i.test(ua)) deviceName = 'iPhone';
    else if (/iPad/i.test(ua)) deviceName = 'iPad';
    else if (/Android/i.test(ua)) deviceName = 'Android device';
    else if (/Windows|Macintosh|Linux/i.test(ua)) deviceName = 'Desktop browser';

    return { browser, operatingSystem, deviceName };
};

const getClientIp = (req) => {
    const forwarded = req.get('x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0].trim();
    return req.ip || req.socket?.remoteAddress || '';
};

const getClientIpHash = (req, secret) => {
    const ip = getClientIp(req);
    if (!ip) return null;
    return crypto.createHmac('sha256', secret).update(ip).digest('hex');
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const sanitizeFileName = (value) => String(value || 'attachment')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 160) || 'attachment';

const approximateBase64Bytes = (value) => {
    const normalized = String(value || '').replace(/\s/g, '');
    if (!normalized) return 0;
    const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
    return Math.floor((normalized.length * 3) / 4) - padding;
};

const dateKeyForTimeZone = (timeZone) => new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
}).format(new Date());

const estimateTokens = (inputCharacters, outputCharacters) => Math.ceil((inputCharacters + outputCharacters) / 4);

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

module.exports = {
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
    estimateTokens,
    clamp
};
