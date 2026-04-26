// --- AI CONFIGURATION ---
const baseUrl = ""; 
let isVisionActive = false; 
let isMonikaBusy = false; 
let isListening = false; 
let lastSpeechTime = 0; 
let sessionId = localStorage.getItem('monika_session');

// DOM Elements
const loader = document.querySelector('.loader');
const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const quickBtns = document.querySelectorAll('.action-btn');
const floatingHeartsContainer = document.querySelector('.floating-hearts');
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

        // 1. Initialize Firebase (For Phone Login)
        firebase.initializeApp(configData.firebaseConfig);
        auth = firebase.auth();

        // 2. Initialize Google Login
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

// --- OPTION A: GOOGLE LOGIN ---
function handleGoogleLogin(response) {
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    loginSuccess(payload.email, `Google Auth Success. Welcome, ${payload.given_name}! 🌸`);
}

// --- OPTION B & C: PHONE AND EMAIL LOGIC ---
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
            // FLOW: EMAIL OTP 
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
            // FLOW: FIREBASE PHONE SMS
            const appVerifier = window.recaptchaVerifier;
            auth.signInWithPhoneNumber(userInput, appVerifier)
                .then((result) => {
                    confirmationResult = result;
                    showOtpSection();
                }).catch((error) => {
                    console.error("SMS Error:", error);
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
            // VERIFY EMAIL
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
            // VERIFY PHONE
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

// HELPERS
function showOtpSection() {
    document.getElementById('phone-input-section').style.display = 'none';
    document.getElementById('otp-input-section').style.display = 'block';
}

function loginSuccess(id, welcomeMsg) {
    sessionId = id;
    localStorage.setItem('monika_session', sessionId);
    loginOverlay.style.display = 'none';
    loadChatHistory(sessionId);
    addMessage(welcomeMsg, 'system');
}

// --- LOGOUT ROUTING ---
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
    setTimeout(() => {
        if (loader) loader.style.opacity = '0';
        setTimeout(() => {
            if (loader) loader.style.display = 'none';
            initAnimations();
        }, 500);
    }, 1500);

    sendBtn.addEventListener('click', () => { if (!isMonikaBusy) sendMessage(); });
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !isMonikaBusy) sendMessage();
    });
    
    quickBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (isMonikaBusy) return;
            messageInput.value = btn.textContent;
            sendMessage();
        });
    });

    setupEasterEggs();
    createParticles();
    createFloatingHearts();
});

function addMessage(text, sender, animate = true) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    
    // The CSS will automatically hide the .avatar div to match your sleek theme
    if (sender === 'user') {
        messageDiv.innerHTML = `
            <div class="avatar"><div class="user-avatar"><i class="fas fa-user"></i></div></div>
            <div class="message-content"><p>${text}</p></div>
        `;
    } else if (sender === 'system') {
        messageDiv.innerHTML = `<div class="message-content"><p>${text}</p></div>`;
    } else {
        messageDiv.innerHTML = `
            <div class="avatar monika-avatar-small"><div style="width:40px; height:40px; border-radius:50%; background:#ff6b9d; display:flex; align-items:center; justify-content:center; color:white;">🌸</div></div>
            <div class="message-content"><p class="msg-text">${text}</p></div>
        `;
    }
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    if (animate) {
        requestAnimationFrame(() => {
            messageDiv.style.opacity = '1';
            messageDiv.style.transform = 'translateY(0)';
            messageDiv.style.animation = 'messageSlide 0.5s ease-out forwards';
        });
    } else {
        messageDiv.style.opacity = '1';
        messageDiv.style.transform = 'translateY(0)';
    }
    return messageDiv;
}

function showTypingIndicator() {
    const template = document.getElementById('typing-template');
    if (!template) return;
    const clone = template.content.cloneNode(true);
    chatMessages.appendChild(clone);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    const typingText = chatMessages.lastElementChild.querySelector('.typing-text');
    let dotIndex = 0;
    const typingWords = ["thinking...", "listening...", "...", "💕"];
    chatMessages.lastElementChild.dataset.intervalId = setInterval(() => {
        if(typingText) typingText.textContent = `Monika is ${typingWords[dotIndex]}`;
        dotIndex = (dotIndex + 1) % typingWords.length;
    }, 400);
}

function hideTypingIndicator() {
    const indicator = document.querySelector('.typing-indicator');
    if (indicator) {
        clearInterval(indicator.dataset.intervalId);
        indicator.remove();
    }
}

