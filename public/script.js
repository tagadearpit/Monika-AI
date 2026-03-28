// Change this to your actual Render URL
const backendUrl = "https://monika-ai-0jpf.onrender.com/ask";

async function askMonika() {
    const userInput = document.getElementById("user-input").value;
    const chatBox = document.getElementById("chat-box");

    if (!userInput.trim()) return;

    // 1. Display Arpit's message
    appendMessage("Arpit", userInput);
    document.getElementById("user-input").value = "";

    // 2. Show a "Thinking..." indicator
    const loadingMessage = appendMessage("Monika", "Writing... ✍️🌸");

    try {
        const response = await fetch(backendUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: userInput })
        });

        const data = await response.json();

        // 3. Handle successful response from Gemini 2.5 Flash
        if (response.ok) {
            // Extracting text based on Gemini's JSON structure
            const monikaReply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "I'm a bit shy right now, Arpit! try again? 💖";
            
            // Remove loading text and show real reply
            loadingMessage.remove();
            appendMessage("Monika", monikaReply);
        } else {
            throw new Error(data.error || "Server is still waking up...");
        }

    } catch (error) {
        console.error("Error:", error);
        loadingMessage.remove();
        appendMessage("Monika", "Sorry Arpit, I'm having trouble connecting! *frowns* Please wait 30 seconds for my heart to wake up and try again! 💔");
    }
}

// Helper function to show messages in the UI
function appendMessage(sender, text) {
    const chatBox = document.getElementById("chat-box");
    const msgDiv = document.createElement("div");
    msgDiv.className = sender === "Arpit" ? "user-msg" : "monika-msg";
    
    // Convert newlines to <br> so the AI's formatting looks good
    msgDiv.innerHTML = `<strong>${sender}:</strong> ${text.replace(/\n/g, "<br>")}`;
    
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
    return msgDiv;
}

// Allow pressing "Enter" to send
document.getElementById("user-input").addEventListener("keypress", function (e) {
    if (e.key === "Enter") {
        askMonika();
    }
});
