// --- AI CONFIGURATION ---
const baseUrl = ""; 
let isVisionActive = false; 
let isMonikaBusy = false; 
let isListening = false; 
let lastSpeechTime = 0; 
let sessionId = localStorage.getItem('monika_session');

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
            google.accounts.id.renderButton(
                document.getElementById("googleButton"),
                { theme: "outline", size: "large", shape: "pill" }
            );
        } else {
            loginOverlay.style.display = 'none';
            loadChatHistory(sessionId);
        }
    } catch (error) {
        console.error("Auth config error:", error);
    }
};

function handleGoogleLogin(response) {
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    loginSuccess(payload.email, `Google Auth Success. Welcome, ${payload.given_name}! 🌸`);
}

function setupRecaptcha() {
    window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
        'size': 'invisible',
        'callback': (response) => { /* reCAPTCHA solved */ }
    });
}

if (document.getElementById('sendCodeBtn')) {
    document.getElementById('sendCodeBtn').onclick = async () => {
        const userInput = document.getElementById('phoneNumber').value.trim();
        if (!userInput) return alert("Please enter an email or phone number!");

        const btn = document.getElementById('sendCodeBtn');
        btn.disabled = true;
        btn.innerText = "Processing...";

        if (userInput.includes("@")) {
            try {
                const res = await fetch("/api/auth/send-otp", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: userInput })
                });
                if (res.ok) {
                    showOtpSection();
                } else {
                    alert("Email failed. Please check server logs.");
                    btn.disabled = false;
                    btn.innerText = "Send Login Code";
                }
            } catch (e) { alert("Server connection error."); }
        } else {
            const appVerifier = window.recaptchaVerifier;
            auth.signInWithPhoneNumber(userInput, appVerifier)
                .then((result) => {
                    confirmationResult = result;
                    showOtpSection();
                }).catch((error) => {
                    alert("SMS Error: " + error.message);
                    btn.disabled = false;
                    btn.innerText = "Send Login Code";
                    if (window.recaptchaVerifier) window.recaptchaVerifier.render().then(widgetId => grecaptcha.reset(widgetId));
                });
        }
    };
}

if (document.getElementById('verifyCodeBtn')) {
    document.getElementById('verifyCodeBtn').onclick = async () => {
        const userInput = document.getElementById('phoneNumber').value.trim();
        const code = document.getElementById('verificationCode').value.trim();
        if (!code || code.length !== 6) return alert("Please enter the 6-digit code.");

        const btn = document.getElementById('verifyCodeBtn');
        btn.disabled = true;
        btn.innerText = "Verifying...";

        if (userInput.includes("@")) {
            const res = await fetch("/api/auth/verify-otp", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: userInput, code })
            });
            if (res.ok) {
                loginSuccess(userInput, "Email verified! Welcome back. 🌸");
            } else {
                alert("Invalid or expired code.");
                btn.disabled = false;
                btn.innerText = "Verify & Enter";
            }
        } else {
            confirmationResult.confirm(code).then((result) => {
                loginSuccess(result.user.phoneNumber, "Phone verified! Welcome back. 🌸");
            }).catch((error) => {
                alert("Invalid SMS code.");
                btn.disabled = false;
                btn.innerText = "Verify & Enter";
            });
        }
    };
}

function showOtpSection() {
    document.getElementById('phone-input-section').style.display = 'none';
    document.getElementById('otp-input-section').style.display = 'block';
}

function loginSuccess(id, welcomeMsg) {
    sessionId = id;
    localStorage.setItem('monika_session', sessionId);
    loginOverlay.style.display = 'none';
    loadChatHistory(sessionId);
    addMessage(welcomeMsg, 'system', false);
}

if (document.getElementById('logoutBtn')) {
    document.getElementById('logoutBtn').onclick = () => {
        if (auth && auth.currentUser) {
            auth.signOut().then(() => {
                localStorage.removeItem('monika_session');
                location.reload(); 
            });
        } else {
            localStorage.removeItem('monika_session');
            location.reload(); 
        }
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
    // Pass false to indicate these are text inputs
    if (sendBtn) sendBtn.addEventListener('click', () => { if (!isMonikaBusy) sendMessage(false); });
    if (messageInput) messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !isMonikaBusy) sendMessage(false); });
});

