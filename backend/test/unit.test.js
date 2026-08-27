'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    resolveTimeZone,
    getCurrentDateTime,
    parseUserAgent,
    approximateBase64Bytes,
    sanitizeFileName,
    dateKeyForTimeZone,
    hashAdminPassword,
    verifyAdminPassword
} = require('../utils');
const validators = require('../validation');
const { buildOtpEmail, buildLoginAlertEmail } = require('../email-templates');

test('timezone utilities reject invalid zones and format live timestamps', () => {
    assert.equal(resolveTimeZone('Invalid/Zone', 'Asia/Kolkata'), 'Asia/Kolkata');
    assert.equal(resolveTimeZone('America/New_York', 'Asia/Kolkata'), 'America/New_York');
    const value = getCurrentDateTime('Asia/Kolkata');
    assert.equal(value.timeZone, 'Asia/Kolkata');
    assert.doesNotThrow(() => new Date(value.utcTimestamp).toISOString());
    assert.ok(value.localDate.length > 5);
    assert.ok(value.localTime.length > 5);
    assert.match(dateKeyForTimeZone('Asia/Kolkata'), /^\d{2}\/\d{2}\/\d{4}$|^\d{4}-\d{2}-\d{2}$/);
});

test('user agent and file helpers return bounded safe metadata', () => {
    const metadata = parseUserAgent('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36');
    assert.equal(metadata.browser, 'Google Chrome');
    assert.equal(metadata.operatingSystem, 'Android');
    assert.equal(metadata.deviceName, 'Android phone');
    assert.equal(approximateBase64Bytes(Buffer.from('hello').toString('base64')), 5);
    assert.equal(sanitizeFileName('../unsafe:file?.txt'), '.._unsafe_file_.txt');
});

test('admin password hashing verifies valid passwords and rejects invalid passwords', () => {
    const hash = hashAdminPassword('StrongAdminPass123!');
    assert.equal(verifyAdminPassword('StrongAdminPass123!', hash), true);
    const wrappedHash = `${hash.slice(0, 40)}\r\n${hash.slice(40)}`;
    assert.equal(verifyAdminPassword('StrongAdminPass123!', wrappedHash), true);
    assert.equal(verifyAdminPassword('WrongPass', hash), false);
    assert.equal(verifyAdminPassword('StrongAdminPass123!', 'invalidhash'), false);
    assert.equal(verifyAdminPassword('StrongAdminPass123!', null), false);
});

test('ask validation enforces supported attachments and message actions', () => {
    assert.equal(validators.ask.parse({ question: 'Hello' }).question, 'Hello');
    assert.throws(() => validators.ask.parse({ question: '', attachments: [] }));
    assert.throws(() => validators.ask.parse({
        question: 'Analyze',
        attachments: [{ name: 'bad.exe', mimeType: 'application/octet-stream', size: 10, data: 'AAAA' }]
    }));
});

test('settings validation rejects unknown or unsafe values', () => {
    assert.equal(validators.settingsUpdate.parse({ persona: 'sweet' }).persona, 'sweet');
    assert.throws(() => validators.settingsUpdate.parse({ persona: 'unrestricted-system-prompt' }));
    assert.throws(() => validators.settingsUpdate.parse({}));
});


test('async Express route failures reach error middleware', async () => {
    const express = require('express');
    require('express-async-errors');
    const request = require('supertest');
    const testApp = express();
    testApp.get('/failure', async () => {
        throw new Error('expected async failure');
    });
    testApp.use((error, _req, res, _next) => res.status(500).json({ message: error.message }));
    const response = await request(testApp).get('/failure').expect(500);
    assert.equal(response.body.message, 'expected async failure');
});

