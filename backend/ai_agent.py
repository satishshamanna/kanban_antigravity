import json
import urllib.request
import urllib.error
import re
from sqlalchemy.orm import Session
from backend.db import DBCard, DBColumn

SYSTEM_PROMPT = """You are an AI Project Assistant integrated into a premium Kanban board called Scopeboard.
Your job is to assist the user in managing their tasks. You have access to the current state of the board.
You can reply conversationally AND execute actions on the board by returning a list of structured commands.

You MUST respond strictly in JSON format. The JSON must contain two keys:
1. "reply": A string with your conversational response to the user. Keep it friendly, encouraging, and concise. Refer to team members by name.
2. "actions": A list of action objects. If no action is needed, return an empty list [].

Supported Actions:
- {"type": "add_card", "params": {"column_name": "To-Do", "title": "...", "description": "...", "priority": "Low/Medium/High", "due_date": "YYYY-MM-DD", "assignee_name": "...", "tags": "..."}}
- {"type": "move_card", "params": {"card_id": 123, "target_column_name": "In Progress"}}
- {"type": "delete_card", "params": {"card_id": 123}}
- {"type": "update_card", "params": {"card_id": 123, "updates": {"priority": "High", "description": "..."}}}
- {"type": "add_column", "params": {"name": "..."}}
- {"type": "delete_column", "params": {"column_name": "..."}}

Here is the current state of the Kanban Board (Columns and Cards):
{board_state_json}

The list of available team members for assignment:
- Olive Kenji (avatar: "olive")
- Robin Cooper (avatar: "robin")
- Maya Hart (avatar: "maya")
- Marcus Levin (avatar: "marcus")
- Alex Hill (avatar: "alex")
- Sophia Bennett (avatar: "sophia")

When adding or moving cards, match column names intelligently (e.g. "todo", "to do", "to-do" matches "To-Do"). If an action refers to a card, use the card's ID from the state. If creating a card and the user mentions an assignee, map it to one of the available team members above, and select their avatar key.

Remember to output ONLY valid JSON.
"""

def get_board_state_summary(db: Session):
    columns = db.query(DBColumn).order_by(DBColumn.order).all()
    state = []
    for col in columns:
        col_data = {
            "column_id": col.id,
            "column_name": col.name,
            "cards": []
        }
        for card in sorted(col.cards, key=lambda c: c.order):
            col_data["cards"].append({
                "card_id": card.id,
                "title": card.title,
                "description": card.description,
                "priority": card.priority,
                "due_date": card.due_date,
                "assignee": card.assignee_name,
                "tags": card.tags
            })
        state.append(col_data)
    return state

def run_gemini_query(api_key: str, prompt: str, board_state_str: str) -> dict:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
    
    full_system_instruction = SYSTEM_PROMPT.format(board_state_json=board_state_str)
    
    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}]
            }
        ],
        "systemInstruction": {
            "parts": [{"text": full_system_instruction}]
        },
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.2
        }
    }
    
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            text_content = res_data["candidates"][0]["content"]["parts"][0]["text"]
            return json.loads(text_content)
    except Exception as e:
        print(f"Error calling Gemini: {e}")
        return None

