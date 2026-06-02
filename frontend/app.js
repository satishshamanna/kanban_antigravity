// Scopeboard Application Orchestrator

let boardData = [];
const teamMembers = [
    { name: "Olive Kenji", role: "Product Designer", key: "olive" },
    { name: "Robin Cooper", role: "Content Specialist", key: "robin" },
    { name: "Maya Hart", nameLower: "maya", role: "Brand Strategist", key: "maya" },
    { name: "Marcus Levin", role: "CRM Coordinator", key: "marcus" },
    { name: "Alex Hill", role: "SEO Auditor", key: "alex" },
    { name: "Sophia Bennett", role: "Social Manager", key: "sophia" }
];

// Map of assignee avatars
function getAvatarHTML(name) {
    const matched = teamMembers.find(m => m.name.toLowerCase() === (name || "").toLowerCase());
    const key = matched ? matched.key : "default";
    const initials = name ? name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : '?';
    
    const colors = {
        olive: "#10b981",
        robin: "#ec4899",
        maya: "#8b5cf6",
        marcus: "#0ea5e9",
        alex: "#f59e0b",
        sophia: "#6366f1",
        default: "#94a3b8"
    };
    const color = colors[key] || colors.default;
    return `<div class="avatar-img" style="background-color: ${color}">${initials}</div>`;
}

document.addEventListener("DOMContentLoaded", () => {
    initApp();
});

function initApp() {
    // Render static workspace elements
    renderInteractionsList();
    renderHeaderAvatars();
    
    // Tab Navigation setup
    setupTabs();
    
    // Drawer setup
    setupAIDrawer();
    
    // Load board data
    fetchBoard();

    // Setup drag and drop
    setupDragAndDrop(handleCardMove);

    // AI Chat Setup
    initAIChat((appliedActions) => {
        // Callback when AI applies actions on the board
        fetchBoard(); // Reload board
        appliedActions.forEach(act => {
            showToast(`AI Command: ${act}`);
        });
    });

    // Form Modals Setup
    setupModals();

    // Search bar event
    const searchInput = document.getElementById("search-input");
    searchInput.addEventListener("input", filterCards);

    // Columns additions
    document.getElementById("btn-add-column").addEventListener("click", handleAddColumn);
    
    // Settings logic
    setupSettings();
}

// Fetch board state from server
async function fetchBoard() {
    try {
        const res = await fetch("/api/board");
        boardData = await res.json();
        renderBoard();
        calculateProgress();
        
        // If team tab is active, re-render team card lists to reflect updated task counts
        if (document.querySelector(".nav-item[data-tab='team']").classList.contains("active")) {
            renderTeamTab();
        }
    } catch (err) {
        console.error("Error fetching board data", err);
        showToast("Error connecting to server. Please ensure the backend is running.");
    }
}