test('frontend script references existing HTML element identifiers', () => {
    const publicDir = path.resolve(__dirname, '../../public');
    for (const [htmlFile, scriptFile] of [['index.html', 'script.js'], ['admin.html', 'admin.js'], ['admin-login.html', 'admin-login.js']]) {
        const html = fs.readFileSync(path.join(publicDir, htmlFile), 'utf8');
        const script = fs.readFileSync(path.join(publicDir, scriptFile), 'utf8');
        const ids = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
        assert.equal(ids.size, [...html.matchAll(/\bid=["']([^"']+)["']/g)].length, `${htmlFile} has duplicate IDs`);
        const references = new Set([
            ...[...script.matchAll(/\$\(["']([^"']+)["']\)/g)].map((match) => match[1]),
            ...[...script.matchAll(/getElementById\(["']([^"']+)["']\)/g)].map((match) => match[1])
        ]);
        const missing = [...references].filter((id) => !ids.has(id));
        assert.deepEqual(missing, [], `${scriptFile} references missing HTML IDs`);
    }
});

test('v3.0.1 frontend prevents login-page flash during session restoration', () => {
    const publicDir = path.resolve(__dirname, '../../public');
    const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
    const script = fs.readFileSync(path.join(publicDir, 'script.js'), 'utf8');
    assert.match(html, /id="bootOverlay"/);
    assert.match(html, /id="login-overlay"[^>]*hidden/);
    assert.match(script, /async function initializeApplication\(\)/);
    assert.match(script, /await restorePersistentSession/);
    assert.match(script, /finishBoot\(\)/);
});

test('v3.0.1 frontend contains typewriter streaming and closes preferences after save', () => {
    const publicDir = path.resolve(__dirname, '../../public');
    const script = fs.readFileSync(path.join(publicDir, 'script.js'), 'utf8');
    const css = fs.readFileSync(path.join(publicDir, 'style.css'), 'utf8');
    assert.match(script, /function createTypewriterRenderer/);
    assert.match(script, /await streamingRenderer\.finish/);
    assert.match(script, /settingsModal\.hidden = true/);
    assert.match(css, /\.chat-text\.typewriter-active::after/);
});

test('settings show the authenticated account as read-only server data', () => {
    const publicDir = path.resolve(__dirname, '../../public');
    const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
    const script = fs.readFileSync(path.join(publicDir, 'script.js'), 'utf8');
    assert.match(html, /id="settingAccountIdentifier"[^>]*readonly/);
    assert.match(script, /userAccount = data\.account/);
    assert.match(script, /userAccount\?\.identifier \|\| 'Unavailable'/);
});

test('typewriter renderer progressively reveals streamed text and strips mood tags', async () => {
    const vm = require('node:vm');
    const publicDir = path.resolve(__dirname, '../../public');
    const source = fs.readFileSync(path.join(publicDir, 'script.js'), 'utf8');

    const extractFunction = (name) => {
        const start = source.indexOf(`function ${name}`);
        assert.notEqual(start, -1, `${name} exists`);
        const bodyStart = source.indexOf('{', start);
        let depth = 0;
        for (let index = bodyStart; index < source.length; index += 1) {
            if (source[index] === '{') depth += 1;
            if (source[index] === '}') depth -= 1;
            if (depth === 0) return source.slice(start, index + 1);
        }
        throw new Error(`Could not extract ${name}`);
    };

    const callbacks = new Map();
    let nextFrameId = 1;
    const classes = new Set();
    const textNode = {
        textContent: '',
        classList: {
            add: (value) => classes.add(value),
            remove: (value) => classes.delete(value)
        }
    };

    const context = {
        window: {
            matchMedia: () => ({ matches: false }),
            cancelAnimationFrame: (id) => callbacks.delete(id)
        },
        userSettings: { typingAnimation: true },
        scrollChatToBottom: () => undefined,
        requestAnimationFrame: (callback) => {
            const id = nextFrameId++;
            callbacks.set(id, callback);
            return id;
        },
        Array,
        Promise
    };

    vm.runInNewContext(
        `${extractFunction('cleanMoodTags')}\n${extractFunction('createTypewriterRenderer')}\nthis.createRenderer = createTypewriterRenderer;`,
        context
    );

    const renderer = context.createRenderer(textNode);
    renderer.setRaw('[HAPPY] Hello, Arpit!');

    let timestamp = 16;
    while (callbacks.size > 0) {
        const pending = [...callbacks.entries()];
        callbacks.clear();
        for (const [, callback] of pending) callback(timestamp);
        timestamp += 16;
    }

    assert.equal(textNode.textContent, 'Hello, Arpit!');
    assert.equal(classes.has('typewriter-active'), false);

    const completion = renderer.finish('[LOVING] Hello, Arpit! Welcome back.');
    while (callbacks.size > 0) {
        const pending = [...callbacks.entries()];
        callbacks.clear();
        for (const [, callback] of pending) callback(timestamp);
        timestamp += 16;
    }
    await completion;
    assert.equal(textNode.textContent, 'Hello, Arpit! Welcome back.');
});

