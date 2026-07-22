'use strict';

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/monika-test';
process.env.JWT_SECRET = '0123456789abcdef0123456789abcdef';
process.env.OTP_SECRET = 'abcdef0123456789abcdef0123456789';
process.env.ALLOWED_ORIGINS = 'http://localhost:10000';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app } = require('../server');

test('health endpoint returns versioned status', async () => {
    const response = await request(app).get('/api/health').expect(200);
    assert.equal(response.body.status, 'ok');
    assert.equal(response.body.version, '3.0.1');
});

test('config endpoint issues a CSRF token', async () => {
    const response = await request(app).get('/api/config').expect(200);
    assert.match(response.body.csrfToken, /^[a-f\d]{64}$/);
    assert.ok(response.headers['set-cookie'].some((value) => value.startsWith('monika_csrf=')));
});

test('state-changing route rejects missing CSRF token before database work', async () => {
    const response = await request(app)
        .post('/api/auth/refresh')
        .set('Origin', 'http://localhost:10000')
        .expect(403);
    assert.equal(response.body.code, 'CSRF_REQUIRED');
});

test('CORS rejects unknown origins', async () => {
    const response = await request(app)
        .get('/api/health')
        .set('Origin', 'https://malicious.example')
        .expect(403);
    assert.equal(response.body.code, 'ORIGIN_REJECTED');
});

test('settings identify the authenticated email or phone account', async () => {
    const jwt = require('jsonwebtoken');
    const mongoose = require('mongoose');
    const { Session, User } = require('../models');
    const sessionId = new mongoose.Types.ObjectId();
    const originals = {
        sessionFindOne: Session.collection.findOne,
        userFindOne: User.findOne,
        userFindOneAndUpdate: User.findOneAndUpdate
    };

    Session.collection.findOne = async () => ({ _id: sessionId });
    User.findOne = () => ({ select: () => ({ lean: async () => ({ suspendedAt: null }) }) });
    User.findOneAndUpdate = () => ({ lean: async () => ({ settings: {} }) });

    try {
        for (const [identifier, type] of [
            ['user@example.com', 'email'],
            ['+919876543210', 'phone']
        ]) {
            const token = jwt.sign(
                { sub: identifier, sid: String(sessionId), type: 'access' },
                process.env.JWT_SECRET,
                { algorithm: 'HS256', expiresIn: 900, issuer: 'monika-ai', audience: 'monika-web' }
            );
            const response = await request(app)
                .get('/api/settings')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);
            assert.deepEqual(response.body.account, { type, identifier });
            assert.match(response.headers['cache-control'], /no-store/);
        }
    } finally {
        Session.collection.findOne = originals.sessionFindOne;
        User.findOne = originals.userFindOne;
        User.findOneAndUpdate = originals.userFindOneAndUpdate;
    }
});

test('attachment content must match the declared MIME type', async () => {
    const jwt = require('jsonwebtoken');
    const mongoose = require('mongoose');
    const { Session, User, Conversation } = require('../models');
    const sessionId = new mongoose.Types.ObjectId();
    const conversationId = new mongoose.Types.ObjectId();
    const userId = 'attachment-test@example.com';
    const token = jwt.sign(
        { sub: userId, sid: String(sessionId), type: 'access' },
        process.env.JWT_SECRET,
        { algorithm: 'HS256', expiresIn: 900, issuer: 'monika-ai', audience: 'monika-web' }
    );

    const originals = {
        sessionFindOne: Session.collection.findOne,
        userFindOne: User.findOne,
        userFindOneAndUpdate: User.findOneAndUpdate,
        conversationFindOne: Conversation.findOne
    };

    Session.collection.findOne = async () => ({ _id: sessionId });
    User.findOne = () => ({ select: () => ({ lean: async () => ({ suspendedAt: null }) }) });
    User.findOneAndUpdate = () => ({ lean: async () => ({ settings: { memoryEnabled: true } }) });
    Conversation.findOne = async () => ({
        _id: conversationId,
        userId,
        title: 'Attachment test',
        isPinned: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastMessageAt: new Date()
    });

    try {
        const agent = request.agent(app);
        const config = await agent.get('/api/config').expect(200);
        const response = await agent
            .post('/ask')
            .set('Origin', 'http://localhost:10000')
            .set('Authorization', `Bearer ${token}`)
            .set('X-CSRF-Token', config.body.csrfToken)
            .send({
                conversationId: String(conversationId),
                question: 'Inspect this image',
                attachments: [{
                    name: 'fake.jpg',
                    mimeType: 'image/jpeg',
                    size: 5,
                    data: Buffer.from('hello').toString('base64')
                }]
            })
            .expect(400);
        assert.equal(response.body.code, 'ATTACHMENT_TYPE_MISMATCH');
    } finally {
        Session.collection.findOne = originals.sessionFindOne;
        User.findOne = originals.userFindOne;
        User.findOneAndUpdate = originals.userFindOneAndUpdate;
        Conversation.findOne = originals.conversationFindOne;
    }
});

