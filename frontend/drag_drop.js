// Drag and Drop implementation for Scopeboard Kanban

function setupDragAndDrop(onCardMoveCallback) {
    let draggedCard = null;
    let dropIndicator = document.createElement("div");
    dropIndicator.classList.add("drop-indicator");

    // Delegated event listener for cards starting to drag
    document.addEventListener("dragstart", (e) => {
        const card = e.target.closest(".kanban-card");
        if (!card) return;

        draggedCard = card;
        card.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", card.dataset.id);
    });

    document.addEventListener("dragend", (e) => {
        if (!draggedCard) return;
        draggedCard.classList.remove("dragging");
        
        // Cleanup any leftovers
        if (dropIndicator.parentNode) {
            dropIndicator.parentNode.removeChild(dropIndicator);
        }
        document.querySelectorAll(".card-stack").forEach(stack => {
            stack.classList.remove("dragover");
        });
        
        draggedCard = null;
    });

    // Column stack handlers
    document.addEventListener("dragover", (e) => {
        const stack = e.target.closest(".card-stack");
        if (!stack || !draggedCard) return;

        e.preventDefault();
        stack.classList.add("dragover");

        // Determine where to place the drop indicator
        const closestCardInfo = getClosestCard(stack, e.clientY);
        
        if (closestCardInfo.element) {
            stack.insertBefore(dropIndicator, closestCardInfo.element);
        } else {
            stack.appendChild(dropIndicator);
        }
    });

    document.addEventListener("dragleave", (e) => {
        const stack = e.target.closest(".card-stack");
        if (!stack) return;
        
        // Only remove dragover visual if leaving the stack area completely
        const related = e.relatedTarget ? e.relatedTarget.closest(".card-stack") : null;
        if (related !== stack) {
            stack.classList.remove("dragover");
        }
    });

    document.addEventListener("drop", async (e) => {
        const stack = e.target.closest(".card-stack");
        if (!stack || !draggedCard) return;

        e.preventDefault();
        stack.classList.remove("dragover");

        const cardId = parseInt(e.dataTransfer.getData("text/plain"));
        const targetColumnId = parseInt(stack.dataset.columnId);

        // Find the index position in the stack (where the indicator currently is)
        const cardsArray = Array.from(stack.querySelectorAll(".kanban-card:not(.dragging)"));
        let targetOrder = cardsArray.indexOf(dropIndicator);
        
        if (targetOrder === -1) {
            // Indicator might have been appended or is the last element
            const indicatorIndex = Array.from(stack.children).indexOf(dropIndicator);
            // Count cards before the indicator index
            targetOrder = 0;
            for (let i = 0; i < indicatorIndex; i++) {
                if (stack.children[i].classList.contains("kanban-card") && stack.children[i] !== draggedCard) {
                    targetOrder++;
                }
            }
        }

        // Clean up indicator
        if (dropIndicator.parentNode) {
            dropIndicator.parentNode.removeChild(dropIndicator);
        }

        // Invoke callback to notify app logic and hit API
        if (onCardMoveCallback) {
            await onCardMoveCallback(cardId, targetColumnId, targetOrder);
        }
    });

    // Helper to find closest card below mouse position
    function getClosestCard(stack, yMouse) {
        const cards = Array.from(stack.querySelectorAll(".kanban-card:not(.dragging)"));
        
        return cards.reduce((closest, card) => {
            const box = card.getBoundingClientRect();
            // Calculate center point of the card
            const offset = yMouse - (box.top + box.height / 2);
            
            // We are looking for card where offset < 0 (mouse is above card's center)
            // and we want the closest offset
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: card };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY, element: null });
    }
}
