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
    dateKeyForTimeZone
} = require('../utils');
const validators = require('../validation');

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
    for (const [htmlFile, scriptFile] of [['index.html', 'script.js'], ['admin.html', 'admin.js']]) {
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
