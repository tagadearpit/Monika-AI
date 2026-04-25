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
// 🔐 DUAL AUTHENTICATION SYSTEM 
// ==========================================
let auth;
let confirmationResult; 

window.onload = async function () {
    try {
        // Fetch keys from backend
        const configResponse = await fetch(`${baseUrl}/api/config`);
        const configData = await configResponse.json();

        // 1. Initialize Firebase
        firebase.initializeApp(configData.firebaseConfig);
        auth = firebase.auth();

        // 2. Initialize Google Login
        google.accounts.id.initialize({
            client_id: configData.googleClientId, 
            callback: handleGoogleLogin
        });

        if (!sessionId) {
            loginOverlay.style.display = 'flex';
            setupRecaptcha(); // For SMS protection
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

// --- OPTION A: GOOGLE LOGIN FLOW ---
function handleGoogleLogin(response) {
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    sessionId = payload.email; 
    localStorage.setItem('monika_session', sessionId);
    loginOverlay.style.display = 'none';
    loadChatHistory(sessionId);
    addMessage(`Google Auth Success. Welcome back, ${payload.given_name}! 🌸`, 'system');
}

// --- OPTION B: FIREBASE SMS FLOW ---
function setupRecaptcha() {
    window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
        'size': 'invisible',
        'callback': (response) => { /* reCAPTCHA solved */ }
    });
}

if (document.getElementById('sendCodeBtn')) {
    document.getElementById('sendCodeBtn').onclick = () => {
        const phoneNumber = document.getElementById('phoneNumber').value.trim();
        if (!phoneNumber || phoneNumber.length < 10) return alert("Please enter a valid phone number with country code (e.g., +1234567890).");

        const appVerifier = window.recaptchaVerifier;
        document.getElementById('sendCodeBtn').disabled = true;
        document.getElementById('sendCodeBtn').innerText = "Sending...";

        auth.signInWithPhoneNumber(phoneNumber, appVerifier)
            .then((result) => {
                confirmationResult = result;
                document.getElementById('phone-input-section').style.display = 'none';
                document.getElementById('otp-input-section').style.display = 'block';
            }).catch((error) => {
                console.error("SMS Error:", error);
                alert("Error sending SMS: " + error.message);
                document.getElementById('sendCodeBtn').disabled = false;
                document.getElementById('sendCodeBtn').innerText = "Login with Phone";
                if (window.recaptchaVerifier) window.recaptchaVerifier.render().then(widgetId => grecaptcha.reset(widgetId));
            });
    };
}

if (document.getElementById('verifyCodeBtn')) {
    document.getElementById('verifyCodeBtn').onclick = () => {
        const code = document.getElementById('verificationCode').value.trim();
        if (!code || code.length !== 6) return alert("Please enter the 6-digit code.");

        document.getElementById('verifyCodeBtn').disabled = true;
        document.getElementById('verifyCodeBtn').innerText = "Verifying...";

        confirmationResult.confirm(code).then((result) => {
            const user = result.user;
            sessionId = user.phoneNumber; 
            localStorage.setItem('monika_session', sessionId);
            
            loginOverlay.style.display = 'none';
            loadChatHistory(sessionId);
            addMessage(`Phone Auth Success. Welcome back! 🌸`, 'system');

        }).catch((error) => {
            console.error("Verification Error:", error);
            alert("Invalid code. Please try again.");
            document.getElementById('verifyCodeBtn').disabled = false;
            document.getElementById('verifyCodeBtn').innerText = "Verify";
        });
    };
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
            addMessage("Previous chat memory restored successfully. 🌸", 'system', false);
        }
    } catch (error) { console.error("History load error:", error); }
}

// ==========================================
// --- UI ANIMATIONS & LOGIC ---
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        loader.style.opacity = '0';
        setTimeout(() => {
            loader.style.display = 'none';
            initAnimations();
        }, 500);
    }, 3000);

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
    startBackgroundAnimation();
});

function addMessage(text, sender, animate = true) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    
    if (sender === 'user') {
        messageDiv.innerHTML = `
            <div class="avatar"><div class="user-avatar"><i class="fas fa-user"></i></div></div>
            <div class="message-content"><p>${text}</p></div>
        `;
    } else if (sender === 'system') {
        messageDiv.innerHTML = `<div class="message-content" style="background: rgba(0,0,0,0.5); color: #4ade80;"><p>${text}</p></div>`;
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

// --- ACTUAL AI LOGIC ---
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

// --- POP-OUT PIP ---
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
function startBackgroundAnimation() {
    let hue = 240;
    setInterval(() => { hue = (hue + 1) % 360; document.body.style.background = `linear-gradient(135deg, hsl(${hue}, 60%, 60%), hsl(${hue + 30}, 60%, 50%))`; }, 5000);
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
