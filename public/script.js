'use strict';

const baseUrl = '';
const MAX_FILES = 4;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_FILE_BYTES = 18 * 1024 * 1024;

let csrfToken = '';
let appConfig = {};
let authToken = null;
let authTokenExpiresAt = 0;
let refreshPromise = null;
let refreshTimer = null;
let auth = null;
let confirmationResult = null;
let recaptchaReady = false;
let bootCompleted = false;
let isVisionActive = false;
let isListening = false;
let isMonikaBusy = false;
let currentStreamController = null;
let currentTypewriterRenderer = null;
let currentConversationId = null;
let conversations = [];
let currentMessages = [];
let pendingAttachments = [];
let userSettings = {};
let searchTimer = null;
let reminderPollTimer = null;
let lastSpeechTime = 0;

const legacyToken = sessionStorage.getItem('monika_token') || localStorage.getItem('monika_token');
const $ = (id) => document.getElementById(id);

const appShell = $('appShell');
const bootOverlay = $('bootOverlay');
const bootStatus = $('bootStatus');
const loginOverlay = $('login-overlay');
const chatMessages = $('chatMessages');
const messageInput = $('messageInput');
const sendBtn = $('sendBtn');
const conversationList = $('conversationList');
const conversationSearchInput = $('conversationSearchInput');
const searchResults = $('searchResults');
const conversationSidebar = $('conversationSidebar');
const sidebarBackdrop = $('sidebarBackdrop');
const currentConversationTitle = $('currentConversationTitle');
const attachmentInput = $('attachmentInput');
const attachmentPreview = $('attachmentPreview');
const visionFeed = $('vision-feed');
const visionContainer = $('vision-container');
const micBtn = $('micButton');
const camBtn = $('camButton');
const pipBtn = $('pipButton');
const settingsModal = $('settingsModal');
const globalUtterance = new SpeechSynthesisUtterance();

const AUTH_CHANNEL_NAME = 'monika-auth';
const authChannel = 'BroadcastChannel' in window ? new BroadcastChannel(AUTH_CHANNEL_NAME) : null;

function clearLegacyAuthStorage() {
    sessionStorage.removeItem('monika_token');
    localStorage.removeItem('monika_token');
}

function broadcastAuthEvent(type) {
    const event = { type, timestamp: Date.now() };
    authChannel?.postMessage(event);
    localStorage.setItem('monika_auth_event', JSON.stringify(event));
    localStorage.removeItem('monika_auth_event');
}

function handleExternalAuthEvent(event) {
    if (!event?.type) return;
    if (event.type === 'logout') {
        authToken = null;
        clearTimeout(refreshTimer);
        setSessionHint(false);
        location.reload();
    } else if (event.type === 'login' && !authToken) {
        restorePersistentSession({ allowLegacyUpgrade: false }).then((restored) => {
            if (restored) enterApplication();
        });
    }
}

authChannel && (authChannel.onmessage = (event) => handleExternalAuthEvent(event.data));
window.addEventListener('storage', (event) => {
    if (event.key !== 'monika_auth_event' || !event.newValue) return;
    try { handleExternalAuthEvent(JSON.parse(event.newValue)); } catch (_) { /* Ignore malformed events. */ }
});

function scheduleAccessTokenRefresh(expiresInSeconds) {
    clearTimeout(refreshTimer);
    const expiresIn = Number(expiresInSeconds) || 900;
    authTokenExpiresAt = Date.now() + expiresIn * 1000;
    refreshTimer = setTimeout(() => {
        restorePersistentSession({ allowLegacyUpgrade: false }).catch(() => undefined);
    }, Math.max((expiresIn - 60) * 1000, 30_000));
}

async function parseJsonSafely(response) {
    try { return await response.json(); } catch (_) { return {}; }
}

function collectErrorDetails(value, seen = new WeakSet()) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') {
        const text = value.trim();
        if (!text) return '';
        if ((text.startsWith('{') || text.startsWith('[')) && text.length <= 20_000) {
            try {
                return `${text} ${collectErrorDetails(JSON.parse(text), seen)}`;
            } catch (_) {
                return text;
            }
        }
        return text;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value instanceof Error) {
        return [
            value.name,
            value.message,
            value.code,
            value.status,
            collectErrorDetails(value.payload, seen)
        ].filter(Boolean).join(' ');
    }
    if (typeof value === 'object') {
        if (seen.has(value)) return '';
        seen.add(value);
        return Object.entries(value)
            .map(([key, item]) => `${key} ${collectErrorDetails(item, seen)}`)
            .join(' ');
    }
    return String(value);
}

function createRequestError(response, data, fallbackMessage) {
    const rawMessage = data?.error || data?.message || fallbackMessage;
    const error = new Error(typeof rawMessage === 'string' ? rawMessage : fallbackMessage);
    error.status = response?.status || Number(data?.status) || 0;
    error.code = data?.code || '';
    error.payload = data;
    return error;
}

function getCuteErrorMessage(error, context = 'general') {
    const details = collectErrorDetails(error).slice(0, 20_000).toLowerCase();
    const status = Number(error?.status || error?.payload?.status || 0);

    if (error?.name === 'AbortError' || /\b(abort|aborted|cancelled|canceled)\b/.test(details)) {
        return 'Okay, I stopped there for you. 🌸';
    }
    if (status === 401 || /auth_required|auth_expired|session_expired|session_revoke|unauthori[sz]ed|token expired/.test(details)) {
        return 'Our session needs a tiny refresh, love. Please sign in again and I’ll be right here. 💗';
    }
    if (status === 403 || /origin_rejected|csrf|forbidden|not allowed by cors/.test(details)) {
        return 'I couldn’t verify that request safely. Please refresh the page and try again. 🌸';
    }
    if (status === 429 || /resource_exhausted|rate.?limit|quota|too many requests|\b429\b/.test(details)) {
        return 'I’m getting lots of messages right now, love. Give me a moment, then try again. 💕';
    }
    if (status === 503 || /service unavailable|unavailable|high demand|overload|temporarily unavailable|\b503\b/.test(details)) {
        return 'I’m a little overwhelmed right now, love. Please try again in a moment. 🌸';
    }
    if (/failed to fetch|networkerror|network error|load failed|connection|offline|timeout|timed out|econn/.test(details)) {
        return 'I couldn’t reach the server just now. Check your connection and try again, okay? 💗';
    }
    if (/payload too large|attachment|unsupported file|mime type|file size|\b413\b/.test(details)) {
        return 'That file was a little too much for me to open. Try a smaller supported file, please. 📎';
    }
    if (context === 'reminder') {
        return 'I couldn’t understand that reminder. Try including a clear day and time, like “tomorrow at 8 PM.” 🔔';
    }
    if (context === 'generation' || /gemini|model|generation|ai pipeline/.test(details)) {
        return 'I couldn’t finish that reply this time, love. Please send it again in a moment. 🌸';
    }
    return 'Something went wrong on my side, love. Please try again in a moment. 🌸';
}