test('email templates generate branded HTML and plain-text fallback', () => {
    const otpEmail = buildOtpEmail({ otpCode: '123456', appUrl: 'https://monika-ai-0jpf.onrender.com' });
    assert.equal(otpEmail.subject, '123456 is your Monika AI verification code');
    assert.match(otpEmail.html, /123456/);
    assert.ok(otpEmail.html.includes('/otp-verification'));
    assert.match(otpEmail.text, /123456/);

    const loginEmail = buildLoginAlertEmail({
        browser: 'Chrome',
        operatingSystem: 'Windows',
        time: 'August 1, 2026 at 9:00 PM',
        appUrl: 'https://monika-ai-0jpf.onrender.com'
    });
    assert.equal(loginEmail.subject, 'New sign-in to your Monika AI account');
    assert.match(loginEmail.html, /Chrome · Windows/);
    assert.ok(loginEmail.html.includes('/settings?tab=devices'));
    assert.ok(loginEmail.text.includes('/settings?tab=devices'));
});

test('empty streaming placeholder renders empty text without fallback and typing indicator waits for first delta', () => {
    const vm = require('node:vm');
    const publicDir = path.resolve(__dirname, '../../public');
    const source = fs.readFileSync(path.join(publicDir, 'script.js'), 'utf8');

    const extractFunction = (name) => {
        const start = source.indexOf(`function ${name}(`);
        assert.notEqual(start, -1, `${name} exists`);
        const bodyStart = source.indexOf(') {', start) + 2;
        let depth = 0;
        for (let index = bodyStart; index < source.length; index += 1) {
            if (source[index] === '{') depth += 1;
            if (source[index] === '}') depth -= 1;
            if (depth === 0) return source.slice(start, index + 1);
        }
        throw new Error(`Could not extract ${name}`);
    };

    const createMockElement = (tag) => {
        const children = [];
        const el = {
            tagName: tag,
            className: '',
            textContent: '',
            dataset: {},
            style: {},
            append: (...nodes) => { for (const n of nodes) el.appendChild(n); },
            appendChild: (node) => { children.push(node); return node; },
            querySelector: (selector) => {
                if (selector === '.chat-text' && el.className === 'chat-text') return el;
                for (const child of children) {
                    if (child.className && child.className.includes(selector.replace('.', ''))) return child;
                    const found = child.querySelector && child.querySelector(selector);
                    if (found) return found;
                }
                return null;
            },
            remove: () => {},
            classList: {
                add: () => {},
                remove: () => {}
            }
        };
        return el;
    };

    const context = {
        document: { createElement: createMockElement },
        chatMessages: createMockElement('div'),
        scrollChatToBottom: () => {},
        buildMessageActions: () => createMockElement('div'),
        attachmentIcon: () => '📎'
    };

    vm.runInNewContext(
        `${extractFunction('cleanMoodTags')}\n${extractFunction('renderMessage')}\nthis.renderMessage = renderMessage;`,
        context
    );

    const streamingMsg = context.renderMessage({ role: 'model', content: '' }, { streaming: true });
    const streamingText = streamingMsg.querySelector('.chat-text');
    assert.equal(streamingText.textContent, '');
    assert.doesNotMatch(streamingText.textContent, /lost my train of thought/i);

    const nonStreamingMsg = context.renderMessage({ role: 'model', content: '' }, { streaming: false });
    const nonStreamingText = nonStreamingMsg.querySelector('.chat-text');
    assert.match(nonStreamingText.textContent, /lost my train of thought/i);

    assert.match(source, /const ensureStreamingUi = \(\) => \{/);
    assert.match(source, /if \(!deltaText\) return;\s*ensureStreamingUi\(\);/);
    assert.match(source, /if \(!finalData\) throw new Error\([^)]*\);\s*ensureStreamingUi\(\);/);
    assert.match(source, /streamingWrapper\?\.remove\(\);/);
    assert.match(source, /userSettings\.typingAnimation/);
});