test('AI endpoints support complete and streaming responses without exposing raw attachments', async () => {
    const jwt = require('jsonwebtoken');
    const mongoose = require('mongoose');
    const {
        Session,
        User,
        Conversation,
        Message,
        Fact,
        UsageDaily
    } = require('../models');
    const sessionId = new mongoose.Types.ObjectId();
    const conversationId = new mongoose.Types.ObjectId();
    const userId = 'ai-test@example.com';
    const token = jwt.sign(
        { sub: userId, sid: String(sessionId), type: 'access' },
        process.env.JWT_SECRET,
        { algorithm: 'HS256', expiresIn: 900, issuer: 'monika-ai', audience: 'monika-web' }
    );
    const createdMessages = [];
    const conversation = {
        _id: conversationId,
        userId,
        title: 'AI test',
        isPinned: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastMessageAt: new Date()
    };

    const originals = {
        fakeAi: process.env.FAKE_AI_RESPONSES,
        sessionFindOne: Session.collection.findOne,
        userFindOne: User.findOne,
        userFindOneAndUpdate: User.findOneAndUpdate,
        conversationFindOne: Conversation.findOne,
        conversationUpdateOne: Conversation.updateOne,
        messageCreate: Message.create,
        messageFind: Message.find,
        factFind: Fact.find,
        usageFindOne: UsageDaily.findOne,
        usageUpdateOne: UsageDaily.updateOne
    };

    process.env.FAKE_AI_RESPONSES = 'true';
    Session.collection.findOne = async () => ({ _id: sessionId });
    User.findOne = () => ({ select: () => ({ lean: async () => ({ suspendedAt: null }) }) });
    User.findOneAndUpdate = () => ({ lean: async () => ({ settings: { memoryEnabled: false, persona: 'normal', responseLength: 'short', language: 'English' } }) });
    Conversation.findOne = async () => conversation;
    Conversation.updateOne = async () => ({ acknowledged: true, modifiedCount: 1 });
    Message.create = async (payload) => {
        const message = { _id: new mongoose.Types.ObjectId(), createdAt: new Date(), ...payload };
        createdMessages.push(message);
        return message;
    };
    Message.find = () => ({
        sort: () => ({
            limit: () => ({
                select: () => ({ lean: async () => createdMessages.map((item) => ({ role: item.role, content: item.content, createdAt: item.createdAt })) })
            })
        })
    });
    Fact.find = () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) });
    UsageDaily.findOne = () => ({ lean: async () => null });
    UsageDaily.updateOne = async () => ({ acknowledged: true });

    try {
        const agent = request.agent(app);
        const config = await agent.get('/api/config').expect(200);
        const commonHeaders = {
            Origin: 'http://localhost:10000',
            Authorization: `Bearer ${token}`,
            'X-CSRF-Token': config.body.csrfToken
        };

        const complete = await agent
            .post('/ask')
            .set(commonHeaders)
            .send({ conversationId: String(conversationId), question: 'Return a complete response.', attachments: [] })
            .expect(200);
        assert.match(complete.body.reply, /Test response from Monika/);
        assert.equal(createdMessages.filter((item) => item.role === 'user').length, 1);
        assert.equal(createdMessages.filter((item) => item.role === 'model').length, 1);

        const streamed = await agent
            .post('/api/ask/stream')
            .set(commonHeaders)
            .send({ conversationId: String(conversationId), question: 'Return a streamed response.', attachments: [] })
            .expect(200);
        assert.match(streamed.headers['content-type'], /text\/event-stream/);
        assert.match(streamed.text, /event: delta/);
        assert.match(streamed.text, /event: done/);
        assert.match(streamed.text, /Test response from Monika/);
        assert.equal(createdMessages.filter((item) => item.role === 'user').length, 2);
        assert.equal(createdMessages.filter((item) => item.role === 'model').length, 2);
    } finally {
        if (originals.fakeAi === undefined) delete process.env.FAKE_AI_RESPONSES;
        else process.env.FAKE_AI_RESPONSES = originals.fakeAi;
        Session.collection.findOne = originals.sessionFindOne;
        User.findOne = originals.userFindOne;
        User.findOneAndUpdate = originals.userFindOneAndUpdate;
        Conversation.findOne = originals.conversationFindOne;
        Conversation.updateOne = originals.conversationUpdateOne;
        Message.create = originals.messageCreate;
        Message.find = originals.messageFind;
        Fact.find = originals.factFind;
        UsageDaily.findOne = originals.usageFindOne;
        UsageDaily.updateOne = originals.usageUpdateOne;
    }
});
