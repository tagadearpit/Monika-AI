'use strict';

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.JWT_SECRET = '0123456789abcdef0123456789abcdef';
process.env.OTP_SECRET = 'abcdef0123456789abcdef0123456789';
process.env.ALLOWED_ORIGINS = 'http://localhost:10000';
process.env.ADMIN_EMAILS = 'admin@example.com';
process.env.FAKE_AI_RESPONSES = 'true';
process.env.MAX_DAILY_MESSAGES = '1000';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/monika-test';

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { app } = require('../server');
const {
    User,
    Session,
    Conversation,
    Message,
    Fact,
    Reminder
} = require('../models');

const enabled = process.env.RUN_DB_INTEGRATION_TESTS === 'true';

if (!enabled) {
    test('database integration suite', { skip: 'Set RUN_DB_INTEGRATION_TESTS=true and ensure the MongoDB test binary is available.' }, () => {});
} else {

let mongo;
let agent;
let csrfToken;
let accessToken;
const userId = 'admin@example.com';

const authHeaders = () => ({
    Authorization: `Bearer ${accessToken}`,
    'X-CSRF-Token': csrfToken,
    Origin: 'http://localhost:10000'
});

test.before(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongo.getUri();
    await mongoose.connect(process.env.MONGO_URI);

    const session = await Session.create({
        userId,
        tokenHash: 'a'.repeat(64),
        deviceName: 'Test device',
        browser: 'Test browser',
        operatingSystem: 'Test OS',
        createdAt: new Date(),
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    });
    await User.create({ sessionId: userId });
    accessToken = jwt.sign(
        { sub: userId, sid: String(session._id), type: 'access' },
        process.env.JWT_SECRET,
        {
            algorithm: 'HS256',
            expiresIn: 900,
            issuer: 'monika-ai',
            audience: 'monika-web'
        }
    );

    agent = request.agent(app);
    const config = await agent.get('/api/config').expect(200);
    csrfToken = config.body.csrfToken;
});

test.after(async () => {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
});

test('settings can be read and updated', async () => {
    const initial = await agent.get('/api/settings').set(authHeaders()).expect(200);
    assert.equal(initial.body.isAdmin, true);
    assert.deepEqual(initial.body.account, { type: 'email', identifier: userId });

    const updated = await agent
        .patch('/api/settings')
        .set(authHeaders())
        .send({ preferredName: 'Arpit', responseLength: 'balanced', memoryEnabled: true })
        .expect(200);
    assert.equal(updated.body.settings.preferredName, 'Arpit');
    assert.equal(updated.body.settings.responseLength, 'balanced');
});

test('conversation lifecycle and AI response persist messages', async () => {
    const created = await agent
        .post('/api/conversations')
        .set(authHeaders())
        .send({ title: 'Integration chat' })
        .expect(201);
    const conversationId = created.body._id;

    const answer = await agent
        .post('/ask')
        .set(authHeaders())
        .send({
            conversationId,
            question: 'What is the current date?',
            timeZone: 'Asia/Kolkata',
            attachments: []
        })
        .expect(200);
    assert.match(answer.body.reply, /Test response/);

    const messages = await agent
        .get(`/api/conversations/${conversationId}/messages`)
        .set(authHeaders())
        .expect(200);
    assert.equal(messages.body.messages.length, 2);
    assert.equal(messages.body.messages[0].role, 'user');
    assert.equal(messages.body.messages[1].role, 'model');

    const stream = await agent
        .post('/api/ask/stream')
        .set(authHeaders())
        .send({ conversationId, question: 'Stream this response.', attachments: [] })
        .expect(200);
    assert.match(stream.text, /event: delta/);
    assert.match(stream.text, /event: done/);

    const storedCount = await Message.countDocuments({ conversationId });
    assert.equal(storedCount, 4);
});

test('memory CRUD works', async () => {
    const created = await agent
        .post('/api/memories')
        .set(authHeaders())
        .send({ fact: 'Prefers concise technical answers', category: 'preference', confidence: 1 })
        .expect(201);

    await agent
        .patch(`/api/memories/${created.body._id}`)
        .set(authHeaders())
        .send({ fact: 'Prefers precise technical answers' })
        .expect(200);

    const list = await agent.get('/api/memories').set(authHeaders()).expect(200);
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].fact, 'Prefers precise technical answers');

    await agent.delete(`/api/memories/${created.body._id}`).set(authHeaders()).expect(204);
    assert.equal(await Fact.countDocuments({ sessionId: userId }), 0);
});

test('session management identifies the current session', async () => {
    const sessions = await agent.get('/api/sessions').set(authHeaders()).expect(200);
    assert.equal(sessions.body.length, 1);
    assert.equal(sessions.body[0].current, true);
});

test('reminders can be created, listed, and deleted', async () => {
    const created = await agent
        .post('/api/reminders')
        .set(authHeaders())
        .send({
            text: 'Review deployment logs',
            dueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            timeZone: 'Asia/Kolkata',
            recurrence: 'none'
        })
        .expect(201);

    const reminders = await agent.get('/api/reminders').set(authHeaders()).expect(200);
    assert.equal(reminders.body.length, 1);

    await agent.delete(`/api/reminders/${created.body._id}`).set(authHeaders()).expect(204);
    assert.equal(await Reminder.countDocuments({ userId }), 0);
});

test('conversation export supports text and PDF', async () => {
    const conversation = await Conversation.findOne({ userId }).sort({ createdAt: -1 }).lean();
    const txt = await agent
        .get(`/api/conversations/${conversation._id}/export?format=txt`)
        .set(authHeaders())
        .expect(200);
    assert.match(txt.headers['content-type'], /text\/plain/);
    assert.match(txt.text, /Integration chat/);

    const pdf = await agent
        .get(`/api/conversations/${conversation._id}/export?format=pdf`)
        .set(authHeaders())
        .buffer(true)
        .parse((res, callback) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);
    assert.match(pdf.headers['content-type'], /application\/pdf/);
    assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');
});

test('admin overview returns operational counts', async () => {
    const overview = await agent.get('/api/admin/overview').set(authHeaders()).expect(200);
    assert.ok(overview.body.users >= 1);
    assert.ok(overview.body.messages >= 4);
    assert.ok(overview.body.activeSessions >= 1);
});
}
