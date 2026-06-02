// AI Chat Assistant client logic for Scopeboard

const chatState = {
    messages: []
};

// Quick chips suggestions
const SUGGESTION_CHIPS = [
    { text: "📊 Summarize board", prompt: "Summarize the current board state" },
    { text: "➕ Add 'Setup database' to To-Do", prompt: "Add a high priority task titled 'Setup database' to the To-Do column assigned to Alex Hill" },
    { text: "📦 Move 'SEO audit' to In Progress", prompt: "Move task 'SEO audit' to In Progress" },
    { text: "🧹 Clear history", action: "clear" }
];

function initAIChat(onBoardActionTriggered) {
    const drawerInput = document.getElementById("drawer-chat-input");
    const drawerSend = document.getElementById("btn-send-drawer");
    const drawerMessages = document.getElementById("drawer-messages");
    const drawerSuggestions = document.getElementById("drawer-suggestions");

    const tabInput = document.getElementById("chat-input-tab");
    const tabSend = document.getElementById("btn-send-tab");
    const tabMessages = document.getElementById("chat-messages-tab");
    const tabSuggestions = document.getElementById("chat-suggestions-tab");
    const clearTabBtn = document.getElementById("btn-clear-chat-tab");

    // Load initial chat history
    loadChatHistory();

    // Render suggestion chips
    renderChips();

    // Event listeners for inputs
    drawerSend.addEventListener("click", () => sendMessage(drawerInput.value, "drawer"));
    drawerInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") sendMessage(drawerInput.value, "drawer");
    });

    tabSend.addEventListener("click", () => sendMessage(tabInput.value, "tab"));
    tabInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") sendMessage(tabInput.value, "tab");
    });

    if (clearTabBtn) {
        clearTabBtn.addEventListener("click", clearChatHistory);
    }

    async function loadChatHistory() {
        try {
            const res = await fetch("/api/chat/history");
            const data = await res.json();
            chatState.messages = data;
            renderMessages();
        } catch (err) {
            console.error("Failed to load chat history", err);
        }
    }

    function renderMessages() {
        // Clear message areas
        drawerMessages.innerHTML = "";
        tabMessages.innerHTML = "";

        if (chatState.messages.length === 0) {
            const welcomeMsg = {
                sender: "ai",
                message: "👋 Hello! I am your Scopeboard AI assistant. I can write and update cards for you using natural language.\n\nTry telling me something like:\n*\"Add task 'Review campaign tags' with high priority to To-Do and assign it to Maya\"* or *\"Move landing page draft to Done\"*."
            };
            appendMessageHTML(welcomeMsg);
            return;
        }

        chatState.messages.forEach(msg => {
            appendMessageHTML(msg);
        });

        scrollToBottom();
    }

    function appendMessageHTML(msg) {
        const dBubble = createBubbleElement(msg);
        const tBubble = createBubbleElement(msg);
        
        drawerMessages.appendChild(dBubble);
        tabMessages.appendChild(tBubble);
    }

    function createBubbleElement(msg) {
        const bubble = document.createElement("div");
        bubble.classList.add("msg-bubble", msg.sender);
        
        // Render simple markdown bolding and linebreaks
        let formatted = msg.message
            .replace(/\n/g, "<br>")
            .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
            .replace(/\*(.*?)\*/g, "<em>$1</em>");
            
        bubble.innerHTML = formatted;
        return bubble;
    }

    function renderChips() {
        drawerSuggestions.innerHTML = "";
        tabSuggestions.innerHTML = "";

        SUGGESTION_CHIPS.forEach(chip => {
            const dBtn = document.createElement("button");
            dBtn.classList.add("suggestion-chip");
            dBtn.innerText = chip.text;
            dBtn.addEventListener("click", () => handleChipClick(chip, "drawer"));

            const tBtn = document.createElement("button");
            tBtn.classList.add("suggestion-chip");
            tBtn.innerText = chip.text;
            tBtn.addEventListener("click", () => handleChipClick(chip, "tab"));

            drawerSuggestions.appendChild(dBtn);
            tabSuggestions.appendChild(tBtn);
        });
    }

    function handleChipClick(chip, source) {
        if (chip.action === "clear") {
            clearChatHistory();
        } else if (chip.prompt) {
            sendMessage(chip.prompt, source);
        }
    }

    async function sendMessage(text, source) {
        if (!text.trim()) return;

        // Clear input element
        if (source === "drawer") drawerInput.value = "";
        else tabInput.value = "";

        // Append user message locally
        const userMsg = { sender: "user", message: text };
        chatState.messages.push(userMsg);
        appendMessageHTML(userMsg);
        scrollToBottom();

        // Append temporary typing indicator
        const typingMsg = { sender: "ai", message: "⚡ AI is updates board..." };
        const dTyping = createBubbleElement(typingMsg);
        const tTyping = createBubbleElement(typingMsg);
        dTyping.classList.add("typing-indicator");
        tTyping.classList.add("typing-indicator");
        
        drawerMessages.appendChild(dTyping);
        tabMessages.appendChild(tTyping);
        scrollToBottom();

        // Fetch API Key from settings
        const apiKey = localStorage.getItem("gemini_api_key") || "";

        try {
            const res = await fetch("/api/chat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Gemini-API-Key": apiKey
                },
                body: JSON.stringify({ prompt: text })
            });

            // Remove typing indicators
            dTyping.remove();
            tTyping.remove();

            if (!res.ok) throw new Error("Server responded with error");
            const data = await res.json();

            // Append AI response
            const aiMsg = { sender: "ai", message: data.reply };
            chatState.messages.push(aiMsg);
            appendMessageHTML(aiMsg);
            scrollToBottom();

            // If actions were applied, trigger callback to refresh the board UI
            if (data.actions_applied && data.actions_applied.length > 0) {
                if (onBoardActionTriggered) {
                    onBoardActionTriggered(data.actions_applied);
                }
            }

        } catch (err) {
            console.error(err);
            dTyping.remove();
            tTyping.remove();
            
            const errorMsg = { sender: "ai", message: "⚠️ Error sending message. Please make sure the backend server is running." };
            chatState.messages.push(errorMsg);
            appendMessageHTML(errorMsg);
            scrollToBottom();
        }
    }

    async function clearChatHistory() {
        if (!confirm("Are you sure you want to clear AI chat history?")) return;
        try {
            await fetch("/api/chat/clear", { method: "POST" });
            chatState.messages = [];
            renderMessages();
            showToast("AI Chat history cleared");
        } catch (err) {
            console.error(err);
        }
    }

    function scrollToBottom() {
        drawerMessages.scrollTop = drawerMessages.scrollHeight;
        tabMessages.scrollTop = tabMessages.scrollHeight;
    }
}

// Global Toast utility
function showToast(message) {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.classList.add("toast");
    toast.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <span>${message}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 4000);
}
