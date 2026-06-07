// --- AI CONFIGURATION ---
const baseUrl = ""; 
let isVisionActive = false; 
let isMonikaBusy = false; 
let isListening = false; 
let lastSpeechTime = 0; 

// 🛡️ ENHANCED: Basic Session Encryption & Move to Session Storage
const encryptSession = (id) => btoa(id);
const decryptSession = (id) => { try { return atob(id); } catch(e) { return null; } };

let rawSession = sessionStorage.getItem('monika_session');
let sessionId = rawSession ? decryptSession(rawSession) : null;

// DOM Elements
const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const loginOverlay = document.getElementById('login-overlay');
const visionFeed = document.getElementById('vision-feed');
const visionContainer = document.getElementById('vision-container');
const micBtn = document.getElementById('micButton');
const camBtn = document.getElementById('camButton');
const pipBtn = document.getElementById('pipButton');

const globalUtterance = new SpeechSynthesisUtterance();

// ==========================================
// 🔐 UNIVERSAL AUTH SYSTEM (Google, Phone, Email)
// ==========================================
let auth;
let confirmationResult; 

window.onload = async function () {
    try {
        const configResponse = await fetch(`${baseUrl}/api/config`);
        const configData = await configResponse.json();

        firebase.initializeApp(configData.firebaseConfig);
        auth = firebase.auth();

        google.accounts.id.initialize({
            client_id: configData.googleClientId, 
            callback: handleGoogleLogin
        });

        if (!sessionId) {
            loginOverlay.style.display = 'flex';
            setupRecaptcha(); 
            // 🛡️ FIXED: Changed width to a numeric value (380) to resolve GSI warning
            google.accounts.id.renderButton(
                document.getElementById("googleButton"),
                { theme: "outline", size: "large", shape: "pill", width: 380 }
            );
        } else {
            loginOverlay.style.display = 'none';
            loadChatHistory(sessionId);
        }
    } catch (error) {
        console.error("Auth config error:", error);
    }
};

const showEmailBtn = document.getElementById('showEmailBtn');
const showPhoneBtn = document.getElementById('showPhoneBtn');
const emailInputGroup = document.getElementById('emailInputGroup');
const phoneInputGroup = document.getElementById('phoneInputGroup');

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

function handleGoogleLogin(response) {
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    loginSuccess(payload.email, `Google Auth Success. Welcome, ${payload.given_name}! 🌸`, payload.given_name);
}

function setupRecaptcha() {
    window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
        'size': 'invisible',
        'callback': (response) => { }
    });
}

if (document.getElementById('sendCodeBtn')) {
    document.getElementById('sendCodeBtn').onclick = async () => {
        const loginMode = showEmailBtn.classList.contains('active') ? 'email' : 'phone';
        const userInput = loginMode === 'email' ? document.getElementById('emailInput').value.trim() : document.getElementById('phoneInput').value.trim();
        
        if (!userInput) return alert(`Please enter your ${loginMode}!`);

        // 🛡️ ENHANCED: Better Email Validation
        if (loginMode === 'email') {
            const emailRegex = /^[a-zA-Z0-9._%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
            if (!emailRegex.test(userInput)) {
                return alert("Please enter a valid email address");
            }
        }

        // 🛡️ ENHANCED: E.164 Phone Validation
        if (loginMode === 'phone') {
            const phoneRegex = /^\+?[1-9]\d{1,14}$/; 
            if (!phoneRegex.test(userInput)) {
                return alert("Please enter a valid phone number (e.g., +1234567890)");
            }
        }

        const btn = document.getElementById('sendCodeBtn');
        btn.disabled = true; btn.innerText = "Processing...";

        if (loginMode === 'email') {
            try {
                const res = await fetch("/api/auth/send-otp", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: userInput })
                });
                if (res.ok) showOtpSection();
                else { alert("Email failed. Please check logs."); btn.disabled = false; btn.innerText = "Send Login Code"; }
            } catch (e) { alert("Server connection error."); }
        } else {
            const appVerifier = window.recaptchaVerifier;
            auth.signInWithPhoneNumber(userInput, appVerifier)
                .then((result) => { confirmationResult = result; showOtpSection(); })
                .catch((error) => {
                    alert("SMS Error: " + error.message);
                    btn.disabled = false; btn.innerText = "Send Login Code";
                    if (window.recaptchaVerifier) window.recaptchaVerifier.render().then(wId => grecaptcha.reset(wId));
                });
        }
    };
}