// Render Kanban Grid
function renderBoard() {
    const grid = document.getElementById("kanban-grid");
    grid.innerHTML = "";

    boardData.forEach(column => {
        const colEl = document.createElement("div");
        colEl.classList.add("kanban-column");
        colEl.dataset.id = column.id;

        // Render header
        colEl.innerHTML = `
            <div class="column-header">
                <div class="column-title-wrapper">
                    <span class="column-title">${column.name}</span>
                    <span class="column-badge">${column.cards.length}</span>
                </div>
                <div class="column-actions">
                    <button class="btn-col-action btn-add-card-shortcut" data-column-id="${column.id}" title="Add Card">
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    </button>
                    <button class="btn-col-action btn-delete-column" data-column-id="${column.id}" data-column-name="${column.name}" title="Delete Column">
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                    </button>
                </div>
            </div>
            <div class="card-stack" data-column-id="${column.id}"></div>
        `;

        const stack = colEl.querySelector(".card-stack");

        // Render cards
        column.cards.forEach(card => {
            const cardEl = document.createElement("div");
            cardEl.classList.add("kanban-card");
            cardEl.draggable = true;
            cardEl.dataset.id = card.id;
            
            const prioClass = `prio-${card.priority.toLowerCase()}`;
            
            // Check overdue
            let isOverdue = false;
            let dateLabel = card.due_date;
            if (card.due_date) {
                const today = new Date().toISOString().split('T')[0];
                if (card.due_date < today && column.name.toLowerCase() !== "done") {
                    isOverdue = true;
                }
                // Format Date nicely
                try {
                    const parts = card.due_date.split('-');
                    if (parts.length === 3) {
                        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                        dateLabel = `${months[parseInt(parts[1])-1]} ${parseInt(parts[2])}, ${parts[0]}`;
                    }
                } catch(e) {}
            }

            // Checklist attributes counts
            const totalSub = card.subtasks.length;
            const completedSub = card.subtasks.filter(s => s.completed).length;
            const subtaskAttr = totalSub > 0 ? `
                <div class="attr-item" title="Checklist progress">
                    <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    <span>${completedSub}/${totalSub}</span>
                </div>
            ` : "";

            const fileAttr = card.files_count > 0 ? `
                <div class="attr-item" title="Attached Files">
                    <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                    <span>${card.files_count} files</span>
                </div>
            ` : "";

            // Tag list rendering
            const tagsHTML = card.tags ? card.tags.split(",").map(t => `<span class="tag-label">${t.trim()}</span>`).join("") : "";

            // Subtask inline checklist items (first 3)
            let subtaskListHTML = "";
            if (totalSub > 0) {
                const subitems = card.subtasks.slice(0, 3).map((sub, sIdx) => `
                    <div class="card-checklist-item ${sub.completed ? 'completed' : ''}" data-card-id="${card.id}" data-sub-idx="${sIdx}">
                        <input type="checkbox" ${sub.completed ? 'checked' : ''}>
                        <span>${sub.title}</span>
                    </div>
                `).join("");
                
                subtaskListHTML = `
                    <div class="card-checklist-container">
                        <div class="card-checklist-title">Checklist</div>
                        ${subitems}
                        ${totalSub > 3 ? `<div style="font-size:10px; color:var(--text-light); margin-top:4px;">+ ${totalSub - 3} more items</div>` : ""}
                    </div>
                `;
            }

            cardEl.innerHTML = `
                <div class="card-header">
                    <span class="prio-badge ${prioClass}">${card.priority} Priority</span>
                    <button class="btn-card-edit" data-id="${card.id}">
                        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>
                    </button>
                </div>
                <h3 class="card-title">${card.title}</h3>
                <p class="card-desc">${card.description || "No description provided."}</p>
                
                ${subtaskListHTML}

                <div class="card-attributes">
                    ${fileAttr}
                    ${subtaskAttr}
                    ${tagsHTML}
                </div>

                <div class="card-meta">
                    <div class="assignee-info">
                        ${card.assignee_name ? getAvatarHTML(card.assignee_name) : `<div class="avatar-img" style="background-color: var(--text-light)">?</div>`}
                        <span class="assignee-name">${card.assignee_name || "Unassigned"}</span>
                    </div>
                    ${card.due_date ? `
                        <div class="due-date ${isOverdue ? 'overdue' : ''}">
                            <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                            <span>${dateLabel}</span>
                        </div>
                    ` : ""}
                </div>
            `;

            // Bind click to edit
            cardEl.querySelector(".btn-card-edit").addEventListener("click", (e) => {
                e.stopPropagation();
                openEditCardModal(card);
            });
            cardEl.addEventListener("click", () => {
                openEditCardModal(card);
            });

            // Bind inline checklist check/uncheck
            cardEl.querySelectorAll(".card-checklist-item").forEach(item => {
                item.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    const cardId = parseInt(item.dataset.cardId);
                    const subIdx = parseInt(item.dataset.subIdx);
                    await toggleSubtaskCompletion(cardId, subIdx);
                });
            });

            stack.appendChild(cardEl);
        });

        // Bind shortcut column click addition
        colEl.querySelector(".btn-add-card-shortcut").addEventListener("click", (e) => {
            e.stopPropagation();
            openAddCardModal(column.id);
        });

        // Bind column deletion click
        colEl.querySelector(".btn-delete-column").addEventListener("click", (e) => {
            e.stopPropagation();
            const colId = e.currentTarget.dataset.columnId;
            const colName = e.currentTarget.dataset.columnName;
            handleDeleteColumn(colId, colName);
        });

        grid.appendChild(colEl);
    });
}

