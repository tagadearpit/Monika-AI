'use strict';

const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid identifier.');
const timeZone = z.string().trim().min(1).max(64).optional();

const attachment = z.object({
    name: z.string().trim().min(1).max(160),
    mimeType: z.enum([
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf',
        'text/plain',
        'text/markdown'
    ]),
    size: z.number().int().nonnegative().max(8 * 1024 * 1024),
    data: z.string().min(1).max(12_000_000)
});

const ask = z.object({
    question: z.string().trim().max(4000).default(''),
    conversationId: objectId.optional(),
    attachments: z.array(attachment).max(4).default([]),
    personaOverride: z.enum(['tsundere', 'sweet', 'yandere', 'normal']).optional(),
    userName: z.string().trim().max(30).optional(),
    timeZone,
    responseLength: z.enum(['short', 'balanced', 'detailed']).optional(),
    language: z.string().trim().min(1).max(40).optional(),
    regenerateFromMessageId: objectId.optional(),
    continueFromMessageId: objectId.optional()
}).refine((value) => value.question.length > 0 || value.attachments.length > 0 || value.regenerateFromMessageId || value.continueFromMessageId, {
    message: 'A question, attachment, or message action is required.'
});

const conversationCreate = z.object({
    title: z.string().trim().min(1).max(80).optional()
});

const conversationUpdate = z.object({
    title: z.string().trim().min(1).max(80).optional(),
    isPinned: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0, { message: 'No changes supplied.' });

const memoryCreate = z.object({
    fact: z.string().trim().min(2).max(500),
    category: z.string().trim().min(1).max(50).default('preference'),
    confidence: z.number().min(0).max(1).default(1)
});

const memoryUpdate = z.object({
    fact: z.string().trim().min(2).max(500).optional(),
    category: z.string().trim().min(1).max(50).optional(),
    confidence: z.number().min(0).max(1).optional()
}).refine((value) => Object.keys(value).length > 0, { message: 'No changes supplied.' });

const settingsUpdate = z.object({
    preferredName: z.string().trim().max(30).optional(),
    persona: z.enum(['tsundere', 'sweet', 'yandere', 'normal']).optional(),
    responseLength: z.enum(['short', 'balanced', 'detailed']).optional(),
    language: z.string().trim().min(1).max(40).optional(),
    speechLanguage: z.string().trim().min(2).max(20).optional(),
    voiceName: z.string().trim().max(120).optional(),
    theme: z.enum(['/normal', '/midnight', '/rose', '/cyber', '/matrix', '/sunset', '/yandere']).optional(),
    textSize: z.enum(['small', 'medium', 'large']).optional(),
    soundEffects: z.boolean().optional(),
    autoRead: z.boolean().optional(),
    typingAnimation: z.boolean().optional(),
    memoryEnabled: z.boolean().optional(),
    journalEnabled: z.boolean().optional(),
    handsFree: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0, { message: 'No changes supplied.' });

const feedback = z.object({
    reaction: z.enum(['like', 'dislike']).nullable().optional(),
    reportType: z.enum(['incorrect', 'unsafe', 'other']).nullable().optional(),
    comment: z.string().trim().max(1000).default('')
}).refine((value) => value.reaction !== undefined || value.reportType !== undefined || value.comment.length > 0, {
    message: 'Feedback is empty.'
});

const reminderCreate = z.object({
    text: z.string().trim().min(2).max(500),
    dueAt: z.string().datetime({ offset: true }),
    timeZone: z.string().trim().min(1).max(64),
    recurrence: z.enum(['none', 'daily', 'weekly']).default('none')
});

const reminderUpdate = z.object({
    text: z.string().trim().min(2).max(500).optional(),
    dueAt: z.string().datetime({ offset: true }).optional(),
    timeZone: z.string().trim().min(1).max(64).optional(),
    recurrence: z.enum(['none', 'daily', 'weekly']).optional(),
    status: z.enum(['pending', 'cancelled']).optional()
}).refine((value) => Object.keys(value).length > 0, { message: 'No changes supplied.' });

const pushSubscription = z.object({
    endpoint: z.string().url().max(4000),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({
        p256dh: z.string().min(1).max(1000),
        auth: z.string().min(1).max(1000)
    })
});

const journalRequest = z.object({
    period: z.enum(['daily', 'weekly']).default('daily'),
    timeZone
});

const adminSuspend = z.object({
    suspended: z.boolean(),
    reason: z.string().trim().max(500).default('')
});

module.exports = {
    z,
    objectId,
    ask,
    conversationCreate,
    conversationUpdate,
    memoryCreate,
    memoryUpdate,
    settingsUpdate,
    feedback,
    reminderCreate,
    reminderUpdate,
    pushSubscription,
    journalRequest,
    adminSuspend
};