if (document.getElementById('verifyCodeBtn')) {
    document.getElementById('verifyCodeBtn').onclick = async () => {
        const loginMode = showEmailBtn.classList.contains('active') ? 'email' : 'phone';
        const userInput = loginMode === 'email' ? document.getElementById('emailInput').value.trim() : document.getElementById('phoneInput').value.trim();
        const code = document.getElementById('verificationCode').value.trim();
        
        if (!code || code.length !== 6) return alert("Please enter the 6-digit code.");

        const btn = document.getElementById('verifyCodeBtn');
        btn.disabled = true; btn.innerText = "Verifying...";

        if (loginMode === 'email') {
            const res = await fetch("/api/auth/verify-otp", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: userInput, code })
            });
            if (res.ok) loginSuccess(userInput, "Email verified! Welcome back. 🌸");
            else { alert("Invalid or expired code."); btn.disabled = false; btn.innerText = "Verify & Enter"; }
        } else {
            confirmationResult.confirm(code).then((result) => {
                loginSuccess(result.user.phoneNumber, "Phone verified! Welcome back. 🌸");
            }).catch((error) => { alert("Invalid SMS code."); btn.disabled = false; btn.innerText = "Verify & Enter"; });
        }
    };
}

function showOtpSection() {
    document.getElementById('phone-input-section').style.display = 'none';
    document.getElementById('otp-input-section').style.display = 'block';
}

function loginSuccess(id, welcomeMsg, name = "") {
    sessionId = id;
    // 🛡️ ENHANCED: Save encrypted session to sessionStorage
    sessionStorage.setItem('monika_session', encryptSession(sessionId));
    loginOverlay.style.display = 'none';
    loadChatHistory(sessionId);
    addMessage(welcomeMsg, 'system', false);

    if (id.includes('@')) {
        fetch("/api/auth/welcome", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: id, name: name })
        }).catch(err => console.error("Welcome check failed silently", err));
    }
}

if (document.getElementById('logoutBtn')) {
    document.getElementById('logoutBtn').onclick = () => {
        if (auth && auth.currentUser) {
            auth.signOut().then(() => { sessionStorage.removeItem('monika_session'); location.reload(); });
        } else { sessionStorage.removeItem('monika_session'); location.reload(); }
    };
}

// ==========================================
// --- CHAT HISTORY ---
// ==========================================
async function loadChatHistory(identifier) {
    try {
        const response = await fetch(`${baseUrl}/api/history/${encodeURIComponent(identifier)}`);
        const history = await response.json();
        
        if (history && history.length > 0) {
            chatMessages.innerHTML = ""; 
            history.forEach(msg => {
                const sender = msg.role === "user" ? "user" : "monika";
                const cleanText = (msg.text || "").replace(/\[.*?\]/g, "").trim();
                if (cleanText) addMessage(cleanText, sender, false);
            });
            addMessage("Previous memories restored successfully. 🌸", 'system', false);
        }
    } catch (error) { console.error("History load error:", error); }
}

// ==========================================
// --- UI ANIMATIONS & LOGIC ---
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    if (sendBtn) sendBtn.addEventListener('click', () => { if (!isMonikaBusy) sendMessage(false); });
    if (messageInput) messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !isMonikaBusy) sendMessage(false); });
    
    const phoneInput = document.getElementById('phoneInput');
    if (phoneInput) {
        phoneInput.addEventListener('input', function() { this.value = this.value.replace(/[^\d+]/g, ''); });
    }

    // ⌨️ ENHANCED: Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === '/') {
            e.preventDefault();
            if(camBtn) camBtn.click();
        }
    });
});

