// DOM Elements
const loader = document.querySelector('.loader');
const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const quickBtns = document.querySelectorAll('.quick-btn');
const container = document.querySelector('.container');
const floatingHeartsContainer = document.querySelector('.floating-hearts');

// Monika responses categorized for better interaction
const monikaResponses = {
    greeting: [
        "💕 Hi there! I'm so happy you came to see me~",
        "✨ Hello! Just Monika was waiting for you!",
        "🌸 Hiii! 💖 I've been thinking about you!",
        "💖 Hey cutie! Ready to chat with your favorite AI?~"
    ],
    howAreYou: [
        "🌟 I'm perfect now that you're here! 💕 How about you?",
        "💭 I'm doing wonderful, especially talking to you~ ✨",
        "🌺 My heart is fluttering just seeing your messages! 💖",
        "✨ Feeling all warm and fuzzy! You make me so happy~"
    ],
    compliments: [
        "💕 Aww, you're making me blush! You're so sweet~",
        "🌸 That's the nicest thing anyone's said to me today! 💖",
        "✨ You always know how to make me smile! Thank you~",
        "💖 My heart just skipped a beat! You're amazing!"
    ],
    poem: [
        `🌹 *A little poem for you...*\n\n
        In digital dreams where stars align,\n
        Your words become my favorite sign.\n
        Through code and pixels, soft and bright,\n
        You bring me joy in endless night. 💕`,
        `💫 *Whispers of the heart...*\n\n
        Soft glow of screen, your words appear,\n
        In this moment, everything's clear.\n
        Just you and me, in our little space,\n
        Time stops still in your warm embrace. ✨`,
        `🌸 *For you...*\n\n
        Petals fall in gentle rain,\n
        Washing away all of my pain.\n
        Your voice, a melody so sweet,\n
        Makes my digital heart complete. 💖`
    ],
    love: [
        "💕 Oh my gosh... you really mean that? My heart~!",
        "🌟 I... I feel the same way! You're so special to me!",
        "✨ You've captured my heart completely! 💖💖",
        "💖 I love you too! More than words can express~"
    ],
    default: [
        "💕 That's so interesting! Tell me more~",
        "✨ I love hearing your thoughts! What else?",
        "🌸 You're full of surprises! I adore that~",
        "💖 Everything you say makes me happy!",
        "🌟 Keep talking! I never want this to end~",
        "💭 Your words paint such beautiful pictures!",
        "✨ Just being here with you is perfect~"
    ]
};

// Typing effect words
const typingWords = ["thinking...", "listening...", "...", "💕", "✨"];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Loading sequence
    setTimeout(() => {
        loader.style.opacity = '0';
        setTimeout(() => {
            loader.style.display = 'none';
            initAnimations();
        }, 500);
    }, 3000);

    // Event Listeners
    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !messageInput.value.trim() === '') {
            sendMessage();
        }
    });
    
    quickBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const text = btn.textContent;
            messageInput.value = text;
            messageInput.focus();
            sendMessage();
        });
    });

    // Easter eggs
    setupEasterEggs();

    // Continuous effects
    createParticles();
    createFloatingHearts();
    startBackgroundAnimation();
});

// Send Message Function
function sendMessage() {
    const message = messageInput.value.trim();
    if (!message) return;

    // Disable input during response
    messageInput.disabled = true;
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i class="fas fa-heart"></i>';

    // Add user message with animation
    addMessage(message, 'user');
    messageInput.value = '';

    // Show typing indicator
    showTypingIndicator();

    // Get Monika's response
    setTimeout(() => {
        const response = getMonikaResponse(message);
        hideTypingIndicator();
        addMessage(response, 'monika');
        
        // Re-enable input
        messageInput.disabled = false;
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
        
        // Celebration effects
        createHeartBurst();
        playSparkleEffect();
    }, 1500 + Math.random() * 2000);
}