test('splitIntoSpeechChunks preserves 100% of characters without dropping decimals, abbreviations, or symbols', () => {
    const vm = require('node:vm');
    const publicDir = path.resolve(__dirname, '../../public');
    const source = fs.readFileSync(path.join(publicDir, 'script.js'), 'utf8');

    const extractFunction = (name) => {
        const start = source.indexOf(`function ${name}(`);
        assert.notEqual(start, -1, `${name} exists`);
        const bodyStart = source.indexOf(') {', start) + 2;
        let depth = 0;
        for (let index = bodyStart; index < source.length; index += 1) {
            if (source[index] === '{') depth += 1;
            if (source[index] === '}') depth -= 1;
            if (depth === 0) return source.slice(start, index + 1);
        }
        throw new Error(`Could not extract ${name}`);
    };

    const context = {};
    vm.runInNewContext(
        `${extractFunction('splitIntoSpeechChunks')}\nthis.splitIntoSpeechChunks = splitIntoSpeechChunks;`,
        context
    );

    const testStrings = [
        'Your score was 9.5 out of 10. Great work! Keep pushing.',
        'The item costs $12.99 or Rs.45 at 3.30pm... Dr.Smith confirmed it!',
        'Hello... world?! Yes! Really?',
        'Dr. Watson and Mr. Holmes met at 221B Baker St. at 5.45pm.',
        'Plain text with no ending punctuation whatsoever',
        'Short.',
        'Multiple short sentences. One. Two. Three. Four. Five sentences combined together.'
    ];

    for (const str of testStrings) {
        const chunks = context.splitIntoSpeechChunks(str);
        assert.ok(Array.isArray(chunks) && chunks.length > 0, `Returns non-empty array for: "${str}"`);
        const joined = chunks.join(' ');
        const normalizedOriginal = str.replace(/\s+/g, ' ').trim();
        const normalizedJoined = joined.replace(/\s+/g, ' ').trim();
        assert.equal(normalizedJoined, normalizedOriginal, `Zero characters dropped for: "${str}"`);
    }

    // Specific decimal and abbreviation content assertions
    const scoreChunks = context.splitIntoSpeechChunks('Your score was 9.5 out of 10. Great work! Keep pushing.');
    assert.ok(scoreChunks.some((c) => c.includes('9.5')), 'Decimals like 9.5 are preserved in chunks');
    assert.ok(scoreChunks[0].startsWith('Your score was 9.5'), 'First chunk starts from the beginning');

    const doctorChunks = context.splitIntoSpeechChunks('The item costs $12.99 or Rs.45 at 3.30pm... Dr.Smith confirmed it!');
    assert.ok(doctorChunks.some((c) => c.includes('$12.99') && c.includes('Rs.45') && c.includes('3.30pm')), 'Currencies and times preserved');
    assert.ok(doctorChunks.some((c) => c.includes('Dr.Smith')), 'Abbreviations like Dr.Smith preserved');
});

test('frontend script handles 429 quota errors gracefully with single toast and no stuck state', () => {
    const publicDir = path.resolve(__dirname, '../../public');
    const source = fs.readFileSync(path.join(publicDir, 'script.js'), 'utf8');

    assert.match(source, /TTS_QUOTA_EXCEEDED/);
    assert.match(source, /retryAfterSeconds/);
    assert.match(source, /AI voice is rate-limited/);
    assert.match(source, /ttsQuotaToastShown/);
    assert.match(source, /autoResizeInput/);
});


