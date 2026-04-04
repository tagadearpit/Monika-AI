// --- CONFIGURATION ---
const baseUrl = "https://monika-ai-0jpf.onrender.com";
let isLiveMode = false; 

const visionFeed = document.getElementById('vision-feed');
const visionContainer = document.getElementById('vision-container');
const chatContainer = document.getElementById('chat-container');
const micBtn = document.getElementById('micButton');
const micIcon = document.getElementById('micIcon');
const inputField = document.getElementById("question");
const chatBox = document.getElementById("chat");
const pipBtn = document.getElementById('pipButton');

// --- 1. POP-OUT (PICTURE IN PICTURE) LOGIC ---
pipBtn.onclick = async () => {
    if (!window.documentPictureInPicture) {
        alert("Your browser doesn't support the Floating Window API yet. Use Chrome! 🌸");
        return;
    }

    // Open the floating window
    const pipWindow = await window.documentPictureInPicture.requestWindow({
        width: 400,
        height: 600,
    });

    // Copy CSS to the floating window
    [...document.styleSheets].forEach((styleSheet) => {
        try {
            const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
            const style = document.createElement('style');
            style.textContent = cssRules;
            pipWindow.document.head.appendChild(style);
        } catch (e) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = styleSheet.href;
            pipWindow.document.head.appendChild(link);
        }
    });

    // Move Chat into the Floating Window
    pipWindow.document.body.append(chatContainer);

    // Return chat to main window when closed
    pipWindow.addEventListener("pagehide", (event) => {
        const wrapper = document.getElementById('main-wrapper');
        const container = event.target.querySelector('#chat-container');
        wrapper.append(container);
    });
};

// --- 2. TYPEWRITER & AUTO-SCROLL ---
function typeWriter(text, element, callback) {
    let i = 0;
    const cleanText = text.replace(/\[.*?\]/g, "").trim();
    element.innerHTML = "<strong>Monika:</strong> ";
    
    function type() {
        if (i < cleanText.length) {
            element.innerHTML += cleanText.charAt(i);
            i++;
            chatBox.scrollTo({ top: chatBox.scrollHeight, behavior: 'smooth' });
            setTimeout(type, (cleanText[i-1] === "." ? 200 : 35));
        } else if (callback) callback();
    }
    type();
}

// --- 3. VISION & VOICE ---
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
        visionContainer.classList.remove('active');
    }
}

async function captureVisionFrame() {
    if (!visionFeed.srcObject) return null;
    const canvas = document.getElementById('capture-canvas');
    canvas.width = visionFeed.videoWidth;
    canvas.height = visionFeed.videoHeight;
    canvas.getContext('2d').drawImage(visionFeed, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
}

function monikaSpeak(text, voiceEnabled = false) {
    if (!voiceEnabled) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.replace(/\[.*?\]/g, ""));
    utterance.pitch = 1.3;
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find(v => v.name.includes("Female")) || voices[0];
    window.speechSynthesis.speak(utterance);
}

// --- 4. CHAT LOGIC ---
async function askMonika(isFromVoice = false) {
    const userInput = inputField.value.trim();
    if (!userInput && !isFromVoice) return;

    appendMessage("Arpit", userInput || "[Looking at you...]");
    inputField.value = ""; 
    const loading = appendMessage("Monika", "...");

    let imageBase64 = (visionContainer.classList.contains('active')) ? await captureVisionFrame() : null;

    try {
        const response = await fetch(`${baseUrl}/ask`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: userInput || "What do you see?", imageBase64 })
        });
        const data = await response.json();
        loading.remove(); 
        const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "I'm lost... 💔";
        
        const newMsg = appendMessage("Monika", "");
        typeWriter(reply, newMsg, () => monikaSpeak(reply, isFromVoice));
    } catch (e) { loading.remove(); appendMessage("Monika", "Connection lost... 💔"); }
}

// --- 5. 3D TILT EFFECT ---
document.addEventListener('mousemove', (e) => {
    const xAxis = (window.innerWidth / 2 - e.pageX) / 45;
    const yAxis = (window.innerHeight / 2 - e.pageY) / 45;
    chatContainer.style.transform = `rotateY(${xAxis}deg) rotateX(${yAxis}deg)`;
    if (visionContainer.classList.contains('active')) {
        visionContainer.style.transform = `rotateY(${xAxis}deg) rotateX(${yAxis}deg)`;
    }
});

// --- 6. CONTROLS ---
micBtn.onclick = () => {
    if (!isLiveMode) {
        isLiveMode = true;
        micBtn.classList.add('listening');
        micIcon.innerText = '📸';
        startVision();
    } else {
        isLiveMode = false;
        micBtn.classList.remove('listening');
        micIcon.innerText = '🎤';
        stopVision();
        window.speechSynthesis.cancel();
    }
};

function appendMessage(sender, text) {
    const msgDiv = document.createElement("div");
    msgDiv.className = `bubble ${sender === "Arpit" ? "user" : "monika"}`;
    msgDiv.innerHTML = `<strong>${sender}:</strong> ${text}`;
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
    return msgDiv;
}

document.getElementById("sendButton").onclick = () => askMonika(false);
inputField.onkeydown = (e) => { if(e.key === "Enter") askMonika(false); };
window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
