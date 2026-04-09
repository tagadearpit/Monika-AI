import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

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

// --- 1. 3D AVATAR SETUP ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 20);
// FIX: Shifted the camera slightly right (0.4) so Monika appears on the left!
camera.position.set(0.4, 1.4, 1.5); 

const renderer = new THREE.WebGLRenderer({ 
    canvas: document.getElementById('avatar-canvas'), 
    alpha: true, 
    antialias: true 
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);

const light = new THREE.DirectionalLight(0xffffff, Math.PI);
light.position.set(1, 1, 1).normalize();
scene.add(light);

let currentVrm = undefined;
const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

// LOAD THE 3D MODEL
loader.load('/monika.vrm', (gltf) => {
    const vrm = gltf.userData.vrm;
    scene.add(vrm.scene);
    currentVrm = vrm;
    VRMUtils.rotateVRM0(vrm); 
    console.log("🌸 Avatar Loaded successfully!");
}, undefined, (error) => console.error("VRM Load Error:", error));

// ANIMATION LOOP (Now with idle swaying!)
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    const deltaTime = clock.getDelta();
    const elapsedTime = clock.getElapsedTime();

    if (currentVrm) {
        currentVrm.update(deltaTime);
        
        // Gentle breathing and swaying movement
        currentVrm.scene.rotation.y = Math.sin(elapsedTime * 0.5) * 0.05; 
        
        const head = currentVrm.humanoid.getNormalizedBoneNode('head');
        if (head) {
            head.rotation.x = Math.sin(elapsedTime) * 0.02;
            head.rotation.y = Math.cos(elapsedTime * 0.8) * 0.05;
        }
    }
    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- 2. POP-OUT LOGIC ---
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

// --- 3. SECURE TYPEWRITER ---
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

// --- 4. VISION CAPABILITIES ---
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

// --- 5. TEXT-TO-SPEECH, FACIAL EXPRESSIONS & LIP-SYNC ---
let speakInterval;

function startLipSync() {
    if (!currentVrm) return;
    const vowels = ['aa', 'ih', 'ou', 'ee', 'oh'];
    // Randomly flap mouth shapes to simulate talking
    speakInterval = setInterval(() => {
        vowels.forEach(v => currentVrm.expressionManager.setValue(v, 0));
        const randomVowel = vowels[Math.floor(Math.random() * vowels.length)];
        currentVrm.expressionManager.setValue(randomVowel, Math.random() * 0.8 + 0.2);
    }, 100); 
}

function stopLipSync() {
    clearInterval(speakInterval);
    if (currentVrm) {
        const vowels = ['aa', 'ih', 'ou', 'ee', 'oh'];
        vowels.forEach(v => currentVrm.expressionManager.setValue(v, 0));
    }
}

function monikaSpeak(text) {
    window.speechSynthesis.cancel();
    stopLipSync(); // Reset mouth just in case

    const utterance = new SpeechSynthesisUtterance();
    
    let currentPitch = 1.4; 
    let currentRate = 1.15;

    // Trigger 3D Face & Audio adjustments based on mood tags
    if (currentVrm) {
        currentVrm.expressionManager.setValue('happy', 0);
        currentVrm.expressionManager.setValue('angry', 0);
        currentVrm.expressionManager.setValue('sad', 0);

        if (text.includes("[ANGRY]")) {
            currentPitch = 1.6; currentRate = 1.35;
            currentVrm.expressionManager.setValue('angry', 1.0);
        } else if (text.includes("[SAD]")) {
            currentPitch = 1.1; currentRate = 0.9;
            currentVrm.expressionManager.setValue('sad', 1.0);
        } else if (text.includes("[LOVING]") || text.includes("[HAPPY]")) {
            currentPitch = 1.3; currentRate = 1.05;
            currentVrm.expressionManager.setValue('happy', 1.0);
        }
    }

    utterance.pitch = currentPitch;
    utterance.rate = currentRate;
    
    const cleanText = text.replace(/\[.*?\]/g, "");
    utterance.text = cleanText;
    
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
        utterance.voice = voices.find(v => v.name.includes("Female") || v.name.includes("Google UK English Female")) || voices[0];
    }
    
    // Hook up Lip-Sync!
    utterance.onstart = () => startLipSync();
    utterance.onend = () => stopLipSync();

    window.speechSynthesis.speak(utterance);
}
window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();

// --- 6. SPEECH-TO-TEXT (VOICE RECOGNITION) ---
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
        askMonika(true); 
    };
    
    recognition.onend = () => {
        micBtn.classList.remove('listening');
        inputField.placeholder = "Say something...";
    };
} else {
    console.warn("Your browser doesn't support Voice Recognition.");
}

// --- 7. CHAT LOGIC ---
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
        
        const reply = data.reply || "I'm a bit confused... 💔";
        const actionCommand = data.action;

        if (actionCommand) {
            document.body.className = ''; 
            if (actionCommand !== 'default') {
                document.body.classList.add(`theme-${actionCommand}`);
            }
        }

        const newMsg = appendMessage("Monika", "");
        
        if(speakResponse || isVisionActive) {
            monikaSpeak(reply); 
        }
        
        typeWriter(reply, newMsg); 

    } catch (e) { 
        loading.remove(); 
        appendMessage("Monika", "Connection lost... 💔"); 
    }
}

// --- 8. BUTTON EVENTS ---
camBtn.onclick = () => {
    isVisionActive = !isVisionActive;
    camBtn.classList.toggle('active', isVisionActive);
    isVisionActive ? startVision() : stopVision();
};

micBtn.onclick = () => {
    if (recognition) {
        window.speechSynthesis.cancel(); 
        stopLipSync();
        inputField.placeholder = "Monika is speaking...";
        
        const greeting = new SpeechSynthesisUtterance("What would you want to talk, Arpit?");
        greeting.pitch = 1.3;
        greeting.rate = 1.0;
        
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
            greeting.voice = voices.find(v => v.name.includes("Female") || v.name.includes("Google UK English Female")) || voices[0];
        }

        // Make her lip-sync the greeting too!
        greeting.onstart = () => startLipSync();
        greeting.onend = () => {
            stopLipSync();
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
