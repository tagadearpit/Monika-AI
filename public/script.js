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
const quickBtns = document.querySelectorAll('.action-btn');
const loginOverlay = document.getElementById('login-overlay');
const visionFeed = document.getElementById('vision-feed');
const visionContainer = document.getElementById('vision-container');
const micBtn = document.getElementById('micButton');
const camBtn = document.getElementById('camButton');
const pipBtn = document.getElementById('pipButton');

const globalUtterance = new SpeechSynthesisUtterance();

// ==========================================
// 🔐 UNIVERSAL AUTH SYSTEM
// ==========================================
let auth;
let confirmationResult; 

window.onload = async function () {
    try {
        const configResponse = await fetch(`${baseUrl}/api/config`);
        const configData = await configResponse.json();

        firebase.initializeApp(configData.firebaseConfig);
        auth = firebase.auth();
        setupRecaptcha();

        google.accounts.id.initialize({
            client_id: configData.googleClientId, 
            callback: handleGoogleLogin
        });

        if (!sessionId) {
            loginOverlay.style.display = 'flex';
            google.accounts.id.renderButton(
                document.getElementById("googleButton"),
                { theme: "filled_black", size: "large", shape: "pill" }
            );
        } else {
            loginOverlay.style.display = 'none';
            loadChatHistory(sessionId);
        }
    } catch (error) { console.error("Auth config error:", error); }
};

function handleGoogleLogin(response) {
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    loginSuccess(payload.email, `Google Auth Success. Welcome, ${payload.given_name}! 🌸`);
}

function setupRecaptcha() {
    window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', { 'size': 'invisible' });
}

document.getElementById('sendCodeBtn').onclick = async () => {
    const val = document.getElementById('phoneNumber').value.trim();
    if (!val) return alert("Enter an email or phone number!");
    const btn = document.getElementById('sendCodeBtn');
    btn.disabled = true; btn.innerText = "Processing...";

    if (val.includes("@")) {
        const res = await fetch("/api/auth/send-otp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: val })
        });
        if (res.ok) showOtpSection();
        else { alert("Email failed. Check SMTP!"); btn.disabled = false; btn.innerText = "Send Login Code"; }
    } else {
        auth.signInWithPhoneNumber(val, window.recaptchaVerifier).then((result) => {
            confirmationResult = result; showOtpSection();
        }).catch((err) => { alert(err.message); btn.disabled = false; btn.innerText = "Send Login Code"; });
    }
};

document.getElementById('verifyCodeBtn').onclick = async () => {
    const val = document.getElementById('phoneNumber').value.trim();
    const code = document.getElementById('verificationCode').value.trim();
    if (val.includes("@")) {
        const res = await fetch("/api/auth/verify-otp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: val, code })
        });
        if (res.ok) loginSuccess(val, "Email Verified! 🌸");
        else alert("Invalid Code!");
    } else {
        confirmationResult.confirm(code).then(() => loginSuccess(val, "Phone Verified! 🌸")).catch(() => alert("Invalid SMS Code!"));
    }
};

function showOtpSection() {
    document.getElementById('phone-input-section').style.display = 'none';
    document.getElementById('otp-input-section').style.display = 'block';
}

function loginSuccess(id, msg) {
    sessionId = id;
    localStorage.setItem('monika_session', sessionId);
    loginOverlay.style.display = 'none';
    loadChatHistory(sessionId);
    addMessage(msg, 'system');
}

// ==========================================
// --- AI & CHAT LOGIC ---
// ==========================================
async function sendMessage() {
    let userInput = messageInput.value.trim();
    if (!userInput && isVisionActive) userInput = "What do you see right now?";
    if (!userInput) return;

    isMonikaBusy = true;
    messageInput.disabled = true;
    sendBtn.disabled = true;

    addMessage(userInput, 'user');
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
        
        // Remove tags so text reads smoothly in UI
        const cleanReply = reply.replace(/\[.*?\]/g, "").trim();

        addMessage(cleanReply, 'monika');
        monikaSpeak(reply); 

    } catch (e) {
        hideTypingIndicator();
        addMessage("Connection lost... 💔", 'monika');
    } finally {
        isMonikaBusy = false;
        messageInput.disabled = false;
        sendBtn.disabled = false;
        messageInput.focus();
    }
}