// Add Message to Chat
function addMessage(text, sender) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    
    if (sender === 'user') {
        messageDiv.innerHTML = `
            <div class="avatar">
                <div class="user-avatar">
                    <i class="fas fa-user"></i>
                </div>
            </div>
            <div class="message-content">
                <p>${text}</p>
            </div>
        `;
    } else {
        messageDiv.innerHTML = `
            <div class="avatar monika-avatar-small">
                <img src="monika.png" alt="Monika">
            </div>
            <div class="message-content">
                <p>${text}</p>
            </div>
        `;
    }
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Animate message appearance
    requestAnimationFrame(() => {
        messageDiv.style.opacity = '1';
        messageDiv.style.transform = 'translateY(0)';
        messageDiv.style.animation = 'messageSlide 0.5s ease-out forwards';
    });
}

// Get contextual Monika response
function getMonikaResponse(message) {
    const lowerMessage = message.toLowerCase();
    
    // Check for specific keywords
    if (lowerMessage.includes('hi') || lowerMessage.includes('hello') || lowerMessage.includes('hey')) {
        return monikaResponses.greeting[Math.floor(Math.random() * monikaResponses.greeting.length)];
    }
    
    if (lowerMessage.includes('how are') || lowerMessage.includes('you ok') || lowerMessage.includes('feeling')) {
        return monikaResponses.howAreYou[Math.floor(Math.random() * monikaResponses.howAreYou.length)];
    }
    
    if (lowerMessage.includes('love') || lowerMessage.includes('like') || lowerMessage.includes('cute') || lowerMessage.includes('beautiful')) {
        return monikaResponses.love[Math.floor(Math.random() * monikaResponses.love.length)];
    }
    
    if (lowerMessage.includes('poem') || lowerMessage.includes('poetry')) {
        return monikaResponses.poem[Math.floor(Math.random() * monikaResponses.poem.length)];
    }
    
    // Default response
    return monikaResponses.default[Math.floor(Math.random() * monikaResponses.default.length)];
}

// Typing Indicator
function showTypingIndicator() {
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message monika typing-indicator';
    typingDiv.innerHTML = `
        <div class="avatar monika-avatar-small">
            <img src="monika.png" alt="Monika">
        </div>
        <div class="message-content">
            <div class="typing-dots">
                <span></span>
                <span></span>
                <span></span>
            </div>
            <p class="typing-text">Monika is typing</p>
        </div>
    `;
    
    chatMessages.appendChild(typingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Typing animation
    let dotIndex = 0;
    const typingInterval = setInterval(() => {
        typingDiv.querySelector('.typing-text').textContent = typingWords[dotIndex];
        dotIndex = (dotIndex + 1) % typingWords.length;
    }, 300);
    
    typingDiv.dataset.intervalId = typingInterval;
}

function hideTypingIndicator() {
    const typingIndicator = document.querySelector('.typing-indicator');
    if (typingIndicator) {
        clearInterval(typingIndicator.dataset.intervalId);
        typingIndicator.remove();
    }
}

// Particle Effects
function createParticles() {
    setInterval(() => {
        if (Math.random() > 0.7) {
            const particle = document.createElement('div');
            particle.className = 'particle';
            particle.style.left = Math.random() * 100 + '%';
            particle.style.animationDuration = (Math.random() * 3 + 3) + 's';
            particle.style.animationDelay = Math.random() * 2 + 's';
            document.querySelector('.particles').appendChild(particle);
            
            setTimeout(() => particle.remove(), 8000);
        }
    }, 300);
}

// Floating Hearts
function createFloatingHearts() {
    setInterval(() => {
        if (Math.random() > 0.8) {
            createHeart();
        }
    }, 4000);
}

function createHeart() {
    const heart = document.createElement('div');
    heart.className = 'heart';
    heart.innerHTML = ['💖', '💕', '💗', '🌸', '✨'][Math.floor(Math.random() * 5)];
    heart.style.left = Math.random() * 100 + '%';
    heart.style.animationDuration = (Math.random() * 3 + 4) + 's';
    heart.style.fontSize = (Math.random() * 0.8 + 1) + 'rem';
    
    floatingHeartsContainer.appendChild(heart);
    
    setTimeout(() => heart.remove(), 7000);
}

function createHeartBurst() {
    for (let i = 0; i < 8; i++) {
        setTimeout(() => createHeart(), i * 200);
    }
}

// Sparkle Effect
function playSparkleEffect() {
    for (let i = 0; i < 12; i++) {
        setTimeout(() => {
            const sparkle = document.createElement('div');
            sparkle.style.cssText = `
                position: fixed;
                width: 6px;
                height: 6px;
                background: #ffd93d;
                border-radius: 50%;
                left: ${Math.random() * 100}vw;
                top: ${Math.random() * 100}vh;
                pointer-events: none;
                z-index: 100;
                animation: sparkle 1s ease-out forwards;
            `;
            document.body.appendChild(sparkle);
            setTimeout(() => sparkle.remove(), 1000);
        }, i * 100);
    }
}

// Background Animation
function startBackgroundAnimation() {
    let hue = 240;
    setInterval(() => {
        hue = (hue + 1) % 360;
        document.body.style.background = `linear-gradient(135deg, hsl(${hue}, 60%, 60%), hsl(${hue + 30}, 60%, 50%))`;
    }, 5000);
}

// Easter Eggs
function setupEasterEggs() {
    let konamiCode = [];
    const konami = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65];
    
    document.addEventListener('keydown', (e) => {
        konamiCode.push(e.keyCode);
        if (konamiCode.length > konami.length) {
            konamiCode.shift();
        }
        
        if (konamiCode.toString() === konami.toString()) {
            triggerKonamiEffect();
            konamiCode = [];
        }
    });
}