function looksLikeTechnicalError(message) {
    const text = String(message || '');
    return /^error\s*:/i.test(text)
        || /[\[{]\s*["']?error["']?\s*:/i.test(text)
        || /request failed \(\d{3}\)/i.test(text)
        || /service unavailable|stack trace|\bcode\b.*\bstatus\b/i.test(text);
}

function mutationHeaders(headers = {}) {
    const result = new Headers(headers);
    if (csrfToken) result.set('X-CSRF-Token', csrfToken);
    return result;
}

async function restorePersistentSession({ allowLegacyUpgrade = true } = {}) {
    if (refreshPromise) return refreshPromise;
    const executeRefresh = async () => {
        try {
            const response = await fetch(`${baseUrl}/api/auth/refresh`, {
                method: 'POST',
                credentials: 'include',
                headers: mutationHeaders({ 'Content-Type': 'application/json' })
            });
            if (response.ok) {
                const data = await response.json();
                authToken = data.token;
                scheduleAccessTokenRefresh(data.expiresIn);
                clearLegacyAuthStorage();
                setSessionHint(true);
                return true;
            }
            if (allowLegacyUpgrade && legacyToken) {
                const upgradeResponse = await fetch(`${baseUrl}/api/auth/upgrade`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: mutationHeaders({
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${legacyToken}`
                    })
                });
                if (upgradeResponse.ok) {
                    const data = await upgradeResponse.json();
                    authToken = data.token;
                    scheduleAccessTokenRefresh(data.expiresIn);
                    clearLegacyAuthStorage();
                    setSessionHint(true);
                    return true;
                }
            }
            authToken = null;
            clearTimeout(refreshTimer);
            setSessionHint(false);
            return false;
        } catch (error) {
            console.error('Session restoration failed:', error);
            return false;
        }
    };

    refreshPromise = ('locks' in navigator)
        ? navigator.locks.request('monika-session-refresh', executeRefresh)
        : executeRefresh();
    try {
        return await refreshPromise;
    } finally {
        refreshPromise = null;
    }
}

async function apiFetch(url, options = {}, retryOnUnauthorized = true) {
    const headers = new Headers(options.headers || {});
    if (authToken) headers.set('Authorization', `Bearer ${authToken}`);
    if (options.method && options.method.toUpperCase() !== 'GET' && csrfToken) headers.set('X-CSRF-Token', csrfToken);
    const response = await fetch(url, { ...options, headers, credentials: 'include' });
    if (response.status === 401 && retryOnUnauthorized) {
        const restored = await restorePersistentSession({ allowLegacyUpgrade: false });
        if (restored) return apiFetch(url, options, false);
    }
    return response;
}

function renderGoogleButton() {
    const target = $('googleButton');
    if (!target || target.childElementCount > 0 || !window.google?.accounts?.id || !appConfig.googleClientId) return;
    google.accounts.id.renderButton(target, {
        theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', width: 280
    });
}

function setupRecaptcha() {
    if (recaptchaReady || !auth) return;
    window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
        size: 'invisible', callback: () => undefined, 'expired-callback': () => undefined
    });
    recaptchaReady = true;
}

function beginBoot(status = 'Loading Monika AI…') {
    document.body.classList.add('auth-pending');
    if (bootStatus) bootStatus.textContent = status;
    if (bootOverlay) {
        bootOverlay.hidden = false;
        bootOverlay.setAttribute('aria-busy', 'true');
    }
}

function finishBoot() {
    document.body.classList.remove('auth-pending');
    if (bootOverlay) {
        bootOverlay.hidden = true;
        bootOverlay.setAttribute('aria-busy', 'false');
    }
}

function setSessionHint(active) {
    if (active) localStorage.setItem('monika_session_hint', '1');
    else localStorage.removeItem('monika_session_hint');
}

function showLogin() {
    setSessionHint(false);
    appShell.hidden = true;
    loginOverlay.hidden = false;
    finishBoot();
    $('phone-input-section').hidden = false;
    $('otp-input-section').hidden = true;
    $('sendCodeBtn').disabled = false;
    $('sendCodeBtn').textContent = 'Send Login Code';
    $('verifyCodeBtn').disabled = false;
    $('verifyCodeBtn').textContent = 'Verify & Enter';
    setupRecaptcha();
    renderGoogleButton();
}

async function enterApplication() {
    loginOverlay.hidden = true;
    appShell.hidden = true;
    beginBoot('Loading your conversations…');
    try {
        await loadSettings();
    } catch (error) {
        console.error('Settings restoration failed:', error);
        userSettings = {
            persona: 'tsundere',
            responseLength: 'short',
            language: 'English',
            speechLanguage: 'en-IN',
            theme: localStorage.getItem('monika_theme') || '/normal',
            textSize: 'medium',
            soundEffects: true,
            typingAnimation: true,
            memoryEnabled: true
        };
    }
    applySettingsToUi();
    restoreDraft();
    try {
        await loadConversations();
    } catch (error) {
        console.error('Conversation restoration failed:', error);
        addSystemMessage('Your session is active, but conversations could not be loaded. Check the network and reload.');
    }
    startReminderPolling();
    setSessionHint(true);
    appShell.hidden = false;
    finishBoot();
    requestAnimationFrame(() => {
        scrollChatToBottom();
        messageInput.focus({ preventScroll: true });
    });
}

async function initializeApplication() {
    if (bootStatus) {
        bootStatus.textContent = localStorage.getItem('monika_session_hint') === '1'
            ? 'Restoring your secure session…'
            : 'Starting Monika AI…';
    }
    try {
        const configResponse = await fetch(`${baseUrl}/api/config`, { credentials: 'include', cache: 'no-store' });
        if (!configResponse.ok) throw new Error(`Configuration request failed (${configResponse.status})`);
        appConfig = await configResponse.json();
        csrfToken = appConfig.csrfToken || '';

        if (appConfig.firebaseConfig?.apiKey && !firebase.apps.length) {
            firebase.initializeApp(appConfig.firebaseConfig);
            auth = firebase.auth();
            try { await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch (error) { console.warn(error); }
        }
        if (window.google?.accounts?.id && appConfig.googleClientId) {
            google.accounts.id.initialize({
                client_id: appConfig.googleClientId,
                callback: handleGoogleLogin,
                cancel_on_tap_outside: false
            });
        }

        const restored = await restorePersistentSession({ allowLegacyUpgrade: true });
        if (restored) await enterApplication();
        else showLogin();
        registerServiceWorker();
        bootCompleted = true;
    } catch (error) {
        console.error('Initialization error:', error);
        showLogin();
    }
}

window.addEventListener('load', initializeApplication);

$('showEmailBtn').onclick = () => {
    $('showEmailBtn').classList.add('active');
    $('showPhoneBtn').classList.remove('active');
    $('emailInputGroup').hidden = false;
    $('phoneInputGroup').hidden = true;
    $('phoneInput').value = '';
};
$('showPhoneBtn').onclick = () => {
    $('showPhoneBtn').classList.add('active');
    $('showEmailBtn').classList.remove('active');
    $('phoneInputGroup').hidden = false;
    $('emailInputGroup').hidden = true;
    $('emailInput').value = '';
};

async function handleGoogleLogin(response) {
    try {
        const apiResponse = await fetch(`${baseUrl}/api/auth/google`, {
            method: 'POST', credentials: 'include',
            headers: mutationHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ credential: response.credential })
        });
        const data = await parseJsonSafely(apiResponse);
        if (!apiResponse.ok) throw new Error(data.error || 'Google authentication failed.');
        await loginSuccess(data, `Google sign-in complete. Welcome, ${data.name || 'back'}! 🌸`, data.name || '');
    } catch (error) {
        alert(error.message || 'Secure login failed.');
    }
}

$('sendCodeBtn').onclick = async () => {
    const mode = $('showEmailBtn').classList.contains('active') ? 'email' : 'phone';
    const input = $(mode === 'email' ? 'emailInput' : 'phoneInput');
    const value = input.value.trim();
    if (!value) return alert(`Please enter your ${mode}.`);
    if (mode === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return alert('Enter a valid email address.');
    if (mode === 'phone' && !/^\+[1-9]\d{7,14}$/.test(value)) return alert('Use international format, for example +919876543210.');

    $('sendCodeBtn').disabled = true;
    $('sendCodeBtn').textContent = 'Processing...';
    try {
        if (mode === 'email') {
            const response = await fetch(`${baseUrl}/api/auth/send-otp`, {
                method: 'POST', credentials: 'include',
                headers: mutationHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ email: value })
            });
            const data = await parseJsonSafely(response);
            if (!response.ok) throw new Error(data.error || 'Unable to send login code.');
        } else {
            if (!auth) throw new Error('Phone authentication is not configured.');
            setupRecaptcha();
            confirmationResult = await auth.signInWithPhoneNumber(value, window.recaptchaVerifier);
        }
        $('phone-input-section').hidden = true;
        $('otp-input-section').hidden = false;
    } catch (error) {
        alert(error.message || 'Unable to send login code.');
        $('sendCodeBtn').disabled = false;
        $('sendCodeBtn').textContent = 'Send Login Code';
    }
};

$('verifyCodeBtn').onclick = async () => {
    const mode = $('showEmailBtn').classList.contains('active') ? 'email' : 'phone';
    const value = $(mode === 'email' ? 'emailInput' : 'phoneInput').value.trim();
    const code = $('verificationCode').value.trim();
    if (!/^\d{6}$/.test(code)) return alert('Enter the 6-digit code.');
    $('verifyCodeBtn').disabled = true;
    $('verifyCodeBtn').textContent = 'Verifying...';
    try {
        let response;
        if (mode === 'email') {
            response = await fetch(`${baseUrl}/api/auth/verify-otp`, {
                method: 'POST', credentials: 'include',
                headers: mutationHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ email: value, code })
            });
        } else {
            if (!confirmationResult) throw new Error('Request a new SMS code first.');
            const result = await confirmationResult.confirm(code);
            const idToken = await result.user.getIdToken(true);
            response = await fetch(`${baseUrl}/api/auth/firebase`, {
                method: 'POST', credentials: 'include',
                headers: mutationHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ idToken })
            });
        }
        const data = await parseJsonSafely(response);
        if (!response.ok) throw new Error(data.error || 'Verification failed.');
        await loginSuccess(data, `${mode === 'email' ? 'Email' : 'Phone'} verified. Welcome back. 🌸`);
    } catch (error) {
        alert(error.message || 'Verification failed.');
        $('verifyCodeBtn').disabled = false;
        $('verifyCodeBtn').textContent = 'Verify & Enter';
    }
};

async function loginSuccess(data, welcomeMessage, name = '') {
    authToken = data.token;
    scheduleAccessTokenRefresh(data.expiresIn);
    clearLegacyAuthStorage();
    setSessionHint(true);
    await enterApplication();
    addSystemMessage(welcomeMessage);
    broadcastAuthEvent('login');
    apiFetch(`${baseUrl}/api/auth/welcome`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name })
    }).catch((error) => console.error('Welcome email check failed:', error));
}

$('logoutBtn').onclick = async () => {
    $('logoutBtn').disabled = true;
    try {
        const response = await apiFetch(`${baseUrl}/api/auth/logout`, { method: 'POST' }, false);
        if (!response.ok && response.status !== 204) {
            const data = await parseJsonSafely(response);
            throw new Error(data.error || 'Logout failed.');
        }
        if (auth?.currentUser) await auth.signOut();
        window.google?.accounts?.id?.disableAutoSelect();
        authToken = null;
        clearTimeout(refreshTimer);
        setSessionHint(false);
        broadcastAuthEvent('logout');
        location.reload();
    } catch (error) {
        alert(error.message || 'Logout failed.');
        $('logoutBtn').disabled = false;
    }
};

async function loadSettings() {
    const response = await apiFetch(`${baseUrl}/api/settings`, { method: 'GET', cache: 'no-store' });
    if (!response.ok) throw new Error('Unable to load settings.');
    const data = await response.json();
    userSettings = data.settings || {};
    userSettings.isAdmin = Boolean(data.isAdmin);
    $('openAdminBtn').hidden = !userSettings.isAdmin;
}

function applySettingsToUi() {
    applyTheme(userSettings.theme || localStorage.getItem('monika_theme') || '/normal', false);
    applyTextSize(userSettings.textSize || 'medium');
    $('settingUserName').value = userSettings.preferredName || '';
    $('settingPersonaSelect').value = userSettings.persona || 'tsundere';
    $('settingResponseLength').value = userSettings.responseLength || 'short';
    $('settingLanguage').value = userSettings.language || 'English';
    $('settingThemeSelect').value = userSettings.theme || '/normal';
    $('settingTextSize').value = userSettings.textSize || 'medium';
    $('settingSpeechLanguage').value = userSettings.speechLanguage || 'en-IN';
    $('settingAutoRead').checked = Boolean(userSettings.autoRead);
    $('settingTypingToggle').checked = userSettings.typingAnimation !== false;
    $('settingSoundEffects').checked = userSettings.soundEffects !== false;
    $('settingHandsFree').checked = Boolean(userSettings.handsFree);
    $('settingMemoryEnabled').checked = userSettings.memoryEnabled !== false;
    $('settingJournalEnabled').checked = Boolean(userSettings.journalEnabled);
    populateVoices();
}

async function saveSettings(patch, { quiet = false } = {}) {
    const response = await apiFetch(`${baseUrl}/api/settings`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch)
    });
    const data = await parseJsonSafely(response);
    if (!response.ok) throw new Error(data.error || 'Unable to save settings.');
    userSettings = { ...userSettings, ...data.settings };
    applySettingsToUi();
    if (!quiet) addSystemMessage('Preferences saved. 🌸');
}

const themes = {
    '/midnight': 'theme-midnight', '/rose': 'theme-rose', '/cyber': 'theme-cyber',
    '/matrix': 'theme-matrix', '/sunset': 'theme-sunset', '/yandere': 'theme-yandere', '/normal': ''
};

function applyTheme(command, persist = true) {
    document.body.classList.remove('theme-midnight', 'theme-rose', 'theme-cyber', 'theme-matrix', 'theme-sunset', 'theme-yandere');
    const className = themes[command] || '';
    if (className) document.body.classList.add(className);
    if (persist) localStorage.setItem('monika_theme', command);
}

function applyTextSize(size) {
    document.body.classList.remove('text-small', 'text-large');
    if (size === 'small') document.body.classList.add('text-small');
    if (size === 'large') document.body.classList.add('text-large');
}

async function loadConversations(preferredId = null) {
    const response = await apiFetch(`${baseUrl}/api/conversations`, { method: 'GET', cache: 'no-store' });
    if (!response.ok) throw new Error('Unable to load conversations.');
    conversations = await response.json();
    renderConversationList();
    const stored = localStorage.getItem('monika_current_conversation');
    const target = preferredId || (conversations.some((item) => item._id === stored) ? stored : conversations[0]?._id);
    if (target) await selectConversation(target);
}

function renderConversationList() {
    conversationList.innerHTML = '';
    for (const conversation of conversations) {
        const item = document.createElement('div');
        item.className = `conversation-item${conversation._id === currentConversationId ? ' active' : ''}`;
        item.dataset.id = conversation._id;
        const main = document.createElement('div');
        main.className = 'conversation-main';
        const name = document.createElement('span');
        name.className = 'conversation-name';
        name.textContent = conversation.title;
        if (conversation.isPinned) {
            const pin = document.createElement('i');
            pin.className = 'fas fa-thumbtack pin-indicator';
            name.prepend(pin);
        }
        const time = document.createElement('span');
        time.className = 'conversation-time';
        time.textContent = formatRelativeTime(conversation.lastMessageAt);
        main.append(name, time);
        main.onclick = () => selectConversation(conversation._id);

        const actions = document.createElement('div');
        actions.className = 'conversation-actions';
        actions.append(
            conversationAction('fa-pen', 'Rename', () => renameConversation(conversation)),
            conversationAction('fa-thumbtack', conversation.isPinned ? 'Unpin' : 'Pin', () => togglePin(conversation)),
            conversationAction('fa-trash', 'Delete', () => deleteConversation(conversation))
        );
        item.append(main, actions);
        conversationList.appendChild(item);
    }
}

function conversationAction(icon, title, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'conversation-action';
    button.title = title;
    button.innerHTML = `<i class="fas ${icon}"></i>`;
    button.onclick = (event) => { event.stopPropagation(); handler(); };
    return button;
}

async function createConversation(title = 'New conversation') {
    const response = await apiFetch(`${baseUrl}/api/conversations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title })
    });
    const data = await parseJsonSafely(response);
    if (!response.ok) throw new Error(data.error || 'Unable to create conversation.');
    conversations.unshift(data);
    await selectConversation(data._id, { forceReload: true });
    renderConversationList();
    closeSidebar();
}

async function selectConversation(id, { forceReload = false } = {}) {
    if (!forceReload && id === currentConversationId && currentMessages.length > 0) return;
    const response = await apiFetch(`${baseUrl}/api/conversations/${id}/messages`, { method: 'GET', cache: 'no-store' });
    const data = await parseJsonSafely(response);
    if (!response.ok) throw new Error(data.error || 'Unable to load conversation.');
    currentConversationId = id;
    localStorage.setItem('monika_current_conversation', id);
    currentMessages = data.messages || [];
    currentConversationTitle.textContent = data.conversation.title;
    renderConversationList();
    renderMessages();
    closeSidebar();
}

function renderMessages() {
    chatMessages.innerHTML = '';
    if (currentMessages.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.innerHTML = '<div class="empty-state-icon">🌸</div><h2>Start a new conversation</h2><p>Ask a question, attach an image or PDF, use voice input, or create a reminder.</p>';
        chatMessages.appendChild(empty);
        return;
    }
    for (const message of currentMessages) renderMessage(message);
    scrollChatToBottom();
}

function renderMessage(message, { streaming = false } = {}) {
    chatMessages.querySelector('.empty-state')?.remove();
    const sender = message.role === 'user' ? 'user' : message.role === 'model' ? 'monika' : 'system';
    const wrapper = document.createElement('div');
    wrapper.className = `message ${sender}`;
    wrapper.dataset.messageId = message._id || '';
    wrapper.dataset.role = message.role;
    wrapper.dataset.content = message.content || '';

    const content = document.createElement('div');
    content.className = 'message-content';
    const prefix = document.createElement('strong');
    prefix.textContent = sender === 'user' ? 'You: ' : sender === 'monika' ? 'Monika: ' : 'System: ';
    if (sender !== 'user') prefix.style.color = '#ff8fb7';
    const text = document.createElement('span');
    text.className = 'chat-text';
    text.textContent = cleanMoodTags(message.content || '');
    content.append(prefix, text);

    if (message.attachments?.length) {
        const attachmentRow = document.createElement('div');
        attachmentRow.className = 'message-attachments';
        for (const attachment of message.attachments) {
            const chip = document.createElement('span');
            chip.className = 'message-attachment-chip';
            chip.textContent = `${attachmentIcon(attachment.mimeType)} ${attachment.name}`;
            attachmentRow.appendChild(chip);
        }
        content.appendChild(attachmentRow);
    }

    wrapper.appendChild(content);
    if (!streaming) {
        const meta = document.createElement('div');
        meta.className = 'message-meta';
        meta.textContent = message.createdAt ? new Date(message.createdAt).toLocaleString() : '';
        wrapper.appendChild(meta);
        wrapper.appendChild(buildMessageActions(message));
    }
    chatMessages.appendChild(wrapper);
    scrollChatToBottom();
    return wrapper;
}

function buildMessageActions(message) {
    const row = document.createElement('div');
    row.className = 'message-actions';
    row.appendChild(messageAction('fa-copy', 'Copy', () => copyText(cleanMoodTags(message.content))));
    if (message.role === 'user') {
        row.appendChild(messageAction('fa-pen', 'Edit and resend', () => editAndResend(message)));
    }
    if (message.role === 'model') {
        const like = messageAction('fa-thumbs-up', 'Like', () => sendFeedback(message._id, 'like'));
        const dislike = messageAction('fa-thumbs-down', 'Dislike', () => sendFeedback(message._id, 'dislike'));
        if (message.feedback?.reaction === 'like') like.classList.add('selected');
        if (message.feedback?.reaction === 'dislike') dislike.classList.add('selected');
        row.append(like, dislike);
        row.appendChild(messageAction('fa-flag', 'Report', () => reportMessage(message)));
        row.appendChild(messageAction('fa-rotate-right', 'Regenerate', () => sendMessage({ regenerateFromMessageId: message._id })));
        row.appendChild(messageAction('fa-forward', 'Continue', () => sendMessage({ continueFromMessageId: message._id })));
    }
    return row;
}

function messageAction(icon, title, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'message-action-btn';
    button.title = title;
    button.innerHTML = `<i class="fas ${icon}"></i>`;
    button.onclick = handler;
    return button;
}

function cleanMoodTags(value) {
    return String(value || '').replace(/^\[(NORMAL|HAPPY|LOVING|ANGRY|SAD)\]\s*/i, '').trim();
}

function createTypewriterRenderer(textNode) {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    const enabled = userSettings.typingAnimation !== false && !reduceMotion;
    let targetText = '';
    let renderedText = '';
    let frameId = null;
    let lastFrameAt = 0;
    let idleResolvers = [];

    const settle = () => {
        textNode.classList.remove('typewriter-active');
        const resolvers = idleResolvers;
        idleResolvers = [];
        for (const resolve of resolvers) resolve();
    };

    const syncText = () => {
        textNode.textContent = renderedText;
        scrollChatToBottom();
    };

    const commonPrefixLength = (left, right) => {
        const leftChars = Array.from(left);
        const rightChars = Array.from(right);
        const limit = Math.min(leftChars.length, rightChars.length);
        let index = 0;
        while (index < limit && leftChars[index] === rightChars[index]) index += 1;
        return index;
    };

    const renderFrame = (timestamp) => {
        frameId = null;
        if (!enabled) {
            renderedText = targetText;
            syncText();
            settle();
            return;
        }

        if (timestamp - lastFrameAt < 14) {
            frameId = requestAnimationFrame(renderFrame);
            return;
        }
        lastFrameAt = timestamp;

        if (!targetText.startsWith(renderedText)) {
            const commonLength = commonPrefixLength(renderedText, targetText);
            renderedText = Array.from(targetText).slice(0, commonLength).join('');
        }

        const targetChars = Array.from(targetText);
        const renderedLength = Array.from(renderedText).length;
        const backlog = targetChars.length - renderedLength;
        if (backlog <= 0) {
            syncText();
            settle();
            return;
        }

        const charactersPerFrame = backlog > 180 ? 8 : backlog > 90 ? 5 : backlog > 35 ? 3 : 1;
        renderedText = targetChars.slice(0, renderedLength + charactersPerFrame).join('');
        textNode.classList.add('typewriter-active');
        syncText();
        frameId = requestAnimationFrame(renderFrame);
    };

    const schedule = () => {
        if (!enabled) {
            renderedText = targetText;
            syncText();
            settle();
            return;
        }
        textNode.classList.add('typewriter-active');
        if (frameId === null) frameId = requestAnimationFrame(renderFrame);
    };

    return {
        setRaw(rawText) {
            targetText = cleanMoodTags(rawText);
            schedule();
        },
        finish(rawText) {
            targetText = cleanMoodTags(rawText);
            schedule();
            if (renderedText === targetText && frameId === null) {
                settle();
                return Promise.resolve();
            }
            return new Promise((resolve) => idleResolvers.push(resolve));
        },
        skip() {
            if (frameId !== null) window.cancelAnimationFrame(frameId);
            frameId = null;
            renderedText = targetText;
            syncText();
            settle();
        },
        cancel() {
            if (frameId !== null) window.cancelAnimationFrame(frameId);
            frameId = null;
            idleResolvers.forEach((resolve) => resolve());
            idleResolvers = [];
            textNode.classList.remove('typewriter-active');
        }
    };
}

function addSystemMessage(text) {
    const message = looksLikeTechnicalError(text)
        ? getCuteErrorMessage(text)
        : String(text || '');
    renderMessage({ role: 'system', content: message, createdAt: new Date().toISOString() });
}

function showTypingIndicator() {
    if (document.querySelector('.typing-indicator')) return;
    const template = $('typing-template');
    chatMessages.appendChild(template.content.cloneNode(true));
    scrollChatToBottom();
}

function hideTypingIndicator() {
    document.querySelector('.typing-indicator')?.remove();
}

function scrollChatToBottom() {
    requestAnimationFrame(() => { chatMessages.scrollTop = chatMessages.scrollHeight; });
}

function formatRelativeTime(value) {
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return '';
    const diff = Date.now() - timestamp;
    if (diff < 60_000) return 'Now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return new Date(timestamp).toLocaleDateString();
}

async function renameConversation(conversation) {
    const title = prompt('Conversation title:', conversation.title)?.trim();
    if (!title || title === conversation.title) return;
    const response = await apiFetch(`${baseUrl}/api/conversations/${conversation._id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title })
    });
    const data = await parseJsonSafely(response);
    if (!response.ok) return alert(data.error || 'Rename failed.');
    conversations = conversations.map((item) => item._id === data._id ? data : item);
    if (currentConversationId === data._id) currentConversationTitle.textContent = data.title;
    renderConversationList();
}

async function togglePin(conversation) {
    const response = await apiFetch(`${baseUrl}/api/conversations/${conversation._id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isPinned: !conversation.isPinned })
    });
    const data = await parseJsonSafely(response);
    if (!response.ok) return alert(data.error || 'Unable to update pin.');
    conversations = conversations.map((item) => item._id === data._id ? data : item)
        .sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
    renderConversationList();
}

async function deleteConversation(conversation) {
    if (!confirm(`Delete “${conversation.title}” and all of its messages?`)) return;
    const response = await apiFetch(`${baseUrl}/api/conversations/${conversation._id}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 204) return alert('Unable to delete conversation.');
    conversations = conversations.filter((item) => item._id !== conversation._id);
    if (currentConversationId === conversation._id) {
        if (conversations.length === 0) await createConversation();
        else await selectConversation(conversations[0]._id, { forceReload: true });
    }
    renderConversationList();
}

$('newConversationBtn').onclick = () => createConversation().catch((error) => alert(error.message));
currentConversationTitle.onclick = () => {
    const conversation = conversations.find((item) => item._id === currentConversationId);
    if (conversation) renameConversation(conversation);
};

$('clearAllChatsBtn').onclick = async () => {
    if (!confirm('Clear every conversation and message? Your account and memories will remain.')) return;
    const response = await apiFetch(`${baseUrl}/api/conversations`, { method: 'DELETE' });
    const data = await parseJsonSafely(response);
    if (!response.ok) return alert(data.error || 'Unable to clear chat history.');
    conversations = [data.conversation];
    await selectConversation(data.conversation._id, { forceReload: true });
};

conversationSearchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const query = conversationSearchInput.value.trim();
    if (query.length < 2) {
        searchResults.hidden = true;
        searchResults.innerHTML = '';
        return;
    }
    searchTimer = setTimeout(() => runSearch(query), 300);
});

async function runSearch(query) {
    const response = await apiFetch(`${baseUrl}/api/search?q=${encodeURIComponent(query)}`, { method: 'GET', cache: 'no-store' });
    if (!response.ok) return;
    const results = await response.json();
    searchResults.innerHTML = '';
    searchResults.hidden = false;
    if (results.length === 0) {
        searchResults.innerHTML = '<div class="search-result-item"><div class="search-result-snippet">No matching messages.</div></div>';
        return;
    }
    for (const result of results) {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        item.innerHTML = `<div class="search-result-title"></div><div class="search-result-snippet"></div>`;
        item.querySelector('.search-result-title').textContent = result.conversationTitle;
        item.querySelector('.search-result-snippet').textContent = cleanMoodTags(result.content);
        item.onclick = () => selectConversation(result.conversationId, { forceReload: true });
        searchResults.appendChild(item);
    }
}

async function exportConversation(format) {
    if (!currentConversationId) return;
    const response = await apiFetch(`${baseUrl}/api/conversations/${currentConversationId}/export?format=${format}`, { method: 'GET' });
    if (!response.ok) {
        const data = await parseJsonSafely(response);
        return alert(data.error || 'Export failed.');
    }
    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match?.[1] || `monika-conversation.${format}`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
}

$('exportTxtBtn').onclick = () => exportConversation('txt');
$('exportMdBtn').onclick = () => exportConversation('md');
$('exportPdfBtn').onclick = () => exportConversation('pdf');

function restoreDraft() {
    if (!messageInput.value) messageInput.value = localStorage.getItem('monika_message_draft') || '';
}

messageInput.addEventListener('input', () => localStorage.setItem('monika_message_draft', messageInput.value.slice(0, 4000)));
messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (!isMonikaBusy) sendMessage();
    }
});

$('attachButton').onclick = () => attachmentInput.click();
attachmentInput.onchange = async () => {
    const files = [...attachmentInput.files];
    attachmentInput.value = '';
    for (const file of files) {
        if (pendingAttachments.length >= MAX_FILES) break;
        if (file.size > MAX_FILE_BYTES) {
            alert(`${file.name} is larger than 8 MB.`);
            continue;
        }
        const total = pendingAttachments.reduce((sum, item) => sum + item.size, 0) + file.size;
        if (total > MAX_TOTAL_FILE_BYTES) {
            alert('Total attachment size cannot exceed 18 MB.');
            break;
        }
        const mimeType = normalizeMimeType(file);
        if (!mimeType) {
            alert(`${file.name} is not a supported file type.`);
            continue;
        }
        pendingAttachments.push({
            name: file.name,
            mimeType,
            size: file.size,
            data: arrayBufferToBase64(await file.arrayBuffer())
        });
    }
    renderAttachmentPreview();
};

function normalizeMimeType(file) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain', 'text/markdown'];
    if (allowed.includes(file.type)) return file.type;
    if (/\.md$/i.test(file.name)) return 'text/markdown';
    if (/\.txt$/i.test(file.name)) return 'text/plain';
    return '';
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(binary);
}

function renderAttachmentPreview() {
    attachmentPreview.innerHTML = '';
    attachmentPreview.hidden = pendingAttachments.length === 0;
    pendingAttachments.forEach((attachment, index) => {
        const card = document.createElement('div');
        card.className = 'attachment-card';
        card.innerHTML = '<div class="attachment-card-icon"></div><div><div class="attachment-card-name"></div><div class="attachment-card-size"></div></div><button class="remove-attachment" type="button" aria-label="Remove attachment"><i class="fas fa-times"></i></button>';
        card.querySelector('.attachment-card-icon').textContent = attachmentIcon(attachment.mimeType);
        card.querySelector('.attachment-card-name').textContent = attachment.name;
        card.querySelector('.attachment-card-size').textContent = formatBytes(attachment.size);
        card.querySelector('.remove-attachment').onclick = () => {
            pendingAttachments.splice(index, 1);
            renderAttachmentPreview();
        };
        attachmentPreview.appendChild(card);
    });
}

function attachmentIcon(mimeType) {
    if (mimeType?.startsWith('image/')) return '🖼️';
    if (mimeType === 'application/pdf') return '📄';
    return '📝';
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function parseNaturalReminder(text) {
    const response = await apiFetch(`${baseUrl}/api/reminders/parse`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata' })
    });
    const data = await parseJsonSafely(response);
    if (!response.ok) throw createRequestError(response, data, 'Reminder could not be understood.');
    const localTime = new Date(data.dueAt).toLocaleString();
    if (!confirm(`Create reminder “${data.text}” for ${localTime}?`)) return true;
    await createReminder(data);
    addSystemMessage(`Reminder created for ${localTime}. 🔔`);
    return true;
}

async function sendMessage(options = {}) {
    if (isMonikaBusy) return stopGeneration();
    let question = messageInput.value.trim();
    const specialAction = options.regenerateFromMessageId || options.continueFromMessageId;
    if (!specialAction && !question && pendingAttachments.length === 0 && !isVisionActive) return;
    if (!authToken) {
        const restored = await restorePersistentSession({ allowLegacyUpgrade: false });
        if (!restored) return showLogin();
    }

    if (!specialAction && /^remind me\b/i.test(question) && pendingAttachments.length === 0) {
        try {
            const handled = await parseNaturalReminder(question);
            if (handled) {
                messageInput.value = '';
                localStorage.removeItem('monika_message_draft');
                return;
            }
        } catch (error) {
            console.error('Reminder parsing failed:', error);
            addSystemMessage(getCuteErrorMessage(error, 'reminder'));
            openSettingsTab('reminders');
            return;
        }
    }

    const themeCommand = question.toLowerCase();
    if (!specialAction && themes[themeCommand] !== undefined && pendingAttachments.length === 0) {
        await saveSettings({ theme: themeCommand }, { quiet: true });
        messageInput.value = '';
        localStorage.removeItem('monika_message_draft');
        addSystemMessage(`Appearance updated to ${themeCommand.substring(1)}. ✨`);
        return;
    }

    let attachments = pendingAttachments.map((item) => ({ ...item }));
    if (isVisionActive) {
        if (attachments.length >= MAX_FILES) {
            addSystemMessage('Remove one attachment before adding a camera capture.');
            isMonikaBusy = false;
            return;
        }
        const frame = await captureVisionFrame();
        if (frame) attachments.push({ name: 'camera-capture.jpg', mimeType: 'image/jpeg', size: Math.floor(frame.length * 0.75), data: frame });
        if (!question) question = 'What do you see right now?';
    }

    isMonikaBusy = true;
    currentStreamController = new AbortController();
    setBusyUi(true);
    const optimisticUser = !specialAction ? {
        _id: `temp-user-${Date.now()}`,
        role: 'user',
        content: question || 'Analyze the attached content.',
        attachments: attachments.map(({ name, mimeType, size }) => ({ name, mimeType, size })),
        createdAt: new Date().toISOString()
    } : null;
    if (optimisticUser) {
        currentMessages.push(optimisticUser);
        renderMessage(optimisticUser);
    }
    messageInput.value = '';
    localStorage.removeItem('monika_message_draft');
    pendingAttachments = [];
    renderAttachmentPreview();
    showTypingIndicator();

    let streamingWrapper = null;
    let streamingRenderer = null;

    try {
        const response = await apiFetch(`${baseUrl}/api/ask/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
            body: JSON.stringify({
                question,
                conversationId: currentConversationId,
                attachments,
                personaOverride: userSettings.persona || 'tsundere',
                userName: userSettings.preferredName || '',
                responseLength: userSettings.responseLength || 'short',
                language: userSettings.language || 'English',
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
                ...options
            }),
            signal: currentStreamController.signal
        });
        if (!response.ok) {
            const data = await parseJsonSafely(response);
            throw createRequestError(response, data, `Request failed (${response.status})`);
        }
        hideTypingIndicator();
        const placeholder = {
            _id: `temp-model-${Date.now()}`,
            role: 'model', content: '', createdAt: new Date().toISOString()
        };
        streamingWrapper = renderMessage(placeholder, { streaming: true });
        const textNode = streamingWrapper.querySelector('.chat-text');
        streamingRenderer = createTypewriterRenderer(textNode);
        currentTypewriterRenderer = streamingRenderer;
        textNode.classList.add('typewriter-active');
        let finalData = null;
        await consumeSse(response, {
            meta(data) {
                if (data.conversationId && data.conversationId !== currentConversationId) currentConversationId = data.conversationId;
            },
            delta(data) {
                placeholder.content += data.text || '';
                streamingWrapper.dataset.content = placeholder.content;
                streamingRenderer.setRaw(placeholder.content);
            },
            done(data) { finalData = data; },
            error(data) { throw createRequestError(null, data, 'Generation failed.'); }
        });

        if (!finalData) throw new Error('The response stream ended unexpectedly.');
        placeholder._id = finalData.messageId;
        placeholder.content = finalData.reply || placeholder.content;
        await streamingRenderer.finish(placeholder.content);
        textNode.textContent = cleanMoodTags(placeholder.content);
        streamingWrapper.dataset.messageId = placeholder._id;
        streamingWrapper.dataset.content = placeholder.content;
        const meta = document.createElement('div');
        meta.className = 'message-meta';
        meta.textContent = new Date().toLocaleString();
        streamingWrapper.append(meta, buildMessageActions(placeholder));
        currentMessages.push(placeholder);
        if (userSettings.autoRead || userSettings.handsFree) monikaSpeak(placeholder.content);
        else playResponseChime();
        await refreshConversationMetadata(finalData.conversationId);
    } catch (error) {
        hideTypingIndicator();
        streamingRenderer?.cancel();
        streamingWrapper?.remove();
        console.error('Message generation failed:', error);
        addSystemMessage(getCuteErrorMessage(error, 'generation'));
    } finally {
        isMonikaBusy = false;
        currentStreamController = null;
        currentTypewriterRenderer = null;
        setBusyUi(false);
        messageInput.focus();
    }
}

async function consumeSse(response, handlers) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            let eventName = 'message';
            let dataText = '';
            for (const line of block.split('\n')) {
                if (line.startsWith('event:')) eventName = line.slice(6).trim();
                if (line.startsWith('data:')) dataText += line.slice(5).trim();
            }
            if (!dataText) continue;
            const data = JSON.parse(dataText);
            if (handlers[eventName]) handlers[eventName](data);
        }
    }
}

