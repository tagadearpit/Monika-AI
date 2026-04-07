// --- CONFIGURATION ---
const baseUrl = ""; 
let isVisionActive = false; 

const visionFeed = document.getElementById('vision-feed');
const visionContainer = document.getElementById('vision-container');
const chatContainer = document.getElementById('chat-container');
const micBtn = document.getElementById('micButton');
const camBtn = document.getElementById('camButton'); 
const inputField = document.getElementById("question");
const chatBox = document.getElementById("chat");
const pipBtn = document.getElementById('pipButton');

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
    
    element.innerHTML = "<strong>Monika:</strong> <span class='msg-text'></span>";
    const textSpan = element.querySelector('.msg-text');

    function type() {
        if (i < cleanText.length) {
            textSpan.textContent += cleanText.charAt(i); 
            i++;
            chatBox.scrollTop = chatBox.scrollHeight;
            setTimeout(type, (cleanText[i-1] === "." ? 200 : 35));
        } else if (callback) callback();
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
    const canvas = document.getElementById('capture-canvas');
    canvas.width = visionFeed.videoWidth;
    canvas.height = visionFeed.videoHeight;
    canvas.getContext('2d').drawImage(visionFeed, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
}

// --- 4. TEXT-TO-SPEECH (MONIKA'S VOICE) ---
function monikaSpeak(text) {
    window.speechSynthesis.cancel();
    const cleanText = text.replace(/\[.*?\]/g, "");
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.pitch = 1.4;
    utterance.rate = 1.15;
    
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
        utterance.voice = voices.find(v => v.name.includes("Female") || v.name.includes("Google UK English Female")) || voices[0];
    }
    window.speechSynthesis.speak(utterance);
}
// Force voices to load on startup
window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();


// --- 5. SPEECH-TO-TEXT (VOICE RECOGNITION) ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false; 
    
    recognition.onstart = () => {
        micBtn.classList.add('listening');
        inputField.placeholder = "Listening...";
    };
    
    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        inputField.value = transcript;
        askMonika(true); // Send it, and force a voice reply
    };
    
    recognition.onend = () => {
        micBtn.classList.remove('listening');
        inputField.placeholder = "Say something...";
    };
} else {
    console.warn("Your browser doesn't support Voice Recognition.");
}

// --- 6. CHAT LOGIC ---
async function askMonika(speakResponse = false) {
    let userInput = inputField.value.trim();
    
    if (!userInput && isVisionActive) userInput = "What do you see right now, Monika?";
    if (!userInput) return;

    appendMessage("Arpit", userInput);
    inputField.value = ""; 
    const loading = appendMessage("Monika", "...");

    let imageBase64 = isVisionActive ? await captureVisionFrame() : null;

    try {
        const response = await fetch(`${baseUrl}/ask`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: userInput, imageBase64 })
        });
        const data = await response.json();
        loading.remove(); 
        const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "I'm a bit confused... 💔";
        const newMsg = appendMessage("Monika", "");
        
        // --- NEW BEHAVIOR: SPEAK IMMEDIATELY ---
        // She speaks right now, instead of waiting for the typewriter!
        if(speakResponse || isVisionActive) {
            monikaSpeak(reply); 
        }
        
        // Typewriter starts typing at the same time she starts talking
        typeWriter(reply, newMsg); 

    } catch (e) { 
        loading.remove(); 
        appendMessage("Monika", "Connection lost... 💔"); 
    }
}

// --- 7. BUTTON EVENTS ---
camBtn.onclick = () => {
    isVisionActive = !isVisionActive;
    camBtn.classList.toggle('active', isVisionActive);
    isVisionActive ? startVision() : stopVision();
};

micBtn.onclick = () => {
    if (recognition) {
        // --- NEW BEHAVIOR: GREETING BEFORE LISTENING ---
        window.speechSynthesis.cancel(); // Stop any current speech
        inputField.placeholder = "Monika is speaking...";
        
        const greeting = new SpeechSynthesisUtterance("What would you want to talk, Arpit?");
        greeting.pitch = 1.3;
        greeting.rate = 1.0;
        
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
            greeting.voice = voices.find(v => v.name.includes("Female") || v.name.includes("Google UK English Female")) || voices[0];
        }

        // Wait until she finishes saying the greeting before turning on the mic
        greeting.onend = () => {
            recognition.start();
        };

        window.speechSynthesis.speak(greeting);
        
    } else {
        alert("Voice recognition is not supported in this browser.");
    }
};

document.getElementById("sendButton").onclick = () => askMonika(false); 
inputField.onkeydown = (e) => { if(e.key === "Enter") askMonika(false); };

function appendMessage(sender, text) {
    const msgDiv = document.createElement("div");
    msgDiv.className = `bubble ${sender === "Arpit" ? "user" : "monika"}`;
    msgDiv.innerHTML = `<strong>${sender}:</strong> ${text}`;
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
    return msgDiv;
}
