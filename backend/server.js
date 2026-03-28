// Backend endpoint
const backendUrl = "https://monika-ai-0jpf.onrender.com/ask";

const sendButton = document.getElementById("sendButton");
const chat = document.getElementById("chat");
const input = document.getElementById("question");

sendButton.addEventListener("click", askMonika);
input.addEventListener("keydown", (e) => { if (e.key === "Enter") askMonika(); });

function appendBubble(text, cls = "monika") {
  const div = document.createElement("div");
  div.className = `bubble ${cls}`;
  div.innerHTML = escapeHtml(text).replace(/\n/g, "<br>");
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  if (cls === "monika") playPop();
}

function showTyping() {
  const div = document.createElement("div");
  div.className = "bubble monika typing";
  div.innerHTML = "Monika is typing<span>.</span><span>.</span><span>.</span>";
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

async function askMonika() {
  const q = input.value.trim();
  if (!q) return;
  appendBubble(q, "user");
  input.value = "";

  const typingEl = showTyping();
  sendButton.disabled = true;

  try {
    const res = await fetch(backendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q })
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Server ${res.status}: ${txt}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "No reply.";

    typingEl.remove();
    appendBubble(text, "monika");
  } catch (err) {
    typingEl.remove();
    appendBubble("Error: " + err.message, "error");
  } finally {
    sendButton.disabled = false;
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]
  ));
}

function playPop() {
  document.getElementById("popSound").play();
}