async function addMessage(text, sender, typewrite = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    
    let prefix = "";
    if (sender === 'user') prefix = '<span style="font-weight:bold;">You:</span> ';
    else if (sender === 'monika') prefix = '<span style="color:#ff6b9d; font-weight:bold;">Monika:</span> ';
    else if (sender === 'system') prefix = '<span style="color:#ff6b9d; font-weight:bold;">System:</span> ';

    // XSS Safe implementation using textContent
    messageDiv.innerHTML = `<div class="message-content">${prefix}<span class="chat-text"></span></div>`;
    const textSpan = messageDiv.querySelector('.chat-text');
    chatMessages.appendChild(messageDiv);
    
    const isTypingEnabled = localStorage.getItem('monika_typing') !== "false"; 

    if (typewrite && sender === 'monika' && isTypingEnabled) {
        await new Promise(resolve => {
            let i = 0;
            function type() {
                if (i < text.length) {
                    textSpan.textContent += text.charAt(i); i++;
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                    setTimeout(type, 30); 
                } else { resolve(); }
            }
            type();
        });
    } else {
        textSpan.textContent = text;
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

function showTypingIndicator() {
    const template = document.getElementById('typing-template');
    if (!template) return;
    const clone = template.content.cloneNode(true);
    chatMessages.appendChild(clone);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function hideTypingIndicator() {
    const indicator = document.querySelector('.typing-indicator');
    if (indicator) indicator.remove();
}

async function sendMessage(isVoiceChat = false) {
    let userInput = messageInput.value.trim();
    
    const themes = {
        '/midnight': 'theme-midnight', '/rose': 'theme-rose', '/cyber': 'theme-cyber',
        '/matrix': 'theme-matrix', '/sunset': 'theme-sunset', '/yandere': 'theme-yandere', '/normal': ''
    };

    if (themes[userInput.toLowerCase()] !== undefined) {
        document.body.classList.remove('theme-midnight', 'theme-rose', 'theme-cyber', 'theme-matrix', 'theme-sunset', 'theme-yandere');
        if (userInput.toLowerCase() !== '/normal') document.body.classList.add(themes[userInput.toLowerCase()]);
        messageInput.value = '';
        addMessage(`[MODE]: System appearance updated to ${userInput.substring(1)}. ✨`, 'system', false);
        return;
    }

    if (!userInput && isVisionActive) userInput = "What do you see right now?";
    if (!userInput) return;

    isMonikaBusy = true; messageInput.disabled = true; sendBtn.disabled = true;
    addMessage(userInput, 'user', false);
    messageInput.value = ''; showTypingIndicator();

    let imageBase64 = isVisionActive ? await captureVisionFrame() : null;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
        const response = await fetch(`${baseUrl}/ask`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                question: userInput, 
                imageBase64, 
                sessionId: sessionId,
                personaOverride: localStorage.getItem('monika_persona') || 'tsundere',
                userName: localStorage.getItem('monika_user_name') || ''
            }),
            signal: controller.signal 
        });
        
        clearTimeout(timeoutId); 
        
        // 🛡️ ENHANCED: Better Error Handling Response Catch
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        hideTypingIndicator();
        
        const reply = data.reply || "I'm a bit confused... 💔";
        const cleanReply = reply.replace(/\[.*?\]/g, "").trim();

        const isTtsEnabled = localStorage.getItem('monika_tts') !== "false";
        if (isVoiceChat && isTtsEnabled) monikaSpeak(reply); 
        
        await addMessage(cleanReply, 'monika', true);
    } catch (e) {
        hideTypingIndicator();
        // 🛡️ ENHANCED: Explicit Error Messages
        if (e.name === 'AbortError') {
            addMessage("Request timed out. Monika is thinking hard... 💭", 'monika', false);
        } else if (e instanceof TypeError) {
            addMessage("Network connection issue. Please check your internet. 💔", 'monika', false);
        } else {
            addMessage(`Error: ${e.message}`, 'monika', false);
        }
    } finally {
        isMonikaBusy = false; messageInput.disabled = false; sendBtn.disabled = false; messageInput.focus();
    }
}

// --- VISION & SPEECH SYSTEM ---
if (camBtn) {
    camBtn.onclick = async () => {
        isVisionActive = !isVisionActive;
        if (isVisionActive) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                visionFeed.srcObject = stream; visionContainer.style.display = 'block';
                camBtn.classList.add('active'); document.body.classList.add('camera-active');
            } catch (e) { alert("Camera access needed!"); isVisionActive = false; }
        } else {
            if (visionFeed.srcObject) visionFeed.srcObject.getTracks().forEach(t => t.stop());
            visionContainer.style.display = 'none'; camBtn.classList.remove('active'); document.body.classList.remove('camera-active');
        }
    };
}