// Upgraded addMessage with Typewriter Support & FIXED CSS class
async function addMessage(text, sender, typewrite = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    
    let prefix = "";
    if (sender === 'user') {
        prefix = '<span style="font-weight:bold;">You:</span> ';
    } else if (sender === 'monika') {
        prefix = '<span style="color:#ff6b9d; font-weight:bold;">Monika:</span> ';
    } else if (sender === 'system') {
        prefix = '<span style="color:#ff6b9d; font-weight:bold;">System:</span> ';
    }

    // Ensures the dark background box appears perfectly using "message-content"
    messageDiv.innerHTML = `<div class="message-content">${prefix}<span class="chat-text"></span></div>`;
    const textSpan = messageDiv.querySelector('.chat-text');
    
    chatMessages.appendChild(messageDiv);
    
    if (typewrite && sender === 'monika') {
        await new Promise(resolve => {
            let i = 0;
            function type() {
                if (i < text.length) {
                    textSpan.textContent += text.charAt(i);
                    i++;
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                    setTimeout(type, 30); // Typing speed in milliseconds
                } else {
                    resolve();
                }
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
    
    // --- MODE SWITCHER LOGIC ---
    const themes = {
        '/midnight': 'theme-midnight',
        '/rose': 'theme-rose',
        '/cyber': 'theme-cyber',
        '/normal': '' // Clears all themes
    };

    if (themes[userInput.toLowerCase()] !== undefined) {
        // Remove any existing themes first
        document.body.classList.remove('theme-midnight', 'theme-rose', 'theme-cyber');
        
        // Add the new theme if it's not '/normal'
        if (userInput.toLowerCase() !== '/normal') {
            document.body.classList.add(themes[userInput.toLowerCase()]);
        }
        
        messageInput.value = '';
        addMessage(`[MODE]: System appearance updated to ${userInput.substring(1)}. ✨`, 'system', false);
        return;
    }
    // ----------------------------

    if (!userInput && isVisionActive) userInput = "What do you see right now?";
    if (!userInput) return;

    isMonikaBusy = true;
    messageInput.disabled = true;
    sendBtn.disabled = true;

    addMessage(userInput, 'user', false);
    messageInput.value = '';
    showTypingIndicator();

    let imageBase64 = isVisionActive ? await captureVisionFrame() : null;

    try {
        const response = await fetch(`${baseUrl}/ask`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: userInput, imageBase64, sessionId: sessionId })
        });
        
        const data = await response.json();
        hideTypingIndicator();
        
        const reply = data.reply || "I'm a bit confused... 💔";
        const cleanReply = reply.replace(/\[.*?\]/g, "").trim();

        // 🧠 Voice vs Text Logic: Typewriter runs ALWAYS. 
        if (isVoiceChat) {
            // Spoken -> Speak aloud instantly alongside the typewriter effect
            monikaSpeak(reply); 
        }
        
        // Typewriter effect runs for BOTH text and voice input!
        await addMessage(cleanReply, 'monika', true);

    } catch (e) {
        hideTypingIndicator();
        addMessage("Connection lost... 💔", 'monika', false);
    } finally {
        isMonikaBusy = false;
        messageInput.disabled = false;
        sendBtn.disabled = false;
        messageInput.focus();
    }
}

// --- VISION & SPEECH SYSTEM ---
camBtn.onclick = async () => {
    isVisionActive = !isVisionActive;
    if (isVisionActive) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            visionFeed.srcObject = stream;
            visionContainer.style.display = 'block';
            camBtn.classList.add('active'); 
        } catch (e) { alert("Camera access needed!"); isVisionActive = false; }
    } else {
        if (visionFeed.srcObject) visionFeed.srcObject.getTracks().forEach(t => t.stop());
        visionContainer.style.display = 'none';
        camBtn.classList.remove('active');
    }
};

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
    recognition.onstart = () => { 
        isListening = true; 
        micBtn.classList.add('active'); 
        messageInput.placeholder = "Listening..."; 
    };
    recognition.onresult = (e) => { messageInput.value = e.results[0][0].transcript; };
    recognition.onend = () => {
        isListening = false; 
        micBtn.classList.remove('active');
        if (Date.now() - lastSpeechTime > 500 && messageInput.value && !isMonikaBusy) {
            lastSpeechTime = Date.now(); 
            sendMessage(true); // Triggers voice response
        }
        messageInput.placeholder = "Type to Monika... 💕";
    };
}

micBtn.onclick = () => {
    if (isMonikaBusy) return;
    if (isListening) recognition.stop();
    else { window.speechSynthesis.cancel(); recognition.start(); }
};

function monikaSpeak(text) {
    window.speechSynthesis.cancel();
    globalUtterance.pitch = text.includes("[ANGRY]") ? 1.6 : text.includes("[SAD]") ? 1.1 : 1.3;
    globalUtterance.rate = text.includes("[ANGRY]") ? 1.35 : text.includes("[SAD]") ? 0.9 : 1.05;
    globalUtterance.text = text.replace(/\[.*?\]/g, "");
    
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
        globalUtterance.voice = voices.find(v => v.name.includes("Female") || v.name.includes("Google UK English Female")) || voices[0];
    }
    
    window.speechSynthesis.speak(globalUtterance);
}
window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();

pipBtn.onclick = async () => {
    if (!window.documentPictureInPicture) return alert("Use Chrome for PiP!");
    const pipWindow = await window.documentPictureInPicture.requestWindow({ width: 400, height: 600 });
    [...document.styleSheets].forEach(s => pipWindow.document.head.appendChild(s.ownerNode.cloneNode(true)));
    pipWindow.document.body.append(document.getElementById('chat-container'));
    pipWindow.addEventListener("pagehide", e => document.getElementById('main-wrapper').append(e.target.querySelector('#chat-container')));
};
