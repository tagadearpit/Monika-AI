const backendUrl = "https://monika-ai-0jpf.onrender.com/ask";

async function askMonika() {
    // UPDATED: Now matches id="question" and id="chat" in your HTML
    const inputField = document.getElementById("question");
    const chatBox = document.getElementById("chat");
    const userInput = inputField.value.trim();

    if (!userInput) return;

    // 1. Play the pop sound (optional)
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
        loadingMessage.remove(); // Remove "Writing..."

        if (response.ok) {
            // Parsing for Gemini 2.5 Flash
            const monikaReply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "I'm a bit shy right now... try again? 💖";
            appendMessage("Monika", monikaReply);
        } else {
            appendMessage("Monika", "My heart is a bit heavy right now (Server Error). Try again in a second! 💔");
        }

    } catch (error) {
        console.error("Error:", error);
        if (loadingMessage) loadingMessage.remove();
        appendMessage("Monika", "I can't reach you, Arpit! *frowns* Wait 30 seconds for the server to wake up. 💔");
    }
}

function appendMessage(sender, text) {
    const chatBox = document.getElementById("chat");
    const msgDiv = document.createElement("div");
    
    // Apply classes from your style.css
    msgDiv.classList.add("bubble");
    msgDiv.classList.add(sender === "Arpit" ? "user" : "monika");
    
    // Formatting: Handle line breaks
    msgDiv.innerHTML = `<strong>${sender}:</strong> ${text.replace(/\n/g, "<br>")}`;
    
    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight; // Auto-scroll to bottom
    return msgDiv;
}

// FIX: Listen for 'Enter' key on the input field id="question"
document.getElementById("question").addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
        e.preventDefault(); 
        askMonika();
    }
});

// FIX: Make sure the button also works
document.getElementById("sendButton").addEventListener("click", askMonika);
