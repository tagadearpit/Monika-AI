// --- CONFIGURATION ---
const baseUrl = ""; 
let isVisionActive = false; 
let isMonikaBusy = false; 
let isListening = false; 
let lastSpeechTime = 0; 

const visionFeed = document.getElementById('vision-feed');
const visionContainer = document.getElementById('vision-container');
const chatContainer = document.getElementById('chat-container');
const micBtn = document.getElementById('micButton');
const camBtn = document.getElementById('camButton'); 
const inputField = document.getElementById("question");
const chatBox = document.getElementById("chat");
const pipBtn = document.getElementById('pipButton');
const loginOverlay = document.getElementById('login-overlay');

const globalUtterance = new SpeechSynthesisUtterance();

// --- SESSION & GOOGLE LOGIN MANAGEMENT ---
let sessionId = localStorage.getItem('monika_session');

window.onload = async function () {
    try {
        const configResponse = await fetch(`${baseUrl}/api/config`);
        const configData = await configResponse.json();

        google.accounts.id.initialize({
            client_id: configData.googleClientId, 
            callback: handleGoogleLogin
        });

        if (!sessionId) {
            loginOverlay.style.display = 'flex';
            google.accounts.id.renderButton(
                document.getElementById("googleButton"),
                { theme: "outline", size: "large", shape: "pill" }
            );
        } else {
            loginOverlay.style.display = 'none';
            appendMessage("System", `Securely connected to memory: ${sessionId}`);
        }
    } catch (error) {
        console.error("Failed to load configuration:", error);
        appendMessage("System", "Error: Could not connect to authentication server.");
    }
};

function handleGoogleLogin(response) {
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    
    sessionId = payload.email; 
    localStorage.setItem('monika_session', sessionId);
    
    loginOverlay.style.display = 'none';
    
    monikaSpeak(`Welcome back, ${payload.given_name}.`);
    appendMessage("System", `Google Auth Success. Welcome, ${payload.name}!`);
}

document.getElementById('logoutBtn').onclick = () => {
    localStorage.removeItem('monika_session');
    location.reload(); 
};

// --- THEME MANAGEMENT ---
const savedTheme = localStorage.getItem('monika_theme') || 'default';
if (savedTheme !== 'default') {
    document.body.classList.add(`theme-${savedTheme}`);
}

// --- 1. POP-OUT LOGIC ---
pipBtn.onclick = async () => {
    if (!window.documentPictureInPicture) {
        alert("Use Chrome for the floating window! 🌸");
        return;
    }
    const pipWindow = await window.documentPictureInPicture.requestWindow({ width: 400, height: 600 });
    [...document.styleSheets].forEach((styleSheet) => {
        try {
            const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
            const style = document.createElement('style');
            style.textContent = cssRules;
            pipWindow.document.head.appendChild(style);
        } catch (e) {
            const link = document.createElement('link');
            link.rel = 'stylesheet'; link.href = styleSheet.href;
            pipWindow.document.head.appendChild(link);
        }
    });
    pipWindow.document.body.append(chatContainer);
    pipWindow.addEventListener("pagehide", (event) => {
        document.getElementById('main-wrapper').append(event.target.querySelector('#chat-container'));
    });
};

// --- 2. SECURE TYPEWRITER ---
function typeWriter(text, element, callback) {
    let i = 0;
    const cleanText = text.replace(/\[.*?\]/g, "").trim();
    
    const textSpan = element.querySelector('.msg-text');
    if(textSpan) textSpan.textContent = "";

    function type() {
        if (i < cleanText.length) {
            textSpan.textContent += cleanText.charAt(i); 
            i++;
            chatBox.scrollTop = chatBox.scrollHeight;
            setTimeout(type, (cleanText[i-1] === "." ? 200 : 35));
        } else if (callback) {
            callback(); 
        }
    }
    type();
}

// --- 3. VISION CAPABILITIES ---
async function startVision() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        visionFeed.srcObject = stream;
        visionContainer.classList.add('active'); 
    } catch (e) { alert("Camera access needed! 🌸"); }
}

function stopVision() {
    if (visionFeed.srcObject) {
        visionFeed.srcObject.getTracks().forEach(track => track.stop());
        visionFeed.srcObject = null;
        visionContainer.classList.remove('active');
    }
}

async function captureVisionFrame() {
    if (!visionFeed.srcObject) return null;
    if (!visionFeed.videoWidth || !visionFeed.videoHeight) return null;

    const canvas = document.getElementById('capture-canvas');
    const ctx = canvas.getContext('2d');
    
    canvas.width = visionFeed.videoWidth;
    canvas.height = visionFeed.videoHeight;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height); 
    ctx.drawImage(visionFeed, 0, 0, canvas.width, canvas.height);
    
    return canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
}

// --- 4. TEXT-TO-SPEECH (MONIKA'S VOICE) ---
function monikaSpeak(text) {
    window.speechSynthesis.cancel();
    
    let currentPitch = 1.4; 
    let currentRate = 1.15;

    if (text.includes("[ANGRY]")) {
        currentPitch = 1.6; currentRate = 1.35;
    } else if (text.includes("[SAD]")) {
        currentPitch = 1.1; currentRate = 0.9;
    } else if (text.includes("[LOVING]") || text.includes("[HAPPY]")) {
        currentPitch = 1.3; currentRate = 1.05;
    }

    globalUtterance.pitch = currentPitch;
    globalUtterance.rate = currentRate;
    
    const cleanText = text.replace(/\[.*?\]/g, "");
    globalUtterance.text = cleanText;
    
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
        globalUtterance.voice = voices.find(v => v.name.includes("Female") || v.name.includes("Google UK English Female")) || voices[0];
    }

    window.speechSynthesis.speak(globalUtterance);
}
window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();