function stopGeneration() {
    currentStreamController?.abort();
    currentTypewriterRenderer?.skip();
}

function setBusyUi(busy) {
    sendBtn.classList.toggle('stop-state', busy);
    sendBtn.innerHTML = busy ? '<i class="fas fa-stop"></i>' : '<i class="fas fa-paper-plane"></i>';
    sendBtn.title = busy ? 'Stop generating' : 'Send message';
    messageInput.disabled = busy;
    $('attachButton').disabled = busy;
    camBtn.disabled = busy;
}

sendBtn.onclick = () => isMonikaBusy ? stopGeneration() : sendMessage();

async function refreshConversationMetadata(conversationId) {
    const response = await apiFetch(`${baseUrl}/api/conversations`, { method: 'GET', cache: 'no-store' });
    if (!response.ok) return;
    conversations = await response.json();
    const current = conversations.find((item) => item._id === conversationId);
    if (current) currentConversationTitle.textContent = current.title;
    renderConversationList();
}

async function copyText(text) {
    try { await navigator.clipboard.writeText(text); } catch (_) { /* Clipboard may be blocked. */ }
}

function editAndResend(message) {
    const edited = prompt('Edit the message and resend:', message.content)?.trim();
    if (!edited) return;
    messageInput.value = edited;
    messageInput.focus();
}