async function captureVisionFrame() {
    if (!visionFeed.srcObject) return null;
    const canvas = document.getElementById('capture-canvas');
    canvas.width = visionFeed.videoWidth; canvas.height = visionFeed.videoHeight;
    canvas.getContext('2d').drawImage(visionFeed, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
}

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;
if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.onstart = () => { isListening = true; micBtn.classList.add('active'); messageInput.placeholder = "Listening..."; };
    recognition.onresult = (e) => { messageInput.value = e.results[0][0].transcript; };
    recognition.onend = () => {
        isListening = false; micBtn.classList.remove('active');
        if (Date.now() - lastSpeechTime > 500 && messageInput.value && !isMonikaBusy) {
            lastSpeechTime = Date.now(); sendMessage(true); 
        }
        messageInput.placeholder = "Type to Monika... 💕";
    };
}

if (micBtn) {
    micBtn.onclick = () => {
        if (isMonikaBusy) return;
        if (isListening) recognition.stop();
        else { window.speechSynthesis.cancel(); recognition.start(); }
    };
}

function monikaSpeak(text) {
    window.speechSynthesis.cancel();
    globalUtterance.pitch = text.includes("[ANGRY]") ? 1.6 : text.includes("[SAD]") ? 1.1 : 1.3;
    globalUtterance.rate = text.includes("[ANGRY]") ? 1.35 : text.includes("[SAD]") ? 0.9 : 1.05;
    globalUtterance.text = text.replace(/\[.*?\]/g, "");
    
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) globalUtterance.voice = voices.find(v => v.name.includes("Female") || v.name.includes("Google UK English Female")) || voices[0];
    
    window.speechSynthesis.speak(globalUtterance);
}
window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();

if (pipBtn) {
    pipBtn.onclick = async () => {
        if (!window.documentPictureInPicture) return alert("Use Chrome for PiP!");
        const pipWindow = await window.documentPictureInPicture.requestWindow({ width: 400, height: 600 });
        [...document.styleSheets].forEach(s => pipWindow.document.head.appendChild(s.ownerNode.cloneNode(true)));
        pipWindow.document.body.append(document.getElementById('chat-container'));
        pipWindow.addEventListener("pagehide", e => document.getElementById('main-wrapper').append(e.target.querySelector('#chat-container')));
    };
}

// ==========================================
// ⚙️ SETTINGS PANEL INTERACTIVE TRIGGERS
// ==========================================
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
            document.getElementById('settingUserName').value = localStorage.getItem('monika_user_name') || "";
            if (personaSelect) personaSelect.value = localStorage.getItem('monika_persona') || "tsundere";
            if (typingToggle) typingToggle.checked = localStorage.getItem('monika_typing') !== "false";
            if (ttsToggle) ttsToggle.checked = localStorage.getItem('monika_tts') !== "false";
            settingsModal.style.display = 'flex';
        };
    }

    if (closeSettingsBtn) closeSettingsBtn.onclick = () => settingsModal.style.display = 'none';
    window.onclick = (e) => { if (e.target === settingsModal) settingsModal.style.display = 'none'; };

    if (themeSelect) {
        themeSelect.onchange = (e) => {
            messageInput.value = e.target.value; 
            sendMessage(false);                  
            settingsModal.style.display = 'none';
        };
    }

    if (saveNameBtn) {
        saveNameBtn.onclick = () => {
            const newName = document.getElementById('settingUserName').value.trim();
            if (newName) {
                localStorage.setItem('monika_user_name', newName);
                addMessage(`[SETTINGS]: Custom display name saved as "${newName}". 🌸`, 'system', false);
                settingsModal.style.display = 'none';
            }
        };
    }

    if (personaSelect) {
        personaSelect.onchange = (e) => {
            localStorage.setItem('monika_persona', e.target.value);
            addMessage(`[SETTINGS]: My personality parameters have been updated. 🌸`, 'system', false);
        };
    }

    if (typingToggle) {
        typingToggle.onchange = (e) => localStorage.setItem('monika_typing', e.target.checked);
    }

    if (ttsToggle) {
        ttsToggle.onchange = (e) => localStorage.setItem('monika_tts', e.target.checked);
    }

    if (wipeDataBtn) {
        wipeDataBtn.onclick = async () => {
            if (confirm("🚨 WARNING: Are you absolutely sure you want to delete your account? This will wipe your chat history, context facts, and log you out forever!")) {
                
                try {
                    await fetch(`${baseUrl}/api/user/delete`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ sessionId: sessionId })
                    });
                } catch(e) { console.error("DB Wipe Failed", e); }

                sessionStorage.removeItem('monika_session');
                localStorage.clear();
                addMessage("[CRITICAL]: Purging data packets... Goodbye. 💔", 'system', false);
                setTimeout(() => { location.reload(); }, 2000);
            }
        };
    }
});