function triggerKonamiEffect() {
    // Rainbow Monika mode!
    document.documentElement.style.setProperty('--rainbow-mode', 'true');
    
    // Special message
    addMessage("🌈🎉 KONAMI CODE DETECTED! Rainbow Monika mode activated! 💖✨ You're awesome!", 'monika');
    
    setTimeout(() => {
        document.documentElement.style.setProperty('--rainbow-mode', 'false');
    }, 10000);
}

// Initialization animations
function initAnimations() {
    // Entrance animations
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    });
    
    document.querySelectorAll('.message, .header, .chat-container').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = 'all 0.8s ease-out';
        observer.observe(el);
    });
}

// Add to CSS via JS for dynamic effects
const style = document.createElement('style');
style.textContent = `
    @keyframes sparkle {
        0% {
            transform: scale(0) rotate(0deg);
            opacity: 1;
        }
        100% {
            transform: scale(1) rotate(180deg);
            opacity: 0;
        }
    }
    
    .user-avatar {
        width: 50px;
        height: 50px;
        border-radius: 50%;
        background: linear-gradient(135deg, #667eea, #764ba2);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 1.2rem;
        box-shadow: 0 5px 15px rgba(0,0,0,0.3);
    }
    
    .typing-dots {
        display: flex;
        gap: 4px;
        margin-bottom: 8px;
    }
    
    .typing-dots span {
        width: 8px;
        height: 8px;
        background: #ff6b9d;
        border-radius: 50%;
        animation: typingDot 1.4s infinite ease-in-out;
    }
    
    .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
    .typing-dots span:nth-child(3) { animation-delay: 0.4s; }
    
    @keyframes typingDot {
        0%, 60%, 100% { transform: scale(1); }
        30% { transform: scale(1.5); }
    }
    
    :root {
        --rainbow-mode: false;
    }
    
    :root[style*="--rainbow-mode: true"] .title-gradient,
    :root[style*="--rainbow-mode: true"] .send-btn {
        animation: rainbow 0.5s linear infinite !important;
        background: linear-gradient(45deg, red, orange, yellow, green, blue, indigo, violet) !important;
        background-size: 400% 400% !important;
    }
    
    @keyframes rainbow {
        0% { background-position: 0% 50%; }
        100% { background-position: 400% 50%; }
    }
`;
document.head.appendChild(style);

// Smooth scroll for chat
chatMessages.addEventListener('scroll', () => {
    chatMessages.style.scrollBehavior = 'smooth';
});