// --- 5. SPEECH-TO-TEXT (VOICE RECOGNITION) ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false; 
    recognition.interimResults = false; 
    
    recognition.onstart = () => {
        isListening = true;
        micBtn.classList.add('listening');
        inputField.placeholder = "Listening...";
    };
    
    recognition.onresult = (event) => {
        if (event.results && event.results[0] && event.results[0][0]) {
            const transcript = event.results[0][0].transcript;
            inputField.value = transcript;
        }
    };
    
    recognition.onend = () => {
        isListening = false;
        micBtn.classList.remove('listening');
        
        const now = Date.now();
        if (now - lastSpeechTime > 500 && inputField.value.trim() !== "" && !isMonikaBusy) {
            lastSpeechTime = now;
            askMonika(true); 
        } else {
            inputField.placeholder = "Type to Monika... 💕";
        }
    };
} else {
    console.warn("Your browser doesn't support Voice Recognition.");
}

// --- UI HELPERS ---
function showTypingIndicator() {
    const msgDiv = document.createElement("div");
    msgDiv.className = "bubble monika";
    const template = document.getElementById('typing-template');
    const clone = template.content.cloneNode(true);
    msgDiv.appendChild(clone);
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
    return msgDiv;
}

function appendMessage(sender, text) {
    const msgDiv = document.createElement("div");
    msgDiv.className = `bubble ${sender === "You" ? "user" : "monika"}`;
    
    const strongTag = document.createElement("strong");
    strongTag.textContent = `${sender}: `;
    msgDiv.appendChild(strongTag);

    const textSpan = document.createElement("span");
    textSpan.className = "msg-text";
    textSpan.textContent = text || ""; 
    msgDiv.appendChild(textSpan);

    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
    return msgDiv;
}

// --- 6. CHAT LOGIC ---
async function askMonika(speakResponse = false) {
    if (isMonikaBusy) return; 

    let userInput = inputField.value.trim();
    
    if (!userInput && isVisionActive) userInput = "What do you see right now, Monika?";
    if (!userInput) return;

    isMonikaBusy = true;
    inputField.disabled = true;
    document.getElementById("sendButton").style.opacity = "0.5";
    micBtn.style.opacity = "0.5";
    inputField.placeholder = "Monika is typing...";

    appendMessage("You", userInput);
    inputField.value = ""; 
    
    const loading = showTypingIndicator(); 

    let imageBase64 = isVisionActive ? await captureVisionFrame() : null;

    try {
        const response = await fetch(`${baseUrl}/ask`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: userInput, imageBase64, sessionId: sessionId })
        });
        
        const data = await response.json();
        if (data.error) throw new Error(data.error); 
        
        loading.remove(); 
        
        const reply = data.reply || "I'm a bit confused... 💔";
        const actionCommand = data.action;

        if (actionCommand) {
            document.body.className = actionCommand === 'default' ? '' : `theme-${actionCommand}`;
            localStorage.setItem('monika_theme', actionCommand); 
        }

        const newMsg = appendMessage("Monika", "");
        
        if(speakResponse || isVisionActive) {
            monikaSpeak(reply); 
        }
        
        typeWriter(reply, newMsg, () => {
            isMonikaBusy = false; 
            inputField.disabled = false;
            document.getElementById("sendButton").style.opacity = "1";
            micBtn.style.opacity = "1";
            inputField.placeholder = "Type to Monika... 💕";
            inputField.focus(); 
        }); 

    } catch (e) { 
        console.error("Monika Fetch Error:", e); 
        loading.remove(); 
        appendMessage("Monika", e.message || "Connection lost... 💔"); 
        
        isMonikaBusy = false;
        inputField.disabled = false;
        document.getElementById("sendButton").style.opacity = "1";
        micBtn.style.opacity = "1";
        inputField.placeholder = "Type to Monika... 💕";
    }
}

// --- 7. BUTTON EVENTS ---
camBtn.onclick = () => {
    isVisionActive = !isVisionActive;
    camBtn.classList.toggle('active', isVisionActive);
    isVisionActive ? startVision() : stopVision();
};

micBtn.onclick = () => {
    if (isMonikaBusy) return; 

    if (!recognition) {
        monikaSpeak("What would you like to talk about, darling?");
        setTimeout(() => inputField.focus(), 2000);
        return;
    }

    if (isListening) {
        recognition.stop();
    } else {
        window.speechSynthesis.cancel(); 
        inputField.placeholder = "Monika is listening...";
        
        globalUtterance.text = "What would you want to talk about?";
        globalUtterance.pitch = 1.3;
        globalUtterance.rate = 1.0;
        
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
            globalUtterance.voice = voices.find(v => v.name.includes("Female") || v.name.includes("Google UK English Female")) || voices[0];
        }

        globalUtterance.onend = () => {
            if(!isListening) recognition.start();
        };
        window.speechSynthesis.speak(globalUtterance);
    }
};

document.getElementById("sendButton").onclick = () => {
    if (!isMonikaBusy) askMonika(false);
}; 

inputField.onkeydown = (e) => { 
    if(e.key === "Enter" && !isMonikaBusy) askMonika(false); 
};