// ==========================================
// --- UI & MESSAGING ENGINE (BUBBLE DESIGN) ---
// ==========================================
function addMessage(text, sender) {
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

    messageDiv.innerHTML = `<div class="msg-bubble">${prefix}${text}</div>`;
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
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

// --- HARDWARE & BUTTON LISTENERS ---
document.addEventListener('DOMContentLoaded', () => {
    sendBtn.addEventListener('click', () => { if (!isMonikaBusy) sendMessage(); });
    messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !isMonikaBusy) sendMessage(); });
    quickBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (isMonikaBusy) return;
            messageInput.value = btn.textContent;
            sendMessage();
        });
    });
});

async function loadChatHistory(id) {
    const res = await fetch(`${baseUrl}/api/history/${encodeURIComponent(id)}`);
    const history = await res.json();
    if (history.length > 0) {
        chatMessages.innerHTML = "";
        history.forEach(msg => {
            const cleanText = (msg.text || "").replace(/\[.*?\]/g, "").trim();
            if (cleanText) addMessage(cleanText, msg.role === "user" ? "user" : "monika");
        });
        addMessage("Previous chat memory restored successfully. 🌸", "system");
    }
}

document.getElementById('logoutBtn').onclick = () => { localStorage.removeItem('monika_session'); location.reload(); };

// Vision Logic
camBtn.onclick = async () => {
    isVisionActive = !isVisionActive;
    if (isVisionActive) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            visionFeed.srcObject = stream;
            visionContainer.style.display = 'block';
            camBtn.style.color = '#ff1493';
        } catch (e) { alert("Camera access needed!"); isVisionActive = false; }
    } else {
        if (visionFeed.srcObject) visionFeed.srcObject.getTracks().forEach(t => t.stop());
        visionContainer.style.display = 'none';
        camBtn.style.color = 'rgba(255,255,255,0.4)';
    }
};

async function captureVisionFrame() {
    if (!visionFeed.srcObject) return null;
    const canvas = document.getElementById('capture-canvas');
    canvas.width = visionFeed.videoWidth; canvas.height = visionFeed.videoHeight;
    canvas.getContext('2d').drawImage(visionFeed, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
}

// Voice Logic
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;
if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.onstart = () => { isListening = true; micBtn.style.color = '#ff1493'; messageInput.placeholder = "Listening..."; };
    recognition.onresult = (e) => { messageInput.value = e.results[0][0].transcript; };
    recognition.onend = () => {
        isListening = false; micBtn.style.color = 'rgba(255,255,255,0.4)';
        if (Date.now() - lastSpeechTime > 500 && messageInput.value && !isMonikaBusy) {
            lastSpeechTime = Date.now(); sendMessage();
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
    globalUtterance.text = text.replace(/\[.*?\]/g, "");
    globalUtterance.pitch = 1.3;
    globalUtterance.rate = 1.05;
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
        globalUtterance.voice = voices.find(v => v.name.includes("Female") || v.name.includes("Google UK English Female")) || voices[0];
    }
    window.speechSynthesis.speak(globalUtterance);
}

pipBtn.onclick = async () => {
    if (!window.documentPictureInPicture) return alert("Use Chrome for PiP!");
    const pipWindow = await window.documentPictureInPicture.requestWindow({ width: 400, height: 600 });
    [...document.styleSheets].forEach(s => pipWindow.document.head.appendChild(s.ownerNode.cloneNode(true)));
    pipWindow.document.body.append(document.querySelector('.app-container'));
    pipWindow.addEventListener("pagehide", () => location.reload());
};