async function sendFeedback(messageId, reaction) {
    const response = await apiFetch(`${baseUrl}/api/messages/${messageId}/feedback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reaction, comment: '' })
    });
    if (!response.ok) return alert('Feedback could not be saved.');
    const message = currentMessages.find((item) => item._id === messageId);
    if (message) message.feedback = await response.json();
    renderMessages();
}

async function reportMessage(message) {
    const type = prompt('Report type: incorrect, unsafe, or other', 'incorrect')?.trim().toLowerCase();
    if (!['incorrect', 'unsafe', 'other'].includes(type)) return;
    const comment = prompt('Optional details:', '') || '';
    const response = await apiFetch(`${baseUrl}/api/messages/${message._id}/feedback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportType: type, comment })
    });
    if (!response.ok) return alert('Report could not be submitted.');
    addSystemMessage('Report submitted for administrator review.');
}

if (camBtn) {
    camBtn.onclick = async () => {
        if (isMonikaBusy) return;
        isVisionActive = !isVisionActive;
        if (isVisionActive) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
                visionFeed.srcObject = stream;
                visionContainer.hidden = false;
                camBtn.classList.add('active');
                document.body.classList.add('camera-active');
            } catch (_) {
                alert('Camera access is required for Vision Mode.');
                isVisionActive = false;
            }
        } else stopVisionMode();
    };
}

