'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { buildAdminSearchQueries } = require('../admin-search');

// Must be set before any model interaction
mongoose.set('sanitizeFilter', true);
mongoose.set('strictQuery', true);
mongoose.set('bufferCommands', false);

// ---------------------------------------------------------------------------
// Minimal Mongoose model stubs — no DB connection required.
// Each stub's find() returns a fake query whose _castConditions() runs the
// sanitizeFilter path so we can call query.error() after.
// ---------------------------------------------------------------------------
function makeModel(schema) {
    const conn = mongoose.createConnection();
    conn.set('bufferCommands', false);
    return conn.model(schema.name, schema.definition);
}

const userSchema = new mongoose.Schema({
    sessionId: String,
    suspensionReason: String
}, { strict: true });

const auditSchema = new mongoose.Schema({
    userId: String,
    action: String,
    requestId: String
}, { strict: true });

const messageSchema = new mongoose.Schema({
    userId: String,
    content: String,
    conversationId: String,
    feedback: {
        reportType: String,
        updatedAt: Date
    },
    createdAt: Date
}, { strict: true });

const StubUser = makeModel({ name: 'SUser', definition: userSchema });
const StubAuditEvent = makeModel({ name: 'SAuditEvent', definition: auditSchema });
const StubMessage = makeModel({ name: 'SMessage', definition: messageSchema });

// ---------------------------------------------------------------------------
// Test inputs — covers email, phone, special chars, long strings, tricky chars
// ---------------------------------------------------------------------------
const testQueries = [
    'tagadearpit@gmail.com',
    '+919876543210',
    'a.b+c@x.com',
    'd***@gmail.com',
    '(x',
    'a'.repeat(100)
];

test('buildAdminSearchQueries — all three queries cast cleanly under sanitizeFilter', () => {
    for (const q of testQueries) {
        const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const [userQuery, auditQuery, reportQuery] = buildAdminSearchQueries(
            { Message: StubMessage, User: StubUser, AuditEvent: StubAuditEvent, mongoose },
            regex
        );

        userQuery._castConditions();
        assert.ok(!userQuery.error(), `userQuery should not error for input: ${q}`);

        auditQuery._castConditions();
        assert.ok(!auditQuery.error(), `auditQuery should not error for input: ${q}`);

        reportQuery._castConditions();
        assert.ok(!reportQuery.error(), `reportQuery should not error for input: ${q}`);
    }
});

test('negative control — the OLD broken Message query fails _castConditions under sanitizeFilter', () => {
    const regex = /tagadearpit/i;
    // This is the OLD broken query that wraps the outer object instead of the value
    const brokenQuery = StubMessage.find(
        mongoose.trusted({ 'feedback.reportType': { $ne: null }, $or: [{ userId: regex }, { content: regex }] })
    );
    brokenQuery._castConditions();
    // Under sanitizeFilter, { $ne: null } at the outer level is NOT protected and causes a CastError
    assert.notEqual(brokenQuery.error(), null, 'Broken query must produce a CastError — if this passes, the test is not detecting the bug');
});
