'use strict';

const baseUrl = '';
let isVisionActive = false;
let isMonikaBusy = false;
let isListening = false;
let lastSpeechTime = 0;
let authToken = null;
let authTokenExpiresAt = 0;
let refreshPromise = null;
let refreshTimer = null;
let auth;
let confirmationResult;
let recaptchaReady = false;
let bootCompleted = false;

const legacyToken = sessionStorage.getItem('monika_token') || localStorage.getItem('monika_token');

const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const loginOverlay = document.getElementById('login-overlay');
const visionFeed = document.getElementById('vision-feed');
const visionContainer = document.getElementById('vision-container');
const micBtn = document.getElementById('micButton');
const camBtn = document.getElementById('camButton');
const pipBtn = document.getElementById('pipButton');
const showEmailBtn = document.getElementById('showEmailBtn');
const showPhoneBtn = document.getElementById('showPhoneBtn');
const emailInputGroup = document.getElementById('emailInputGroup');
const phoneInputGroup = document.getElementById('phoneInputGroup');
const globalUtterance = new SpeechSynthesisUtterance();

const AUTH_CHANNEL_NAME = 'monika-auth';
const authChannel = 'BroadcastChannel' in window ? new BroadcastChannel(AUTH_CHANNEL_NAME) : null;

function clearLegacyAuthStorage() {
    sessionStorage.removeItem('monika_token');
    localStorage.removeItem('monika_token');
}

function broadcastAuthEvent(type) {
    const event = { type, timestamp: Date.now() };
    if (authChannel) authChannel.postMessage(event);
    localStorage.setItem('monika_auth_event', JSON.stringify(event));
    localStorage.removeItem('monika_auth_event');
}

function handleExternalAuthEvent(event) {
    if (!event || !event.type) return;
    if (event.type === 'logout') {
        authToken = null;
        clearTimeout(refreshTimer);
        location.reload();
    }
    if (event.type === 'login' && !authToken) {
        restorePersistentSession({ allowLegacyUpgrade: false }).then((restored) => {
            if (restored) enterApplication(true);
        });
    }
}

if (authChannel) authChannel.onmessage = (event) => handleExternalAuthEvent(event.data);
window.addEventListener('storage', (event) => {
    if (event.key !== 'monika_auth_event' || !event.newValue) return;
    try { handleExternalAuthEvent(JSON.parse(event.newValue)); } catch (_) { /* Ignore malformed cross-tab events. */ }
});

function scheduleAccessTokenRefresh(expiresInSeconds) {
    clearTimeout(refreshTimer);
    const expiresIn = Number(expiresInSeconds) || 900;
    authTokenExpiresAt = Date.now() + expiresIn * 1000;
    const refreshDelay = Math.max((expiresIn - 60) * 1000, 30_000);
    refreshTimer = setTimeout(() => {
        restorePersistentSession({ allowLegacyUpgrade: false }).catch(() => undefined);
    }, refreshDelay);
}

async function parseJsonSafely(response) {
    try { return await response.json(); } catch (_) { return {}; }
}