function stopVisionMode() {
    visionFeed?.srcObject?.getTracks().forEach((track) => track.stop());
    if (visionFeed) visionFeed.srcObject = null;
    if (visionContainer) visionContainer.hidden = true;
    camBtn?.classList.remove('active');
    document.body.classList.remove('camera-active');
    isVisionActive = false;
}

async function captureVisionFrame() {
    if (!visionFeed?.srcObject || !visionFeed.videoWidth || !visionFeed.videoHeight) return null;
    const canvas = $('capture-canvas');
    canvas.width = visionFeed.videoWidth;
    canvas.height = visionFeed.videoHeight;
    canvas.getContext('2d', { alpha: false }).drawImage(visionFeed, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.72).split(',')[1];
}

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let recognitionProducedResult = false;
if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.interimResults = false;
    recognition.onstart = () => {
        recognitionProducedResult = false;
        isListening = true;
        micBtn.classList.add('active');
        messageInput.placeholder = 'Listening...';
    };
    recognition.onresult = (event) => {
        recognitionProducedResult = true;
        messageInput.value = event.results[event.results.length - 1][0].transcript;
    };
    recognition.onerror = (event) => console.error('Speech recognition error:', event.error);
    recognition.onend = () => {
        isListening = false;
        micBtn.classList.remove('active');
        messageInput.placeholder = 'Type to Monika... 💕';
        if (recognitionProducedResult && messageInput.value && !isMonikaBusy && Date.now() - lastSpeechTime > 500) {
            lastSpeechTime = Date.now();
            sendMessage();
        }
    };
}