async function sendMessage() {
    let userInput = messageInput.value.trim();
    if (!userInput && isVisionActive) userInput = "What do you see right now?";
    if (!userInput) return;

    isMonikaBusy = true;
    messageInput.disabled = true;
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i class="fas fa-heart"></i>';

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
        const cleanReply = reply.replace(/\[.*?\]/g, "").trim();

        if (data.action) {
            document.body.className = data.action === 'default' ? '' : `theme-${data.action}`;
            localStorage.setItem('monika_theme', data.action); 
        }

        addMessage(cleanReply, 'monika');
        monikaSpeak(reply); 
        
        createHeartBurst();
        playSparkleEffect();

    } catch (e) {
        hideTypingIndicator();
        addMessage("Connection lost... 💔", 'monika');
    } finally {
        isMonikaBusy = false;
        messageInput.disabled = false;
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
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
            camBtn.style.background = '#ff6b9d';
        } catch (e) { alert("Camera access needed!"); isVisionActive = false; }
    } else {
        if (visionFeed.srcObject) visionFeed.srcObject.getTracks().forEach(t => t.stop());
        visionContainer.style.display = 'none';
        camBtn.style.background = 'rgba(255,255,255,0.1)';
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
    recognition.onstart = () => { isListening = true; micBtn.style.background = '#ff6b9d'; messageInput.placeholder = "Listening..."; };
    recognition.onresult = (e) => { messageInput.value = e.results[0][0].transcript; };
    recognition.onend = () => {
        isListening = false; micBtn.style.background = 'rgba(255,255,255,0.1)';
        if (Date.now() - lastSpeechTime > 500 && messageInput.value && !isMonikaBusy) {
            lastSpeechTime = Date.now(); sendMessage();
        }
        messageInput.placeholder = "Type your message here... 💭";
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

// --- VISUAL EFFECTS FUNCTIONS ---
function createParticles() {
    setInterval(() => {
        if (Math.random() > 0.7) {
            const p = document.createElement('div'); p.className = 'particle';
            p.style.left = Math.random() * 100 + '%';
            p.style.animationDuration = (Math.random() * 3 + 3) + 's';
            document.querySelector('.particles').appendChild(p);
            setTimeout(() => p.remove(), 8000);
        }
    }, 300);
}
function createFloatingHearts() { setInterval(() => { if (Math.random() > 0.8) createHeart(); }, 4000); }
function createHeart() {
    const h = document.createElement('div'); h.className = 'heart';
    h.innerHTML = ['💖', '💕', '💗', '🌸', '✨'][Math.floor(Math.random() * 5)];
    h.style.left = Math.random() * 100 + '%'; h.style.animationDuration = (Math.random() * 3 + 4) + 's';
    h.style.fontSize = (Math.random() * 0.8 + 1) + 'rem';
    floatingHeartsContainer.appendChild(h); setTimeout(() => h.remove(), 7000);
}
function createHeartBurst() { for (let i = 0; i < 8; i++) setTimeout(() => createHeart(), i * 200); }
function playSparkleEffect() {
    for (let i = 0; i < 12; i++) {
        setTimeout(() => {
            const s = document.createElement('div');
            s.style.cssText = `position:fixed; width:6px; height:6px; background:#ffd93d; border-radius:50%; left:${Math.random()*100}vw; top:${Math.random()*100}vh; pointer-events:none; z-index:100; animation:sparkle 1s ease-out forwards;`;
            document.body.appendChild(s); setTimeout(() => s.remove(), 1000);
        }, i * 100);
    }
}
function initAnimations() {
    const obs = new IntersectionObserver((entries) => {
        entries.forEach(e => { if (e.isIntersecting) { e.target.style.opacity = '1'; e.target.style.transform = 'translateY(0)'; }});
    });
    document.querySelectorAll('.message, .header, .chat-container').forEach(el => {
        el.style.opacity = '0'; el.style.transform = 'translateY(30px)'; el.style.transition = 'all 0.8s ease-out'; obs.observe(el);
    });
}
function setupEasterEggs() {
    let code = []; const konami = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65];
    document.addEventListener('keydown', (e) => {
        code.push(e.keyCode); if (code.length > konami.length) code.shift();
        if (code.toString() === konami.toString()) {
            document.documentElement.style.setProperty('--rainbow-mode', 'true');
            addMessage("🌈🎉 KONAMI CODE DETECTED! Rainbow mode! 💖", 'system');
            setTimeout(() => document.documentElement.style.setProperty('--rainbow-mode', 'false'), 10000);
            code = [];
        }
    });
}

chatMessages.addEventListener('scroll', () => { chatMessages.style.scrollBehavior = 'smooth'; });
