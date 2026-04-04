// --- CONFIGURATION ---
const baseUrl = "https://monika-ai-0jpf.onrender.com";
let isLiveMode = false; 

const visionFeed = document.getElementById('vision-feed');
const visionContainer = document.getElementById('vision-container');
const canvas = document.getElementById('capture-canvas');
const micBtn = document.getElementById('micButton');
const micIcon = document.getElementById('micIcon');
const inputField = document.getElementById("question");
const chatBox = document.getElementById("chat");

// --- 1. TYPEWRITER EFFECT ---
function typeWriter(text, element, callback) {
    let i = 0;
    const cleanText = text.replace(/\[.*?\]/g, "").trim();
    element.innerHTML = "<strong>Monika:</strong> ";
    
    function type() {
        if (i < cleanText.length) {
            element.innerHTML += cleanText.charAt(i);
            i++;
            let speed = (cleanText[i-1] === "." || cleanText[i-1] === ",") ? 200 : 30;
            setTimeout(type, speed);
        } else if (callback) {
            callback();
        }
    }
    type();
}

// --- 2. VISION ENGINE ---
async function startVision() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        visionFeed.srcObject = stream;
        visionContainer.classList.add('active'); // Use CSS class for transition
        console.log("Monika's eyes are open! 👁️");
    } catch (e) {
        console.warn("Camera access denied.");
        alert("Arpit, I need camera access to see you! 🌸");
    }
}

function stopVision() {
    if (visionFeed.srcObject) {
        visionFeed.srcObject.getTracks().forEach(track => track.stop());
        visionContainer.classList.remove('active'); // Hide via CSS
    }
}

async function captureVisionFrame() {
    if (!visionFeed.srcObject) return null;
    canvas.width = visionFeed.videoWidth;
    canvas.height = visionFeed.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(visionFeed, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
}

// --- 3. BROWSER VOICE ---
function monikaSpeak(text, voiceEnabled = false) {
    if (!voiceEnabled) return; 
    const cleanText = text.replace(/\[.*?\]/g, "").trim();
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.pitch = 0.9; // Optimized for stability
    utterance.rate = 1.0; 

    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => 
        v.name.includes("Google US English") || v.name.includes("Female") || v.name.includes("Samantha")
    );
    if (preferredVoice) utterance.voice = preferredVoice;

    utterance.onend = () => {
        if (isLiveMode) startListening();
    };
    window.speechSynthesis.speak(utterance);
}

// --- 4. MAIN CHAT LOGIC ---
async function askMonika(isFromVoice = false) {
    const userInput = inputField.value.trim();
    if (!userInput && !isFromVoice) return;

    const pop = document.getElementById("popSound");
    if (pop) pop.play().catch(() => {});
    
    appendMessage("Arpit", userInput || "[Analyzing Image]");
    inputField.value = ""; 
    const loadingBubble = appendMessage("Monika", "...");

    let imageBase64 = (visionContainer.classList.contains('active')) ? await captureVisionFrame() : null;

    try {
        const response = await fetch(`${baseUrl}/ask`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                question: userInput || "What do you see right now?",
                imageBase64: imageBase64 
            })
        });

        const data = await response.json();
        if (loadingBubble) loadingBubble.remove(); 

        const monikaReply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "Something went wrong... 💖";
        
        // Mood UI logic
        if (monikaReply.includes("[HAPPY]")) document.body.className = "mood-happy";
        else if (monikaReply.includes("[LOVING]")) document.body.className = "mood-loving";
        else document.body.className = "";

        const newMsg = appendMessage("Monika", "");
        typeWriter(monikaReply, newMsg, () => {
            monikaSpeak(monikaReply, isFromVoice);
        });

    } catch (error) {
        if (loadingBubble) loadingBubble.remove();
        appendMessage("Monika", "Connection lost... 💔");
    }
}

// --- 5. SPEECH RECOGNITION ---
const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
let recognition;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        inputField.value = transcript;
        askMonika(true); 
    };
    recognition.onerror = () => { if(isLiveMode) startListening(); };
}

function startListening() {
    if (recognition && isLiveMode) {
        try { recognition.start(); } catch(e) {}
    }
}

micBtn.onclick = () => {
    if (!isLiveMode) {
        isLiveMode = true;
        micBtn.classList.add('listening');
        micIcon.innerText = '📸';
        startVision();
        
        const greeting = "I'm looking and listening, Arpit! 🌸";
        const msg = appendMessage("Monika", "");
        typeWriter(greeting, msg, () => monikaSpeak(greeting, true));
    } else {
        isLiveMode = false;
        micBtn.classList.remove('listening');
        micIcon.innerText = '🎤';
        stopVision();
        if (recognition) recognition.stop();
        window.speechSynthesis.cancel();
    }
};

function appendMessage(sender, text) {
    const msgDiv = document.createElement("div");
    msgDiv.className = `bubble ${sender === "Arpit" ? "user" : "monika"}`;
    msgDiv.innerHTML = `<strong>${sender}:</strong> ${text.replace(/\n/g, "<br>")}`;
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight; 
    return msgDiv;
}

window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();

document.getElementById("sendButton").addEventListener("click", () => askMonika(false));
inputField.addEventListener("keydown", (e) => { if (e.key === "Enter") askMonika(false); });