// Toggle inline card subtask completion state
async function toggleSubtaskCompletion(cardId, subIdx) {
    // Find card in local state
    let card = null;
    for (let col of boardData) {
        card = col.cards.find(c => c.id === cardId);
        if (card) break;
    }
    if (!card) return;

    // Toggle complete
    card.subtasks[subIdx].completed = !card.subtasks[subIdx].completed;

    try {
        const res = await fetch(`/api/cards/${cardId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                subtasks: JSON.stringify(card.subtasks)
            })
        });
        if (res.ok) {
            fetchBoard();
        }
    } catch (err) {
        console.error(err);
    }
}

// Drag and drop callback to move card
async function handleCardMove(cardId, targetColumnId, order) {
    try {
        const res = await fetch(`/api/cards/${cardId}/move`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                column_id: targetColumnId,
                order: order
            })
        });
        if (res.ok) {
            // Update local state and re-render
            fetchBoard();
            showToast("Task reordered successfully.");
        } else {
            showToast("Failed to move card.");
        }
    } catch (err) {
        console.error(err);
    }
}

// Calculate progress percentage
function calculateProgress() {
    let totalCards = 0;
    let doneCards = 0;

    boardData.forEach(col => {
        totalCards += col.cards.length;
        if (col.name.toLowerCase() === "done") {
            doneCards += col.cards.length;
        }
    });

    const percent = totalCards > 0 ? Math.round((doneCards / totalCards) * 100) : 0;
    
    // Update DOM
    document.getElementById("progress-percentage").innerText = `${percent}%`;
    document.getElementById("progress-bar-fill").style.width = `${percent}%`;
}

// Search bar filters
function filterCards() {
    const query = document.getElementById("search-input").value.toLowerCase();
    const cards = document.querySelectorAll(".kanban-card");

    cards.forEach(cardEl => {
        const title = cardEl.querySelector(".card-title").innerText.toLowerCase();
        const desc = cardEl.querySelector(".card-desc").innerText.toLowerCase();
        
        // Find tags
        const tags = Array.from(cardEl.querySelectorAll(".tag-label")).map(t => t.innerText.toLowerCase()).join(" ");

        if (title.includes(query) || desc.includes(query) || tags.includes(query)) {
            cardEl.style.display = "block";
        } else {
            cardEl.style.display = "none";
        }
    });
}

// Tab router routing logic
function setupTabs() {
    const navItems = document.querySelectorAll(".nav-item");
    const contents = document.querySelectorAll(".tab-content");

    navItems.forEach(item => {
        item.addEventListener("click", () => {
            const tab = item.dataset.tab;
            
            navItems.forEach(i => i.classList.remove("active"));
            item.classList.add("active");

            contents.forEach(c => {
                c.classList.remove("active");
                if (c.id === `tab-${tab}`) {
                    c.classList.add("active");
                }
            });

            // Extra trigger actions per tab
            if (tab === "team") {
                renderTeamTab();
            }
        });
    });
}

// Draw/Drawer slider triggers
function setupAIDrawer() {
    const drawer = document.getElementById("ai-drawer");
    const openBtn = document.getElementById("btn-ask-ai-quick");
    const closeBtn = document.getElementById("btn-close-drawer");

    openBtn.addEventListener("click", () => {
        drawer.classList.add("active");
    });

    closeBtn.addEventListener("click", () => {
        drawer.classList.remove("active");
    });
}

// Custom Modals handling (Add/Edit)
let subtaskChecklistBuilderArray = [];
let activeCardOriginalColumnId = null;

function populateColumnSelect(selectedColumnId) {
    const select = document.getElementById("card-modal-column-select");
    select.innerHTML = "";
    boardData.forEach(col => {
        const option = document.createElement("option");
        option.value = col.id;
        option.textContent = col.name;
        if (col.id === selectedColumnId) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

function setupModals() {
    const modal = document.getElementById("card-modal");
    const closeBtn = document.getElementById("btn-close-modal");
    const cancelBtn = document.getElementById("btn-cancel-modal");
    const form = document.getElementById("card-form");
    const deleteBtn = document.getElementById("btn-delete-card-modal");
    const addSubtaskBtn = document.getElementById("btn-add-subtask-item");
    const addGlobalBtn = document.getElementById("btn-add-task-global");

    closeBtn.addEventListener("click", () => closeModal());
    cancelBtn.addEventListener("click", () => closeModal());
    
    if (addGlobalBtn) {
        addGlobalBtn.addEventListener("click", () => {
            const defaultColId = boardData.length > 0 ? boardData[0].id : null;
            openAddCardModal(defaultColId);
        });
    }

    // Subtask item add trigger
    addSubtaskBtn.addEventListener("click", () => {
        subtaskChecklistBuilderArray.push({ title: "", completed: false });
        renderSubtaskBuilderList();
    });

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const cardId = document.getElementById("card-modal-id").value;
        const columnId = parseInt(document.getElementById("card-modal-column-select").value);

        // Clean up empty subtasks
        const cleanSubtasks = subtaskChecklistBuilderArray
            .filter(sub => sub.title.trim() !== "")
            .map(sub => ({ title: sub.title, completed: sub.completed }));

        const payload = {
            title: document.getElementById("card-title-input").value,
            description: document.getElementById("card-desc-input").value,
            priority: document.getElementById("card-priority-input").value,
            due_date: document.getElementById("card-date-input").value,
            assignee_name: document.getElementById("card-assignee-input").value,
            tags: document.getElementById("card-tags-input").value,
            files_count: parseInt(document.getElementById("card-files-input").value) || 0,
            subtasks: JSON.stringify(cleanSubtasks)
        };

        try {
            if (cardId) {
                // If target column changed, move it first
                if (columnId !== activeCardOriginalColumnId) {
                    await fetch(`/api/cards/${cardId}/move`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ column_id: columnId, order: 9999 })
                    });
                }

                // Update details
                const res = await fetch(`/api/cards/${cardId}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    showToast("Card updated.");
                }
            } else {
                // Create
                payload.column_id = columnId;
                const res = await fetch("/api/cards", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    showToast("Card created.");
                }
            }
            closeModal();
            fetchBoard();
        } catch (err) {
            console.error(err);
        }
    });

    // Delete Card button handler
    deleteBtn.addEventListener("click", async () => {
        const cardId = document.getElementById("card-modal-id").value;
        if (!cardId) return;

        if (confirm("Are you sure you want to delete this task?")) {
            try {
                const res = await fetch(`/api/cards/${cardId}`, {
                    method: "DELETE"
                });
                if (res.ok) {
                    showToast("Card deleted.");
                    closeModal();
                    fetchBoard();
                }
            } catch (err) {
                console.error(err);
            }
        }
    });
}

