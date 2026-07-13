'use strict';

const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema({
    name: { type: String, required: true, maxlength: 160 },
    mimeType: { type: String, required: true, maxlength: 100 },
    size: { type: Number, required: true, min: 0 },
    kind: { type: String, enum: ['image', 'pdf', 'text'], required: true }
}, { _id: false });

const feedbackSchema = new mongoose.Schema({
    reaction: { type: String, enum: ['like', 'dislike', null], default: null },
    reportType: {
        type: String,
        enum: ['incorrect', 'unsafe', 'other', null],
        default: null
    },
    comment: { type: String, default: '', maxlength: 1000 },
    updatedAt: { type: Date, default: null }
}, { _id: false });

const legacyChatSchema = new mongoose.Schema({
    sessionId: { type: String, required: true, index: true },
    role: { type: String, enum: ['user', 'model'], required: true },
    text: { type: String, required: true },
    timestamp: { type: Date, default: Date.now, index: true }
}, { collection: 'chats' });
legacyChatSchema.index({ sessionId: 1, timestamp: 1 });

const conversationSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    title: { type: String, required: true, default: 'New conversation', maxlength: 80 },
    isPinned: { type: Boolean, default: false, index: true },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { collection: 'conversations' });
conversationSchema.index({ userId: 1, isPinned: -1, lastMessageAt: -1 });

const messageSchema = new mongoose.Schema({
    conversationId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    userId: { type: String, required: true, index: true },
    role: { type: String, enum: ['user', 'model', 'system'], required: true },
    content: { type: String, required: true, maxlength: 30000 },
    attachments: { type: [attachmentSchema], default: [] },
    feedback: { type: feedbackSchema, default: () => ({}) },
    createdAt: { type: Date, default: Date.now, index: true }
}, { collection: 'messages' });
messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ userId: 1, content: 'text' });

const factSchema = new mongoose.Schema({
    sessionId: { type: String, required: true, index: true },
    fact: { type: String, required: true, maxlength: 500 },
    category: { type: String, default: 'preference', maxlength: 50 },
    source: { type: String, enum: ['automatic', 'manual', 'imported'], default: 'automatic' },
    confidence: { type: Number, min: 0, max: 1, default: 0.7 },
    timestamp: { type: Date, default: Date.now, index: true },
    updatedAt: { type: Date, default: Date.now }
}, { collection: 'facts' });
factSchema.index({ sessionId: 1, timestamp: -1 });
factSchema.index({ sessionId: 1, fact: 1 });

const otpSchema = new mongoose.Schema({
    email: { type: String, unique: true, required: true },
    code: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now, expires: 300 }
}, { collection: 'otps' });

const welcomeTrackSchema = new mongoose.Schema({
    email: { type: String, unique: true, required: true },
    timestamp: { type: Date, default: Date.now }
}, { collection: 'welcometracks' });

const userSettingsSchema = new mongoose.Schema({
    preferredName: { type: String, default: '', maxlength: 30 },
    persona: { type: String, enum: ['tsundere', 'sweet', 'yandere', 'normal'], default: 'tsundere' },
    responseLength: { type: String, enum: ['short', 'balanced', 'detailed'], default: 'short' },
    language: { type: String, default: 'English', maxlength: 40 },
    speechLanguage: { type: String, default: 'en-IN', maxlength: 20 },
    voiceName: { type: String, default: '', maxlength: 120 },
    theme: { type: String, default: '/normal', maxlength: 30 },
    textSize: { type: String, enum: ['small', 'medium', 'large'], default: 'medium' },
    soundEffects: { type: Boolean, default: true },
    autoRead: { type: Boolean, default: false },
    typingAnimation: { type: Boolean, default: true },
    memoryEnabled: { type: Boolean, default: true },
    journalEnabled: { type: Boolean, default: false },
    handsFree: { type: Boolean, default: false }
}, { _id: false });

const userSchema = new mongoose.Schema({
    sessionId: { type: String, unique: true, required: true },
    firstLogin: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now },
    settings: { type: userSettingsSchema, default: () => ({}) },
    suspendedAt: { type: Date, default: null },
    suspensionReason: { type: String, default: '', maxlength: 500 }
}, { collection: 'users' });

const sessionSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    previousTokenHash: { type: String, default: null, index: true },
    previousValidUntil: { type: Date, default: null },
    tokenHistoryHashes: { type: [String], default: [], select: false },
    userAgentHash: { type: String, default: null },
    deviceName: { type: String, default: 'Unknown device', maxlength: 120 },
    browser: { type: String, default: 'Unknown browser', maxlength: 80 },
    operatingSystem: { type: String, default: 'Unknown OS', maxlength: 80 },
    lastIpHash: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date, required: true, expires: 0 },
    revokedAt: { type: Date, default: null },
    revocationReason: { type: String, default: '', maxlength: 120 }
}, { collection: 'sessions' });
sessionSchema.index({ userId: 1, lastSeenAt: -1 });

const reminderSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    text: { type: String, required: true, maxlength: 500 },
    dueAt: { type: Date, required: true, index: true },
    timeZone: { type: String, required: true, maxlength: 64 },
    recurrence: { type: String, enum: ['none', 'daily', 'weekly'], default: 'none' },
    status: { type: String, enum: ['pending', 'processing', 'delivered', 'cancelled'], default: 'pending', index: true },
    deliveredAt: { type: Date, default: null },
    deliveryAttempts: { type: Number, default: 0 },
    lastError: { type: String, default: '', maxlength: 500 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { collection: 'reminders' });
reminderSchema.index({ status: 1, dueAt: 1 });
reminderSchema.index({ userId: 1, dueAt: 1 });

const pushSubscriptionSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    expirationTime: { type: Number, default: null },
    keys: {
        p256dh: { type: String, required: true },
        auth: { type: String, required: true }
    },
    createdAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date, default: Date.now }
}, { collection: 'pushsubscriptions' });

const auditEventSchema = new mongoose.Schema({
    userId: { type: String, default: null, index: true },
    action: { type: String, required: true, index: true, maxlength: 100 },
    requestId: { type: String, default: null, maxlength: 128 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now, index: true, expires: 60 * 60 * 24 * 180 }
}, { collection: 'auditevents' });

const usageDailySchema = new mongoose.Schema({
    userId: { type: String, required: true },
    dateKey: { type: String, required: true },
    messageCount: { type: Number, default: 0 },
    imageCount: { type: Number, default: 0 },
    inputCharacters: { type: Number, default: 0 },
    outputCharacters: { type: Number, default: 0 },
    estimatedTokens: { type: Number, default: 0 },
    updatedAt: { type: Date, default: Date.now }
}, { collection: 'usagedaily' });
usageDailySchema.index({ userId: 1, dateKey: 1 }, { unique: true });

module.exports = {
    LegacyChat: mongoose.model('LegacyChat', legacyChatSchema),
    Conversation: mongoose.model('Conversation', conversationSchema),
    Message: mongoose.model('Message', messageSchema),
    Fact: mongoose.model('Fact', factSchema),
    Otp: mongoose.model('Otp', otpSchema),
    WelcomeTrack: mongoose.model('WelcomeTrack', welcomeTrackSchema),
    User: mongoose.model('User', userSchema),
    Session: mongoose.model('Session', sessionSchema),
    Reminder: mongoose.model('Reminder', reminderSchema),
    PushSubscription: mongoose.model('PushSubscription', pushSubscriptionSchema),
    AuditEvent: mongoose.model('AuditEvent', auditEventSchema),
    UsageDaily: mongoose.model('UsageDaily', usageDailySchema)
};
