// Attach event listener to the Send button
document.getElementById("sendButton").addEventListener("click", askMonika);

async function askMonika() {
  const q = document.getElementById("question").value;
  if (!q) return; // do nothing if input is empty

  // Your backend URL from Render (safe, no API key exposed here)
  const backendUrl = "https://monika-ai-0jpf.onrender.com/ask";

  try {
    // Send the question to your backend
    const res = await fetch(backendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q })
    });

    // Get Monika's reply from backend
    const data = await res.json();

    // Show Monika’s reply in the chat box
    document.getElementById("chat").innerHTML +=
      `<p class="monika">Monika: ${JSON.stringify(data)}</p>`;
  } catch (err) {
    // Show error if something goes wrong
    document.getElementById("chat").innerHTML +=
      `<p class="monika">Error: ${err.message}</p>`;
  }
}