function startListening() {
    if (!recognition || isListening || isMonikaBusy) return;
    recognition.lang = userSettings.speechLanguage || 'en-IN';
    window.speechSynthesis.cancel();
    recognition.start();
}

micBtn.onclick = () => {
    if (!recognition) return alert('Voice recognition is not supported in this browser.');
    if (isListening) recognition.stop(); else startListening();
};

function populateVoices() {
    const select = $('settingVoiceSelect');
    if (!select) return;
    const voices = window.speechSynthesis.getVoices();
    const selected = userSettings.voiceName || '';
    select.innerHTML = '<option value="">System default</option>';
    for (const voice of voices) {
        const option = document.createElement('option');
        option.value = voice.name;
        option.textContent = `${voice.name} (${voice.lang})`;
        option.selected = voice.name === selected;
        select.appendChild(option);
    }
}
window.speechSynthesis.onvoiceschanged = populateVoices;

function playResponseChime() {
    if (userSettings.soundEffects === false) return;
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        const context = new AudioContextClass();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = 620;
        gain.gain.setValueAtTime(0.025, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.12);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.12);
        oscillator.onended = () => context.close();
    } catch (_) { /* Audio feedback is best effort. */ }
}

function monikaSpeak(text) {
    window.speechSynthesis.cancel();
    globalUtterance.text = cleanMoodTags(text);
    globalUtterance.lang = userSettings.speechLanguage || 'en-IN';
    globalUtterance.rate = 1.02;
    globalUtterance.pitch = 1.25;
    const voices = window.speechSynthesis.getVoices();
    globalUtterance.voice = voices.find((voice) => voice.name === userSettings.voiceName)
        || voices.find((voice) => /female|zira|samantha|google uk english female/i.test(voice.name))
        || voices[0]
        || null;
    globalUtterance.onend = () => {
        if (userSettings.handsFree && !isListening && !isMonikaBusy) setTimeout(startListening, 400);
    };
    window.speechSynthesis.speak(globalUtterance);
}

