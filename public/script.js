// --- CONFIGURATION ---
const baseUrl = "https://monika-ai-0jpf.onrender.com";
let isLiveMode = false; 
const video = document.createElement('video'); // Hidden video for Vision

// --- 1. TYPEWRITER EFFECT ---
// Makes Monika's text appear letter-by-letter for a more "human" feel
function typeWriter(text, element, callback) {
    let i = 0;
    const cleanText = text.replace(/\[.*?\]/g, "").trim();
    element.innerHTML = "<strong>Monika:</strong> ";
    
    function type() {
        if (i < cleanText.length) {
            element.innerHTML += cleanText.charAt(i);
            i++;
            // Dynamic speed: dots and commas take slightly longer
            let speed = (cleanText[i-1] === "." || cleanText[i-1] === ",") ? 200 : 30;
            setTimeout(type, speed);
        } else if (callback) {
            callback(); // Trigger voice after typing is done
        }
    }
    type();
}

// --- 2. VISION ENGINE ---
// Starts the camera in the background
async function initCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        video.play();
        console.log("Monika's eyes are open! 👁️");
    } catch (e) {
        console.warn("Camera access denied. Monika is 'blind' but can still talk!");
    }
}

// Captures a single frame to send to Gemini
async function captureVisionFrame() {
    if (!video.srcObject) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 320; // Lower resolution for faster API response
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.6).split(',')[1]; // Base64 string
}

// --- 3. BROWSER VOICE ---
function monikaSpeak(text, voiceEnabled = false) {
    if (!voiceEnabled) return; 
    const cleanText = text.replace(/\[.*?\]/g, "").trim();
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.pitch = 1.6; 
    utterance.rate = 1.1; 

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
    const inputField = document.getElementById("question");
    const userInput = inputField.value.trim();
    if (!userInput) return;

    // UI Feedback
    const pop = document.getElementById("popSound");
    if (pop) pop.play().catch(() => {});
    
    appendMessage("Arpit", userInput);
    inputField.value = ""; 
    const loadingMessage = appendMessage("Monika", "...");

    // Capture Vision if in voice mode
    let imageBase64 = isFromVoice ? await captureVisionFrame() : null;

    try {
        const response = await fetch(`${baseUrl}/ask`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                question: userInput,
                imageBase64: imageBase64 
            })
        });

        const data = await response.json();
        if (loadingMessage) loadingMessage.remove(); 

        const monikaReply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "Something went wrong... 💖";
        
        // Update Mood Theme
        if (monikaReply.includes("[HAPPY]")) document.body.className = "mood-happy";
        else if (monikaReply.includes("[LOVING]")) document.body.className = "mood-loving";
        else document.body.className = "";

        const newMsg = appendMessage("Monika", "");
        // Start typing effect, then trigger voice
        typeWriter(monikaReply, newMsg, () => {
            monikaSpeak(monikaReply, isFromVoice);
        });

    } catch (error) {
        if (loadingMessage) loadingMessage.remove();
        appendMessage("Monika", "Connection lost... 💔");
    }
}

// --- 5. SPEECH & MIC LOGIC ---
const micBtn = document.getElementById('micButton');
const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
let recognition;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        document.getElementById("question").value = transcript;
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
        initCamera(); // Open eyes when voice mode starts
        const greeting = "I'm listening, Arpit! What's on your mind? 🌸";
        const msg = appendMessage("Monika", "");
        typeWriter(greeting, msg, () => monikaSpeak(greeting, true));
    } else {
        isLiveMode = false;
        micBtn.classList.remove('listening');
        if (recognition) recognition.stop();
        window.speechSynthesis.cancel();
        if (video.srcObject) video.srcObject.getTracks().forEach(track => track.stop()); // Close eyes
    }
};

// --- 6. UI HELPERS ---
function appendMessage(sender, text) {
    const chatBox = document.getElementById("chat");
    const msgDiv = document.createElement("div");
    msgDiv.className = `bubble ${sender === "Arpit" ? "user" : "monika"}`;
    msgDiv.innerHTML = `<strong>${sender}:</strong> ${text.replace(/\n/g, "<br>")}`;
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight; 
    return msgDiv;
}

window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();

document.getElementById("sendButton").addEventListener("click", () => askMonika(false));
document.getElementById("question").addEventListener("keydown", (e) => {
    if (e.key === "Enter") askMonika(false);
});