function openAddCardModal(columnId) {
    const modal = document.getElementById("card-modal");
    document.getElementById("modal-title").innerText = "Add Task";
    document.getElementById("card-modal-id").value = "";
    
    populateColumnSelect(columnId);

    // Reset Form fields
    document.getElementById("card-title-input").value = "";
    document.getElementById("card-desc-input").value = "";
    document.getElementById("card-priority-input").value = "Medium";
    document.getElementById("card-date-input").value = "";
    document.getElementById("card-assignee-input").value = "";
    document.getElementById("card-tags-input").value = "";
    document.getElementById("card-files-input").value = "0";
    
    // Reset subtask builder
    subtaskChecklistBuilderArray = [];
    renderSubtaskBuilderList();

    document.getElementById("btn-delete-card-modal").style.display = "none";
    modal.classList.add("active");
}

function openEditCardModal(card) {
    const modal = document.getElementById("card-modal");
    document.getElementById("modal-title").innerText = "Edit Task";
    document.getElementById("card-modal-id").value = card.id;
    
    activeCardOriginalColumnId = card.column_id;
    populateColumnSelect(card.column_id);

    // Populate Fields
    document.getElementById("card-title-input").value = card.title;
    document.getElementById("card-desc-input").value = card.description;
    document.getElementById("card-priority-input").value = card.priority;
    document.getElementById("card-date-input").value = card.due_date;
    document.getElementById("card-assignee-input").value = card.assignee_name;
    document.getElementById("card-tags-input").value = card.tags;
    document.getElementById("card-files-input").value = card.files_count || 0;

    // Set subtask checklist array
    subtaskChecklistBuilderArray = Array.isArray(card.subtasks) ? [...card.subtasks] : [];
    renderSubtaskBuilderList();

    document.getElementById("btn-delete-card-modal").style.display = "block";
    modal.classList.add("active");
}

function closeModal() {
    const modal = document.getElementById("card-modal");
    modal.classList.remove("active");
}

function renderSubtaskBuilderList() {
    const container = document.getElementById("subtasks-list-builder");
    container.innerHTML = "";

    subtaskChecklistBuilderArray.forEach((item, index) => {
        const itemEl = document.createElement("div");
        itemEl.classList.add("subtask-item-builder");
        itemEl.innerHTML = `
            <input type="checkbox" ${item.completed ? "checked" : ""}>
            <input type="text" placeholder="Checklist item description..." value="${item.title}">
            <button type="button" class="btn-remove-subtask" data-index="${index}">Delete</button>
        `;

        // Checkbox toggle
        itemEl.querySelector('input[type="checkbox"]').addEventListener("change", (e) => {
            subtaskChecklistBuilderArray[index].completed = e.target.checked;
        });

        // Text input modification
        itemEl.querySelector('input[type="text"]').addEventListener("input", (e) => {
            subtaskChecklistBuilderArray[index].title = e.target.value;
        });

        // Delete item trigger
        itemEl.querySelector('.btn-remove-subtask').addEventListener("click", () => {
            subtaskChecklistBuilderArray.splice(index, 1);
            renderSubtaskBuilderList();
        });

        container.appendChild(itemEl);
    });
}