pipBtn.onclick = async () => {
    if (!window.documentPictureInPicture) return alert('Use a recent Chrome version for Pop-Out Window.');
    try {
        const pipWindow = await window.documentPictureInPicture.requestWindow({ width: 430, height: 650 });
        [...document.styleSheets].forEach((sheet) => {
            if (sheet.ownerNode) pipWindow.document.head.appendChild(sheet.ownerNode.cloneNode(true));
        });
        pipWindow.document.body.append($('chat-container'));
        pipWindow.addEventListener('pagehide', (event) => {
            const chatContainer = event.target.querySelector('#chat-container');
            if (chatContainer) $('main-wrapper').append(chatContainer);
        });
    } catch (error) { console.error('Picture-in-Picture failed:', error); }
};

function openSidebar() {
    conversationSidebar.classList.add('open');
    sidebarBackdrop.hidden = false;
}
function closeSidebar() {
    conversationSidebar.classList.remove('open');
    sidebarBackdrop.hidden = true;
}
$('openSidebarBtn').onclick = openSidebar;
$('closeSidebarBtn').onclick = closeSidebar;
sidebarBackdrop.onclick = closeSidebar;

$('settingsBtn').onclick = () => openSettingsTab('general');
$('manageDataBtn').onclick = () => openSettingsTab('devices');
$('closeSettingsBtn').onclick = () => { settingsModal.hidden = true; };
settingsModal.addEventListener('click', (event) => { if (event.target === settingsModal) settingsModal.hidden = true; });

function openSettingsTab(name) {
    settingsModal.hidden = false;
    document.querySelectorAll('.settings-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
    document.querySelectorAll('.settings-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === name));
    if (name === 'memory') loadMemories();
    if (name === 'devices') loadSessions();
    if (name === 'reminders') loadReminders();
}

document.querySelectorAll('.settings-tab').forEach((tab) => { tab.onclick = () => openSettingsTab(tab.dataset.tab); });

$('saveGeneralSettingsBtn').onclick = async () => {
    try {
        await saveSettings({
            preferredName: $('settingUserName').value.trim(),
            persona: $('settingPersonaSelect').value,
            responseLength: $('settingResponseLength').value,
            language: $('settingLanguage').value.trim() || 'English',
            theme: $('settingThemeSelect').value,
            textSize: $('settingTextSize').value,
            speechLanguage: $('settingSpeechLanguage').value.trim() || 'en-IN',
            voiceName: $('settingVoiceSelect').value,
            autoRead: $('settingAutoRead').checked,
            typingAnimation: $('settingTypingToggle').checked,
            soundEffects: $('settingSoundEffects').checked,
            handsFree: $('settingHandsFree').checked
        });
        settingsModal.hidden = true;
        closeSidebar();
        requestAnimationFrame(() => {
            scrollChatToBottom();
            messageInput.focus({ preventScroll: true });
        });
    } catch (error) { alert(error.message); }
};

$('settingThemeSelect').onchange = () => applyTheme($('settingThemeSelect').value, true);
$('settingTextSize').onchange = () => applyTextSize($('settingTextSize').value);
$('settingMemoryEnabled').onchange = () => saveSettings({ memoryEnabled: $('settingMemoryEnabled').checked }, { quiet: true }).catch((error) => alert(error.message));
$('settingJournalEnabled').onchange = () => saveSettings({ journalEnabled: $('settingJournalEnabled').checked }, { quiet: true }).catch((error) => alert(error.message));

async function loadMemories() {
    const response = await apiFetch(`${baseUrl}/api/memories`, { method: 'GET', cache: 'no-store' });
    if (!response.ok) return;
    const memories = await response.json();
    const list = $('memoryList');
    list.innerHTML = '';
    if (!memories.length) list.innerHTML = '<div class="management-item"><div><div class="management-title">No saved memories.</div></div></div>';
    for (const memory of memories) {
        const item = managementItem(memory.fact, `${memory.category} · ${memory.source} · ${Math.round((memory.confidence || 0) * 100)}%`, [
            ['fa-pen', 'Edit', () => editMemory(memory)],
            ['fa-trash', 'Delete', () => deleteMemory(memory), true]
        ]);
        list.appendChild(item);
    }
}

$('addMemoryBtn').onclick = async () => {
    const fact = $('memoryInput').value.trim();
    if (!fact) return;
    const response = await apiFetch(`${baseUrl}/api/memories`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fact, category: 'manual', confidence: 1 })
    });
    const data = await parseJsonSafely(response);
    if (!response.ok) return alert(data.error || 'Unable to add memory.');
    $('memoryInput').value = '';
    loadMemories();
};

async function editMemory(memory) {
    const fact = prompt('Edit memory:', memory.fact)?.trim();
    if (!fact) return;
    const response = await apiFetch(`${baseUrl}/api/memories/${memory._id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fact })
    });
    if (!response.ok) return alert('Unable to update memory.');
    loadMemories();
}

async function deleteMemory(memory) {
    if (!confirm('Delete this memory?')) return;
    const response = await apiFetch(`${baseUrl}/api/memories/${memory._id}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 204) return alert('Unable to delete memory.');
    loadMemories();
}