async function restorePersistentSession({ allowLegacyUpgrade = true } = {}) {
    if (refreshPromise) return refreshPromise;

    const executeRefresh = async () => {
        try {
            const response = await fetch(`${baseUrl}/api/auth/refresh`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                const data = await response.json();
                authToken = data.token;
                scheduleAccessTokenRefresh(data.expiresIn);
                clearLegacyAuthStorage();
                return true;
            }

            if (allowLegacyUpgrade && legacyToken) {
                const upgradeResponse = await fetch(`${baseUrl}/api/auth/upgrade`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${legacyToken}`
                    }
                });
                if (upgradeResponse.ok) {
                    const data = await upgradeResponse.json();
                    authToken = data.token;
                    scheduleAccessTokenRefresh(data.expiresIn);
                    clearLegacyAuthStorage();
                    return true;
                }
            }

            authToken = null;
            clearTimeout(refreshTimer);
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

    const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include'
    });

    if (response.status === 401 && retryOnUnauthorized) {
        const restored = await restorePersistentSession({ allowLegacyUpgrade: false });
        if (restored) return apiFetch(url, options, false);
    }

    return response;
}

function renderGoogleButton() {
    const target = document.getElementById('googleButton');
    if (!target || target.childElementCount > 0 || !window.google?.accounts?.id) return;
    google.accounts.id.renderButton(target, {
        theme: 'outline',
        size: 'large',
        shape: 'pill',
        text: 'continue_with',
        width: 280
    });
}

function setupRecaptcha() {
    if (recaptchaReady || !auth) return;
    window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
        size: 'invisible',
        callback: () => undefined,
        'expired-callback': () => undefined
    });
    recaptchaReady = true;
}

function showLogin() {
    loginOverlay.style.display = 'flex';
    const inputSection = document.getElementById('phone-input-section');
    const otpSection = document.getElementById('otp-input-section');
    if (inputSection) inputSection.style.display = 'block';
    if (otpSection) otpSection.style.display = 'none';
    if (sendCodeBtn) {
        sendCodeBtn.disabled = false;
        sendCodeBtn.innerText = 'Send Login Code';
    }
    if (verifyCodeBtn) {
        verifyCodeBtn.disabled = false;
        verifyCodeBtn.innerText = 'Verify & Enter';
    }
    setupRecaptcha();
    renderGoogleButton();
}

async function enterApplication(loadHistory = true) {
    loginOverlay.style.display = 'none';
    applyStoredTheme();
    restoreDraft();
    if (loadHistory) await loadChatHistory();
}

async function initializeApplication() {
    try {
        const configResponse = await fetch(`${baseUrl}/api/config`, {
            credentials: 'same-origin',
            cache: 'no-store'
        });
        if (!configResponse.ok) throw new Error(`Configuration request failed (${configResponse.status})`);
        const configData = await configResponse.json();

        if (!firebase.apps.length) firebase.initializeApp(configData.firebaseConfig);
        auth = firebase.auth();
        try {
            await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        } catch (error) {
            console.warn('Firebase local persistence is unavailable in this browser:', error);
        }

        if (window.google?.accounts?.id && configData.googleClientId) {
            google.accounts.id.initialize({
                client_id: configData.googleClientId,
                callback: handleGoogleLogin,
                cancel_on_tap_outside: false
            });
        }

        const restored = await restorePersistentSession({ allowLegacyUpgrade: true });
        if (restored) await enterApplication(true);
        else showLogin();

        registerServiceWorker();
        bootCompleted = true;
    } catch (error) {
        console.error('Initialization error:', error);
        showLogin();
        alert('Monika AI could not connect to the server. Check your internet connection and deployment configuration.');
    }
}

window.addEventListener('load', initializeApplication);

if (showEmailBtn && showPhoneBtn) {
    showEmailBtn.onclick = () => {
        showEmailBtn.classList.add('active');
        showPhoneBtn.classList.remove('active');
        emailInputGroup.style.display = 'block';
        phoneInputGroup.style.display = 'none';
        document.getElementById('phoneInput').value = '';
    };
    showPhoneBtn.onclick = () => {
        showPhoneBtn.classList.add('active');
        showEmailBtn.classList.remove('active');
        phoneInputGroup.style.display = 'block';
        emailInputGroup.style.display = 'none';
        document.getElementById('emailInput').value = '';
    };
}

async function handleGoogleLogin(response) {
    try {
        const apiResponse = await fetch(`${baseUrl}/api/auth/google`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: response.credential })
        });
        const data = await parseJsonSafely(apiResponse);
        if (!apiResponse.ok) throw new Error(data.error || 'Google authentication failed.');
        await loginSuccess(data, `Google Auth Success. Welcome, ${data.name || 'back'}! 🌸`, data.name || '');
    } catch (error) {
        alert(error.message || 'Secure login failed.');
    }
}

const sendCodeBtn = document.getElementById('sendCodeBtn');
if (sendCodeBtn) {
    sendCodeBtn.onclick = async () => {
        const loginMode = showEmailBtn.classList.contains('active') ? 'email' : 'phone';
        const inputElement = document.getElementById(loginMode === 'email' ? 'emailInput' : 'phoneInput');
        const userInput = inputElement.value.trim();
        if (!userInput) return alert(`Please enter your ${loginMode}!`);

        if (loginMode === 'email' && !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(userInput)) {
            return alert('Please enter a valid email address.');
        }
        if (loginMode === 'phone' && !/^\+[1-9]\d{7,14}$/.test(userInput)) {
            return alert('Enter the phone number in international format, for example +919876543210.');
        }

        sendCodeBtn.disabled = true;
        sendCodeBtn.innerText = 'Processing...';

        try {
            if (loginMode === 'email') {
                const response = await fetch(`${baseUrl}/api/auth/send-otp`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: userInput })
                });
                const data = await parseJsonSafely(response);
                if (!response.ok) throw new Error(data.error || 'Unable to send login code.');
                showOtpSection();
            } else {
                setupRecaptcha();
                confirmationResult = await auth.signInWithPhoneNumber(userInput, window.recaptchaVerifier);
                showOtpSection();
            }
        } catch (error) {
            console.error('Login code request failed:', error);
            alert(error.message || 'Unable to send login code.');
            if (window.recaptchaVerifier) {
                try {
                    const widgetId = await window.recaptchaVerifier.render();
                    if (window.grecaptcha) grecaptcha.reset(widgetId);
                } catch (_) { /* Ignore recaptcha reset failure. */ }
            }
        } finally {
            if (document.getElementById('otp-input-section').style.display !== 'block') {
                sendCodeBtn.disabled = false;
                sendCodeBtn.innerText = 'Send Login Code';
            }
        }
    };
}

const verifyCodeBtn = document.getElementById('verifyCodeBtn');
if (verifyCodeBtn) {
    verifyCodeBtn.onclick = async () => {
        const loginMode = showEmailBtn.classList.contains('active') ? 'email' : 'phone';
        const userInput = document.getElementById(loginMode === 'email' ? 'emailInput' : 'phoneInput').value.trim();
        const code = document.getElementById('verificationCode').value.trim();
        if (!/^\d{6}$/.test(code)) return alert('Please enter the 6-digit code.');

        verifyCodeBtn.disabled = true;
        verifyCodeBtn.innerText = 'Verifying...';

        try {
            if (loginMode === 'email') {
                const response = await fetch(`${baseUrl}/api/auth/verify-otp`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: userInput, code })
                });
                const data = await parseJsonSafely(response);
                if (!response.ok) throw new Error(data.error || 'Invalid or expired code.');
                await loginSuccess(data, 'Email verified! Welcome back. 🌸');
            } else {
                if (!confirmationResult) throw new Error('Request a new SMS code first.');
                const result = await confirmationResult.confirm(code);
                const idToken = await result.user.getIdToken(true);
                const response = await fetch(`${baseUrl}/api/auth/firebase`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ idToken })
                });
                const data = await parseJsonSafely(response);
                if (!response.ok) throw new Error(data.error || 'Phone verification failed.');
                await loginSuccess(data, 'Phone verified! Welcome back. 🌸');
            }
        } catch (error) {
            alert(error.message || 'Verification failed.');
            verifyCodeBtn.disabled = false;
            verifyCodeBtn.innerText = 'Verify & Enter';
        }
    };
}

function showOtpSection() {
    document.getElementById('phone-input-section').style.display = 'none';
    document.getElementById('otp-input-section').style.display = 'block';
}

async function loginSuccess(data, welcomeMessage, name = '') {
    authToken = data.token;
    scheduleAccessTokenRefresh(data.expiresIn);
    clearLegacyAuthStorage();
    await enterApplication(true);
    addMessage(welcomeMessage, 'system', false);
    broadcastAuthEvent('login');

    try {
        await apiFetch(`${baseUrl}/api/auth/welcome`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
    } catch (error) {
        console.error('Welcome check failed:', error);
    }
}

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.onclick = async () => {
        logoutBtn.disabled = true;
        try {
            const response = await fetch(`${baseUrl}/api/auth/logout`, {
                method: 'POST',
                credentials: 'include',
                headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
            });
            if (!response.ok && response.status !== 204) {
                const data = await parseJsonSafely(response);
                throw new Error(data.error || 'Logout failed.');
            }
            if (auth?.currentUser) await auth.signOut();
            if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
            authToken = null;
            clearTimeout(refreshTimer);
            clearLegacyAuthStorage();
            broadcastAuthEvent('logout');
            location.reload();
        } catch (error) {
            alert(`${error.message || 'Logout failed.'} Please check your connection and try again.`);
            logoutBtn.disabled = false;
        }
    };
}

async function loadChatHistory() {
    try {
        const response = await apiFetch(`${baseUrl}/api/history`, { method: 'GET', cache: 'no-store' });
        if (response.status === 401) return handleSessionExpired();
        if (!response.ok) throw new Error(`History request failed (${response.status})`);
        const history = await response.json();

        if (Array.isArray(history) && history.length > 0) {
            chatMessages.innerHTML = '';
            for (const message of history) {
                const sender = message.role === 'user' ? 'user' : 'monika';
                const cleanText = String(message.text || '').replace(/\[.*?\]/g, '').trim();
                if (cleanText) await addMessage(cleanText, sender, false);
            }
            addMessage('Previous memories restored successfully. 🌸', 'system', false);
        }
    } catch (error) {
        console.error('History load error:', error);
        addMessage('Your session is active, but chat history could not be loaded. Check your connection and try again.', 'system', false);
    }
}

function handleSessionExpired() {
    authToken = null;
    clearTimeout(refreshTimer);
    showLogin();
}

document.addEventListener('DOMContentLoaded', () => {
    if (sendBtn) sendBtn.addEventListener('click', () => { if (!isMonikaBusy) sendMessage(false); });
    if (messageInput) {
        messageInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !isMonikaBusy) {
                event.preventDefault();
                sendMessage(false);
            }
        });
        messageInput.addEventListener('input', () => {
            localStorage.setItem('monika_message_draft', messageInput.value.slice(0, 2000));
        });
    }

    const phoneInput = document.getElementById('phoneInput');
    if (phoneInput) phoneInput.addEventListener('input', function () { this.value = this.value.replace(/[^\d+]/g, ''); });

    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey && event.key === '/') {
            event.preventDefault();
            if (camBtn) camBtn.click();
        }
    });
});

function restoreDraft() {
    if (!messageInput || messageInput.value) return;
    const draft = localStorage.getItem('monika_message_draft');
    if (draft) messageInput.value = draft;
}

async function addMessage(text, sender, typewrite = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;

    let prefix = '';
    if (sender === 'user') prefix = '<span style="font-weight:bold;">You:</span> ';
    else if (sender === 'monika') prefix = '<span style="color:#ff6b9d;font-weight:bold;">Monika:</span> ';
    else if (sender === 'system') prefix = '<span style="color:#ff6b9d;font-weight:bold;">System:</span> ';

    messageDiv.innerHTML = `<div class="message-content">${prefix}<span class="chat-text"></span></div>`;
    const textSpan = messageDiv.querySelector('.chat-text');
    chatMessages.appendChild(messageDiv);

    const typingEnabled = localStorage.getItem('monika_typing') !== 'false';
    if (typewrite && sender === 'monika' && typingEnabled) {
        await new Promise((resolve) => {
            let index = 0;
            const typeNext = () => {
                if (index < text.length) {
                    textSpan.textContent += text.charAt(index++);
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                    setTimeout(typeNext, 30);
                } else resolve();
            };
            typeNext();
        });
    } else {
        textSpan.textContent = text;
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

function showTypingIndicator() {
    const template = document.getElementById('typing-template');
    if (!template || document.querySelector('.typing-indicator')) return;
    chatMessages.appendChild(template.content.cloneNode(true));
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function hideTypingIndicator() {
    document.querySelector('.typing-indicator')?.remove();
}

const themes = {
    '/midnight': 'theme-midnight',
    '/rose': 'theme-rose',
    '/cyber': 'theme-cyber',
    '/matrix': 'theme-matrix',
    '/sunset': 'theme-sunset',
    '/yandere': 'theme-yandere',
    '/normal': ''
};

function applyTheme(command, persist = true) {
    document.body.classList.remove('theme-midnight', 'theme-rose', 'theme-cyber', 'theme-matrix', 'theme-sunset', 'theme-yandere');
    const className = themes[command] ?? '';
    if (className) document.body.classList.add(className);
    if (persist) localStorage.setItem('monika_theme', command);
    const select = document.getElementById('settingThemeSelect');
    if (select && themes[command] !== undefined) select.value = command;
}

function applyStoredTheme() {
    const storedTheme = localStorage.getItem('monika_theme') || '/normal';
    applyTheme(themes[storedTheme] !== undefined ? storedTheme : '/normal', false);
}

async function sendMessage(isVoiceChat = false) {
    let userInput = messageInput.value.trim();
    const themeCommand = userInput.toLowerCase();
    if (themes[themeCommand] !== undefined) {
        applyTheme(themeCommand, true);
        messageInput.value = '';
        localStorage.removeItem('monika_message_draft');
        addMessage(`[MODE]: System appearance updated to ${themeCommand.substring(1)}. ✨`, 'system', false);
        return;
    }

    if (!userInput && isVisionActive) userInput = 'What do you see right now?';
    if (!userInput || isMonikaBusy) return;
    if (!authToken) {
        const restored = await restorePersistentSession({ allowLegacyUpgrade: false });
        if (!restored) return handleSessionExpired();
    }

    isMonikaBusy = true;
    messageInput.disabled = true;
    sendBtn.disabled = true;
    addMessage(userInput, 'user', false);
    messageInput.value = '';
    localStorage.removeItem('monika_message_draft');
    showTypingIndicator();

    let imageBase64 = null;
    try {
        imageBase64 = isVisionActive ? await captureVisionFrame() : null;
    } catch (error) {
        console.error('Vision capture failed:', error);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    try {
        const response = await apiFetch(`${baseUrl}/ask`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question: userInput,
                imageBase64,
                personaOverride: localStorage.getItem('monika_persona') || 'tsundere',
                userName: localStorage.getItem('monika_user_name') || '',
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'
            }),
            signal: controller.signal
        });

        if (response.status === 401) return handleSessionExpired();
        const data = await parseJsonSafely(response);
        if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);

        hideTypingIndicator();
        const reply = data.reply || "I'm a bit confused... 💔";
        const cleanReply = reply.replace(/\[.*?\]/g, '').trim();
        const ttsEnabled = localStorage.getItem('monika_tts') !== 'false';
        if (isVoiceChat && ttsEnabled) monikaSpeak(reply);
        await addMessage(cleanReply, 'monika', true);
    } catch (error) {
        hideTypingIndicator();
        if (error.name === 'AbortError') addMessage('Request timed out. Monika is thinking hard... 💭', 'monika', false);
        else if (error instanceof TypeError) addMessage('Network connection issue. Please check your internet. 💔', 'monika', false);
        else addMessage(`Error: ${error.message}`, 'monika', false);
    } finally {
        clearTimeout(timeoutId);
        isMonikaBusy = false;
        messageInput.disabled = false;
        sendBtn.disabled = false;
        messageInput.focus();
    }
}

if (camBtn) {
    camBtn.onclick = async () => {
        isVisionActive = !isVisionActive;
        if (isVisionActive) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
                visionFeed.srcObject = stream;
                visionContainer.style.display = 'block';
                camBtn.classList.add('active');
                document.body.classList.add('camera-active');
            } catch (error) {
                alert('Camera access is required for Vision Mode.');
                isVisionActive = false;
            }
        } else stopVisionMode();
    };
}

function stopVisionMode() {
    if (visionFeed?.srcObject) visionFeed.srcObject.getTracks().forEach((track) => track.stop());
    if (visionFeed) visionFeed.srcObject = null;
    if (visionContainer) visionContainer.style.display = 'none';
    camBtn?.classList.remove('active');
    document.body.classList.remove('camera-active');
    isVisionActive = false;
}

async function captureVisionFrame() {
    if (!visionFeed?.srcObject || !visionFeed.videoWidth || !visionFeed.videoHeight) return null;
    const canvas = document.getElementById('capture-canvas');
    canvas.width = visionFeed.videoWidth;
    canvas.height = visionFeed.videoHeight;
    canvas.getContext('2d', { alpha: false }).drawImage(visionFeed, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
}

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;
if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.onstart = () => {
        isListening = true;
        micBtn?.classList.add('active');
        messageInput.placeholder = 'Listening...';
    };
    recognition.onresult = (event) => { messageInput.value = event.results[0][0].transcript; };
    recognition.onerror = (event) => console.error('Speech recognition error:', event.error);
    recognition.onend = () => {
        isListening = false;
        micBtn?.classList.remove('active');
        if (Date.now() - lastSpeechTime > 500 && messageInput.value && !isMonikaBusy) {
            lastSpeechTime = Date.now();
            sendMessage(true);
        }
        messageInput.placeholder = 'Type to Monika... 💕';
    };
}

if (micBtn) {
    micBtn.onclick = () => {
        if (!recognition) return alert('Voice recognition is not supported in this browser.');
        if (isMonikaBusy) return;
        if (isListening) recognition.stop();
        else {
            window.speechSynthesis.cancel();
            recognition.start();
        }
    };
}

function monikaSpeak(text) {
    window.speechSynthesis.cancel();
    globalUtterance.pitch = text.includes('[ANGRY]') ? 1.6 : text.includes('[SAD]') ? 1.1 : 1.3;
    globalUtterance.rate = text.includes('[ANGRY]') ? 1.35 : text.includes('[SAD]') ? 0.9 : 1.05;
    globalUtterance.text = text.replace(/\[.*?\]/g, '');
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
        globalUtterance.voice = voices.find((voice) => voice.name.includes('Female') || voice.name.includes('Google UK English Female')) || voices[0];
    }
    window.speechSynthesis.speak(globalUtterance);
}
window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();

if (pipBtn) {
    pipBtn.onclick = async () => {
        if (!window.documentPictureInPicture) return alert('Use a recent Chrome version for Pop-Out Window.');
        try {
            const pipWindow = await window.documentPictureInPicture.requestWindow({ width: 400, height: 600 });
            [...document.styleSheets].forEach((sheet) => {
                if (sheet.ownerNode) pipWindow.document.head.appendChild(sheet.ownerNode.cloneNode(true));
            });
            pipWindow.document.body.append(document.getElementById('chat-container'));
            pipWindow.addEventListener('pagehide', (event) => {
                const chatContainer = event.target.querySelector('#chat-container');
                if (chatContainer) document.getElementById('main-wrapper').append(chatContainer);
            });
        } catch (error) {
            console.error('Picture-in-Picture failed:', error);
        }
    };
}

document.addEventListener('DOMContentLoaded', () => {
    const settingsBtn = document.getElementById('settingsBtn');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const themeSelect = document.getElementById('settingThemeSelect');
    const saveNameBtn = document.getElementById('saveNameBtn');
    const wipeDataBtn = document.getElementById('wipeDataBtn');
    const personaSelect = document.getElementById('settingPersonaSelect');
    const typingToggle = document.getElementById('settingTypingToggle');
    const ttsToggle = document.getElementById('settingTtsToggle');

    if (settingsBtn) {
        settingsBtn.onclick = () => {
            document.getElementById('settingUserName').value = localStorage.getItem('monika_user_name') || '';
            if (personaSelect) personaSelect.value = localStorage.getItem('monika_persona') || 'tsundere';
            if (typingToggle) typingToggle.checked = localStorage.getItem('monika_typing') !== 'false';
            if (ttsToggle) ttsToggle.checked = localStorage.getItem('monika_tts') !== 'false';
            if (themeSelect) themeSelect.value = localStorage.getItem('monika_theme') || '/normal';
            settingsModal.style.display = 'flex';
        };
    }

    if (closeSettingsBtn) closeSettingsBtn.onclick = () => settingsModal.style.display = 'none';
    window.addEventListener('click', (event) => {
        if (event.target === settingsModal) settingsModal.style.display = 'none';
    });

    if (themeSelect) {
        themeSelect.onchange = (event) => {
            applyTheme(event.target.value, true);
            addMessage(`[MODE]: System appearance updated to ${event.target.value.substring(1)}. ✨`, 'system', false);
            settingsModal.style.display = 'none';
        };
    }

    if (saveNameBtn) {
        saveNameBtn.onclick = () => {
            const newName = document.getElementById('settingUserName').value.trim().slice(0, 30);
            if (newName) {
                localStorage.setItem('monika_user_name', newName);
                addMessage(`[SETTINGS]: Custom display name saved as "${newName}". 🌸`, 'system', false);
                settingsModal.style.display = 'none';
            }
        };
    }

    if (personaSelect) {
        personaSelect.onchange = (event) => {
            localStorage.setItem('monika_persona', event.target.value);
            addMessage("[SETTINGS]: Monika's personality parameters have been updated. 🌸", 'system', false);
        };
    }
    if (typingToggle) typingToggle.onchange = (event) => localStorage.setItem('monika_typing', String(event.target.checked));
    if (ttsToggle) ttsToggle.onchange = (event) => localStorage.setItem('monika_tts', String(event.target.checked));

    if (wipeDataBtn) {
        wipeDataBtn.onclick = async () => {
            const confirmed = confirm('🚨 WARNING: Delete your account, chat history, learned context, and all active sessions? This cannot be undone.');
            if (!confirmed) return;

            wipeDataBtn.disabled = true;
            try {
                const response = await apiFetch(`${baseUrl}/api/user/delete`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                const data = await parseJsonSafely(response);
                if (!response.ok) throw new Error(data.error || 'Account deletion failed.');
                if (auth?.currentUser) await auth.signOut();
                authToken = null;
                clearTimeout(refreshTimer);
                localStorage.clear();
                sessionStorage.clear();
                broadcastAuthEvent('logout');
                addMessage('[CRITICAL]: Purging data packets... Goodbye. 💔', 'system', false);
                setTimeout(() => location.reload(), 1200);
            } catch (error) {
                alert(error.message || 'Account deletion failed.');
                wipeDataBtn.disabled = false;
            }
        };
    }
});

window.addEventListener('online', () => {
    if (bootCompleted && authToken) restorePersistentSession({ allowLegacyUpgrade: false }).catch(() => undefined);
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

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.error('Service worker registration failed:', error);
    });
}
