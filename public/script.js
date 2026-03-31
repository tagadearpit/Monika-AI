const backendUrl = "https://monika-ai-0jpf.onrender.com/ask";

// --- Voice Synthesis Function ---
function monikaSpeak(text) {
    if ('speechSynthesis' in window) {
        // Stop any current speaking before starting new reply
        window.speechSynthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        
        // Fetch available voices
        const voices = window.speechSynthesis.getVoices();
        
        // Try to find a pleasant female voice (works best in Chrome)
        const monikaVoice = voices.find(v => 
            v.name.includes("Female") || 
            v.name.includes("Google US English") || 
            v.name.includes("Microsoft Zira")
        );
        
        if (monikaVoice) utterance.voice = monikaVoice;
        
        utterance.pitch = 1.2; // Makes the voice slightly higher/cute
        utterance.rate = 1.0;  // Normal speed
        
        window.speechSynthesis.speak(utterance);
    }
}

async function askMonika() {
    const inputField = document.getElementById("question");
    const chatBox = document.getElementById("chat");
    const userInput = inputField.value.trim();

    if (!userInput) return;

    // 1. Play the pop sound
    const pop = document.getElementById("popSound");
    if (pop) pop.play();

    // 2. Display Arpit's message
    appendMessage("Arpit", userInput);
    inputField.value = ""; // Clear input

    // 3. Show "Writing..." indicator
    const loadingMessage = appendMessage("Monika", "Writing... ✍️🌸");

    try {
        const response = await fetch(backendUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: userInput })
        });

        const data = await response.json();
        
        if (loadingMessage) loadingMessage.remove(); // Remove "Writing..."

        if (response.ok) {
            // Parsing for Gemini response structure
            const monikaReply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "I'm a bit shy right now... try again? 💖";
            
            appendMessage("Monika", monikaReply);
            
            // --- NEW: Trigger Voice Output ---
            monikaSpeak(monikaReply);

        } else {
            const errorMsg = "My heart is a bit heavy right now (Server Error). Try again in a second! 💔";
            appendMessage("Monika", errorMsg);
            monikaSpeak(errorMsg);
        }

    } catch (error) {
        console.error("Error:", error);
        if (loadingMessage) loadingMessage.remove();
        const failMsg = "I can't reach you, Arpit! *frowns* Wait 30 seconds for the server to wake up. 💔";
        appendMessage("Monika", failMsg);
        monikaSpeak(failMsg);
    }
}

function appendMessage(sender, text) {
    const chatBox = document.getElementById("chat");
    const msgDiv = document.createElement("div");
    
    msgDiv.classList.add("bubble");
    msgDiv.classList.add(sender === "Arpit" ? "user" : "monika");
    
    // Formatting: Handle line breaks and bolding
    msgDiv.innerHTML = `<strong>${sender}:</strong> ${text.replace(/\n/g, "<br>")}`;
    
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight; // Auto-scroll to bottom
    return msgDiv;
}

// FIX: Listen for 'Enter' key
document.getElementById("question").addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
        e.preventDefault(); 
        askMonika();
    }
});

// FIX: Send Button Click
document.getElementById("sendButton").addEventListener("click", askMonika);

// Chrome requires a user interaction before it loads voices
window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
};