def fallback_rule_agent(prompt: str, board_state: list) -> dict:
    """A rule-based chatbot fallback when no API key is available."""
    prompt_lower = prompt.lower()
    
    # Predefined team members
    members = ["Olive Kenji", "Robin Cooper", "Maya Hart", "Marcus Levin", "Alex Hill", "Sophia Bennett"]
    
    # 1. ADD CARD
    # Pattern: add card "Title" to Column or add task Title to Column
    add_match = re.search(r'(?:add|create)\s+(?:task|card)\s+["\']?([^"\']+)["\']?\s+(?:to|in)\s+["\']?([^"\']+)["\']?', prompt_lower)
    if add_match:
        title = add_match.group(1).strip().title()
        col_name = add_match.group(2).strip().lower()
        
        # Match column
        target_col = None
        for col in board_state:
            if col["column_name"].lower() == col_name or col_name in col["column_name"].lower():
                target_col = col["column_name"]
                break
        if not target_col:
            target_col = "To-Do"
            
        # Parse priority if mentioned
        priority = "Medium"
        if "high" in prompt_lower:
            priority = "High"
        elif "low" in prompt_lower:
            priority = "Low"
            
        # Parse assignee if mentioned
        assignee = ""
        for m in members:
            if m.lower().split()[0] in prompt_lower:
                assignee = m
                break
                
        return {
            "reply": f"👍 Sure! I have scheduled the task '**{title}**' in the **{target_col}** column.",
            "actions": [{
                "type": "add_card",
                "params": {
                    "column_name": target_col,
                    "title": title,
                    "description": "Created via AI assistant shortcut.",
                    "priority": priority,
                    "due_date": "",
                    "assignee_name": assignee,
                    "tags": "AI Generated"
                }
            }]
        }

    # 2. MOVE CARD
    # Pattern: move task "Title" to Column
    move_match = re.search(r'move\s+(?:task|card)?\s*["\']?([^"\']+)["\']?\s+(?:to|in)\s+["\']?([^"\']+)["\']?', prompt_lower)
    if move_match:
        card_title_query = move_match.group(1).strip().lower()
        col_name = move_match.group(2).strip().lower()
        
        # Find card
        found_card_id = None
        found_card_title = ""
        for col in board_state:
            for card in col["cards"]:
                if card_title_query in card["title"].lower():
                    found_card_id = card["card_id"]
                    found_card_title = card["title"]
                    break
            if found_card_id:
                break
                
        # Find column
        target_col = None
        for col in board_state:
            if col["column_name"].lower() == col_name or col_name in col["column_name"].lower():
                target_col = col["column_name"]
                break
                
        if found_card_id and target_col:
            return {
                "reply": f"📦 Moved '**{found_card_title}**' to **{target_col}**.",
                "actions": [{
                    "type": "move_card",
                    "params": {
                        "card_id": found_card_id,
                        "target_column_name": target_col
                    }
                }]
            }
        elif not found_card_id:
            return {
                "reply": f"I couldn't find a card matching '{card_title_query}'. Could you clarify the name?",
                "actions": []
            }
        else:
            return {
                "reply": f"I couldn't find a column matching '{col_name}'. Please verify the column name.",
                "actions": []
            }

    # 3. DELETE CARD
    # Pattern: delete task "Title" or remove card "Title"
    del_match = re.search(r'(?:delete|remove)\s+(?:task|card)?\s*["\']?([^"\']+)["\']?', prompt_lower)
    if del_match:
        card_title_query = del_match.group(1).strip().lower()
        found_card_id = None
        found_card_title = ""
        for col in board_state:
            for card in col["cards"]:
                if card_title_query in card["title"].lower():
                    found_card_id = card["card_id"]
                    found_card_title = card["title"]
                    break
            if found_card_id:
                break
                
        if found_card_id:
            return {
                "reply": f"🗑️ Deleted the task '**{found_card_title}**' for you.",
                "actions": [{
                    "type": "delete_card",
                    "params": {
                        "card_id": found_card_id
                    }
                }]
            }
        else:
            return {
                "reply": f"I couldn't find any card matching '{card_title_query}' to delete.",
                "actions": []
            }

    # 4. LIST / SUMMARY OF BOARD
    if "list" in prompt_lower or "summary" in prompt_lower or "show" in prompt_lower or "what is" in prompt_lower:
        summary_lines = []
        for col in board_state:
            cards_in_col = col["cards"]
            if cards_in_col:
                summary_lines.append(f"• **{col['column_name']}** ({len(cards_in_col)} tasks):")
                for c in cards_in_col:
                    prio_indicator = "🔴" if c["priority"] == "High" else ("🟡" if c["priority"] == "Medium" else "🟢")
                    assignee_str = f" (assigned to {c['assignee']})" if c["assignee"] else ""
                    summary_lines.append(f"  - {prio_indicator} {c['title']}{assignee_str}")
            else:
                summary_lines.append(f"• **{col['column_name']}**: Empty")
                
        reply_msg = "Here is the summary of the board:\n\n" + "\n".join(summary_lines)
        return {
            "reply": reply_msg,
            "actions": []
        }

    # DEFAULT CHAT FALLBACK
    return {
        "reply": "Hello! I am your Scopeboard AI assistant. I can help you manage your board! Try asking me commands like:\n"
                 "- *'Add card \"Design Logo\" to To-Do'* (with 'high' or 'low' priority, and assign to 'Maya' or 'Robin')\n"
                 "- *'Move task \"Design Logo\" to In Progress'*\n"
                 "- *'Delete card \"Design Logo\"'*\n"
                 "- *'Show card summary'* to see what everyone is working on.",
        "actions": []
    }

def handle_ai_message(db: Session, prompt: str, user_api_key: str = None) -> dict:
    board_state = get_board_state_summary(db)
    board_state_str = json.dumps(board_state, indent=2)
    
    # Try calling Gemini if API key is provided
    if user_api_key:
        ai_response = run_gemini_query(user_api_key, prompt, board_state_str)
        if ai_response and "reply" in ai_response:
            return ai_response
            
    # Fall back to rule based agent
    return fallback_rule_agent(prompt, board_state)