// Add a column dynamically
async function handleAddColumn() {
    const name = prompt("Enter the name of the new column:");
    if (!name || !name.trim()) return;

    try {
        const res = await fetch("/api/columns", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: name.trim() })
        });
        if (res.ok) {
            fetchBoard();
            showToast(`Column '${name}' created.`);
        }
    } catch (err) {
        console.error(err);
    }
}

// Delete column dynamically
async function handleDeleteColumn(colId, colName) {
    if (!confirm(`Are you sure you want to delete column '${colName}'? All tasks in this column will be permanently deleted.`)) return;

    try {
        const res = await fetch(`/api/columns/${colId}`, {
            method: "DELETE"
        });
        if (res.ok) {
            fetchBoard();
            showToast(`Column '${colName}' deleted.`);
        }
    } catch (err) {
        console.error(err);
    }
}

// Render interactions list in sidebar
function renderInteractionsList() {
    const list = document.getElementById("interactions-list");
    list.innerHTML = "";

    const interactions = [
        { name: "Robin Cooper", time: "2 min ago", key: "robin" },
        { name: "Olive Kenji", time: "40 min ago", key: "olive" },
        { name: "Sophia Bennett", time: "4 hours ago", key: "sophia" },
        { name: "Marcus Levin", time: "2 days ago", key: "marcus" },
        { name: "Maya Hart", time: "5 days ago", key: "maya" }
    ];

    interactions.forEach(item => {
        const div = document.createElement("div");
        div.classList.add("interaction-item");
        div.innerHTML = `
            <div class="member-avatar-wrapper">
                ${getAvatarHTML(item.name)}
                <div class="status-dot online"></div>
            </div>
            <div class="interaction-details">
                <span class="interaction-name">${item.name}</span>
                <span class="interaction-time">${item.time}</span>
            </div>
        `;
        list.appendChild(div);
    });
}

// Render dynamic project avatars in header
function renderHeaderAvatars() {
    const container = document.getElementById("header-member-avatars");
    container.innerHTML = "";
    // Display first 4 members
    teamMembers.slice(0, 4).forEach(m => {
        container.innerHTML += getAvatarHTML(m.name);
    });
}

// Render dynamic profiles in Team tab
function renderTeamTab() {
    const grid = document.getElementById("team-grid");
    grid.innerHTML = "";

    teamMembers.forEach(member => {
        // Calculate total tasks and done tasks for this member
        let total = 0;
        let done = 0;
        boardData.forEach(col => {
            const memberCards = col.cards.filter(c => c.assignee_name.toLowerCase() === member.name.toLowerCase());
            total += memberCards.length;
            if (col.name.toLowerCase() === "done") {
                done += memberCards.length;
            }
        });

        const card = document.createElement("div");
        card.classList.add("team-card");
        card.innerHTML = `
            ${getAvatarHTML(member.name)}
            <div class="team-member-name">${member.name}</div>
            <div class="team-member-role">${member.role}</div>
            <div class="team-member-stats">
                <div class="stat-item">
                    <span class="stat-val">${total}</span>
                    <span class="stat-lbl">Tasks</span>
                </div>
                <div class="stat-item">
                    <span class="stat-val">${done}</span>
                    <span class="stat-lbl">Completed</span>
                </div>
            </div>
        `;
        
        // Large avatar customization inside card
        const img = card.querySelector(".avatar-img");
        img.style.width = "54px";
        img.style.height = "54px";
        img.style.borderRadius = "50%";
        img.style.fontSize = "20px";
        
        grid.appendChild(card);
    });
}

// Settings setup (Gemini key storage)
function setupSettings() {
    const saveBtn = document.getElementById("btn-save-settings");
    const keyInput = document.getElementById("settings-api-key");
    const resetBtn = document.getElementById("btn-reset-db");

    // Load key from LocalStorage
    const key = localStorage.getItem("gemini_api_key");
    if (key) {
        keyInput.value = key;
    }

    saveBtn.addEventListener("click", () => {
        const val = keyInput.value.trim();
        localStorage.setItem("gemini_api_key", val);
        showToast("Gemini API Key saved locally.");
    });

    resetBtn.addEventListener("click", async () => {
        if (confirm("This will clear all changes and restore original mock columns and tasks. Proceed?")) {
            try {
                // To reset we can just send request to clear database or trigger reset route.
                // Let's implement a quick API reset on the backend.
                // We'll write a PUT reset in backend.
                const res = await fetch("/api/reset", { method: "POST" });
                if (res.ok) {
                    showToast("Database has been reset to defaults.");
                    fetchBoard();
                }
            } catch (err) {
                console.error(err);
            }
        }
    });
}