$('clearMemoriesBtn').onclick = async () => {
    if (!confirm('Clear every saved memory?')) return;
    const response = await apiFetch(`${baseUrl}/api/memories`, { method: 'DELETE' });
    if (response.ok || response.status === 204) loadMemories();
};

async function loadSessions() {
    const response = await apiFetch(`${baseUrl}/api/sessions`, { method: 'GET', cache: 'no-store' });
    if (!response.ok) return;
    const sessions = await response.json();
    const list = $('sessionList');
    list.innerHTML = '';
    for (const session of sessions) {
        const title = `${session.deviceName} · ${session.browser}${session.current ? ' (This device)' : ''}`;
        const subtitle = `${session.operatingSystem} · Last active ${new Date(session.lastSeenAt).toLocaleString()}`;
        const actions = session.current ? [] : [['fa-right-from-bracket', 'Revoke', () => revokeSession(session), true]];
        list.appendChild(managementItem(title, subtitle, actions));
    }
}

async function revokeSession(session) {
    const response = await apiFetch(`${baseUrl}/api/sessions/${session._id}`, { method: 'DELETE' });
    if (!response.ok) return alert('Unable to revoke device.');
    loadSessions();
}

$('revokeOtherSessionsBtn').onclick = async () => {
    if (!confirm('Log out every other device?')) return;
    const response = await apiFetch(`${baseUrl}/api/sessions/revoke-others`, { method: 'POST' });
    const data = await parseJsonSafely(response);
    if (!response.ok) return alert(data.error || 'Unable to revoke sessions.');
    addSystemMessage(`${data.revoked} other device session(s) revoked.`);
    loadSessions();
};

function managementItem(title, subtitle, actions) {
    const item = document.createElement('div');
    item.className = 'management-item';
    const text = document.createElement('div');
    text.innerHTML = '<div class="management-title"></div><div class="management-subtitle"></div>';
    text.querySelector('.management-title').textContent = title;
    text.querySelector('.management-subtitle').textContent = subtitle;
    const controls = document.createElement('div');
    controls.className = 'management-actions';
    for (const [icon, label, handler, danger] of actions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `management-btn${danger ? ' danger' : ''}`;
        button.title = label;
        button.innerHTML = `<i class="fas ${icon}"></i>`;
        button.onclick = handler;
        controls.appendChild(button);
    }
    item.append(text, controls);
    return item;
}

async function createReminder(payload) {
    const response = await apiFetch(`${baseUrl}/api/reminders`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const data = await parseJsonSafely(response);
    if (!response.ok) throw new Error(data.error || 'Unable to create reminder.');
    return data;
}

$('addReminderBtn').onclick = async () => {
    const text = $('reminderText').value.trim();
    const localValue = $('reminderDateTime').value;
    if (!text || !localValue) return alert('Enter reminder text and time.');
    try {
        await createReminder({
            text,
            dueAt: new Date(localValue).toISOString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
            recurrence: $('reminderRecurrence').value
        });
        $('reminderText').value = '';
        $('reminderDateTime').value = '';
        loadReminders();
    } catch (error) { alert(error.message); }
};

async function loadReminders() {
    const response = await apiFetch(`${baseUrl}/api/reminders`, { method: 'GET', cache: 'no-store' });
    if (!response.ok) return;
    const reminders = await response.json();
    const list = $('reminderList');
    list.innerHTML = '';
    if (!reminders.length) list.innerHTML = '<div class="management-item"><div><div class="management-title">No reminders.</div></div></div>';
    for (const reminder of reminders) {
        const subtitle = `${new Date(reminder.dueAt).toLocaleString()} · ${reminder.recurrence} · ${reminder.status}`;
        list.appendChild(managementItem(reminder.text, subtitle, [
            ['fa-trash', 'Delete', () => deleteReminder(reminder), true]
        ]));
    }
}

async function deleteReminder(reminder) {
    const response = await apiFetch(`${baseUrl}/api/reminders/${reminder._id}`, { method: 'DELETE' });
    if (response.ok || response.status === 204) loadReminders();
}

$('enableNotificationsBtn').onclick = enablePushNotifications;

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

async function enablePushNotifications() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return alert('Push notifications are not supported in this browser.');
    if (!appConfig.pushPublicKey) return alert('Push notifications are not configured on the server. In-app reminder notifications will still work while the app is open.');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return alert('Notification permission was not granted.');
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(appConfig.pushPublicKey)
        });
    }
    const response = await apiFetch(`${baseUrl}/api/push/subscribe`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(subscription.toJSON())
    });
    if (!response.ok) return alert('Push subscription could not be saved.');
    alert('Notifications enabled.');
}

function startReminderPolling() {
    clearInterval(reminderPollTimer);
    checkDueReminders();
    reminderPollTimer = setInterval(checkDueReminders, 60_000);
}

async function checkDueReminders() {
    if (!authToken) return;
    try {
        const response = await apiFetch(`${baseUrl}/api/reminders/due`, { method: 'GET', cache: 'no-store' });
        if (!response.ok) return;
        const due = await response.json();
        for (const reminder of due) showReminderNotification(reminder);
    } catch (_) { /* Polling is best effort. */ }
}

async function showReminderNotification(reminder) {
    addSystemMessage(`Reminder: ${reminder.text} 🔔`);
    if (Notification.permission === 'granted' && 'serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        registration.showNotification('Monika AI Reminder 🌸', { body: reminder.text, icon: '/icon-192.png', data: { url: '/' } });
    }
}

async function generateRecap(period) {
    const output = $('journalOutput');
    output.hidden = false;
    output.textContent = 'Generating recap...';
    const response = await apiFetch(`${baseUrl}/api/journal/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata' })
    });
    const data = await parseJsonSafely(response);
    output.textContent = response.ok ? data.summary : (data.error || 'Recap failed.');
}
$('dailyRecapBtn').onclick = () => generateRecap('daily');
$('weeklyRecapBtn').onclick = () => generateRecap('weekly');

$('openAdminBtn').onclick = () => window.open('/admin.html', '_blank', 'noopener');

$('wipeDataBtn').onclick = async () => {
    if (!confirm('Delete your account, conversations, memories, reminders, and every active session? This cannot be undone.')) return;
    const response = await apiFetch(`${baseUrl}/api/user/delete`, { method: 'POST' });
    const data = await parseJsonSafely(response);
    if (!response.ok) return alert(data.error || 'Account deletion failed.');
    if (auth?.currentUser) await auth.signOut();
    authToken = null;
    localStorage.clear();
    sessionStorage.clear();
    broadcastAuthEvent('logout');
    location.reload();
};

window.addEventListener('online', () => {
    $('connectionStatus').className = 'connection-status online';
    $('connectionStatus').innerHTML = '<i class="fas fa-circle"></i> Online';
    if (bootCompleted && authToken) restorePersistentSession({ allowLegacyUpgrade: false }).catch(() => undefined);
});
window.addEventListener('offline', () => {
    $('connectionStatus').className = 'connection-status offline';
    $('connectionStatus').innerHTML = '<i class="fas fa-circle"></i> Offline';
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && authToken && authTokenExpiresAt - Date.now() < 120_000) {
        restorePersistentSession({ allowLegacyUpgrade: false }).catch(() => undefined);
    }
});

window.addEventListener('pagehide', () => {
    if (isVisionActive) stopVisionMode();
    if (isListening && recognition) recognition.stop();
    window.speechSynthesis.cancel();
});

$('phoneInput').addEventListener('input', function () { this.value = this.value.replace(/[^\d+]/g, ''); });

document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openSidebar();
        conversationSearchInput.focus();
    }
    if (event.key === 'Escape') {
        closeSidebar();
        settingsModal.hidden = true;
    }
});

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch((error) => console.error('Service worker registration failed:', error));
}
