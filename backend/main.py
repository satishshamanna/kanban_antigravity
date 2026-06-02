import os
import json
from fastapi import FastAPI, Depends, HTTPException, Header, status
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional

from backend.db import init_db, get_db, DBColumn, DBCard, DBChatMessage
from backend.ai_agent import handle_ai_message

app = FastAPI(title="Scopeboard Kanban Server")

# Models for Request Bodies
class CardCreate(BaseModel):
    column_id: int
    title: str
    description: Optional[str] = ""
    priority: Optional[str] = "Low"
    due_date: Optional[str] = ""
    assignee_name: Optional[str] = ""
    assignee_avatar: Optional[str] = ""
    tags: Optional[str] = ""
    subtasks: Optional[str] = "[]"
    files_count: Optional[int] = 0

class CardUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    due_date: Optional[str] = None
    assignee_name: Optional[str] = None
    assignee_avatar: Optional[str] = None
    tags: Optional[str] = None
    subtasks: Optional[str] = None
    files_count: Optional[int] = None

class CardMove(BaseModel):
    column_id: int
    order: int

class ColumnCreate(BaseModel):
    name: str

class ColumnUpdate(BaseModel):
    name: str

class ChatPrompt(BaseModel):
    prompt: str

# Helper to reorder cards in a column
def reorder_column_cards(db: Session, column_id: int):
    cards = db.query(DBCard).filter(DBCard.column_id == column_id).order_by(DBCard.order, DBCard.id).all()
    for idx, card in enumerate(cards):
        card.order = idx
    db.commit()

# --- API Endpoints ---

@app.get("/api/board")
def get_board(db: Session = Depends(get_db)):
    columns = db.query(DBColumn).order_by(DBColumn.order).all()
    result = []
    for col in columns:
        col_cards = sorted(col.cards, key=lambda c: c.order)
        cards_list = []
        for card in col_cards:
            try:
                subtasks_parsed = json.loads(card.subtasks)
            except Exception:
                subtasks_parsed = []
            cards_list.append({
                "id": card.id,
                "column_id": card.column_id,
                "title": card.title,
                "description": card.description,
                "priority": card.priority,
                "due_date": card.due_date,
                "assignee_name": card.assignee_name,
                "assignee_avatar": card.assignee_avatar,
                "tags": card.tags,
                "subtasks": subtasks_parsed,
                "files_count": card.files_count,
                "order": card.order
            })
        result.append({
            "id": col.id,
            "name": col.name,
            "order": col.order,
            "cards": cards_list
        })
    return result

@app.post("/api/columns")
def create_column(payload: ColumnCreate, db: Session = Depends(get_db)):
    max_order = db.query(DBColumn).count()
    new_col = DBColumn(name=payload.name, order=max_order)
    db.add(new_col)
    db.commit()
    db.refresh(new_col)
    return new_col

@app.put("/api/columns/{column_id}")
def update_column(column_id: int, payload: ColumnUpdate, db: Session = Depends(get_db)):
    col = db.query(DBColumn).filter(DBColumn.id == column_id).first()
    if not col:
        raise HTTPException(status_code=404, detail="Column not found")
    col.name = payload.name
    db.commit()
    return col

@app.delete("/api/columns/{column_id}")
def delete_column(column_id: int, db: Session = Depends(get_db)):
    col = db.query(DBColumn).filter(DBColumn.id == column_id).first()
    if not col:
        raise HTTPException(status_code=404, detail="Column not found")
    db.delete(col)
    db.commit()
    # Re-order remaining columns
    remaining = db.query(DBColumn).order_by(DBColumn.order).all()
    for idx, c in enumerate(remaining):
        c.order = idx
    db.commit()
    return {"status": "success"}

@app.post("/api/cards")
def create_card(payload: CardCreate, db: Session = Depends(get_db)):
    # Check if column exists
    col = db.query(DBColumn).filter(DBColumn.id == payload.column_id).first()
    if not col:
        raise HTTPException(status_code=404, detail="Column not found")
    
    # Get max order in column
    max_order = db.query(DBCard).filter(DBCard.column_id == payload.column_id).count()
    
    new_card = DBCard(
        column_id=payload.column_id,
        title=payload.title,
        description=payload.description,
        priority=payload.priority,
        due_date=payload.due_date,
        assignee_name=payload.assignee_name,
        assignee_avatar=payload.assignee_avatar,
        tags=payload.tags,
        subtasks=payload.subtasks,
        files_count=payload.files_count,
        order=max_order
    )
    db.add(new_card)
    db.commit()
    db.refresh(new_card)
    return new_card

@app.put("/api/cards/{card_id}")
def update_card(card_id: int, payload: CardUpdate, db: Session = Depends(get_db)):
    card = db.query(DBCard).filter(DBCard.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
        
    for key, val in payload.dict(exclude_unset=True).items():
        setattr(card, key, val)
        
    db.commit()
    db.refresh(card)
    return card

@app.delete("/api/cards/{card_id}")
def delete_card(card_id: int, db: Session = Depends(get_db)):
    card = db.query(DBCard).filter(DBCard.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    column_id = card.column_id
    db.delete(card)
    db.commit()
    reorder_column_cards(db, column_id)
    return {"status": "success"}

@app.put("/api/cards/{card_id}/move")
def move_card(card_id: int, payload: CardMove, db: Session = Depends(get_db)):
    card = db.query(DBCard).filter(DBCard.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
        
    old_column_id = card.column_id
    new_column_id = payload.column_id
    target_order = payload.order
    
    # Check if target column exists
    target_col = db.query(DBColumn).filter(DBColumn.id == new_column_id).first()
    if not target_col:
        raise HTTPException(status_code=404, detail="Target column not found")
        
    # Get all other cards in the target column
    target_cards = db.query(DBCard).filter(
        DBCard.column_id == new_column_id,
        DBCard.id != card_id
    ).order_by(DBCard.order, DBCard.id).all()
    
    # Update this card's column
    card.column_id = new_column_id
    
    # Insert card into target_cards list at target_order
    target_cards.insert(target_order, card)
    
    # Reassign orders
    for idx, tc in enumerate(target_cards):
        tc.order = idx
        
    db.commit()
    
    # If moved to a different column, reorder the old column as well
    if old_column_id != new_column_id:
        reorder_column_cards(db, old_column_id)
        
    return {"status": "success"}

# --- AI Chat Router ---

@app.post("/api/chat")
def chat_with_ai(
    payload: ChatPrompt, 
    x_gemini_api_key: Optional[str] = Header(None), 
    db: Session = Depends(get_db)
):
    user_prompt = payload.prompt
    
    # Check environment variable if header is missing
    api_key = x_gemini_api_key or os.environ.get("GEMINI_API_KEY")
    
    # Store user message
    user_msg = DBChatMessage(sender="user", message=user_prompt)
    db.add(user_msg)
    db.commit()
    
    # Process with AI
    ai_result = handle_ai_message(db, user_prompt, api_key)
    reply = ai_result.get("reply", "Done!")
    actions = ai_result.get("actions", [])
    
    # Execute actions directly on the DB
    applied_actions_summary = []
    for action in actions:
        atype = action.get("type")
        aparams = action.get("params", {})
        
        try:
            if atype == "add_card":
                col_name = aparams.get("column_name", "To-Do")
                col = db.query(DBColumn).filter(DBColumn.name.like(f"%{col_name}%")).first()
                if not col:
                    col = db.query(DBColumn).order_by(DBColumn.order).first()
                if col:
                    max_order = db.query(DBCard).filter(DBCard.column_id == col.id).count()
                    
                    # Avatar logic mapping
                    avatar_mapping = {
                        "olive": "olive", "robin": "robin", "maya": "maya",
                        "marcus": "marcus", "alex": "alex", "sophia": "sophia"
                    }
                    raw_avatar = aparams.get("assignee_name", "").lower().split()[0] if aparams.get("assignee_name") else ""
                    avatar_key = avatar_mapping.get(raw_avatar, "")
                    
                    new_card = DBCard(
                        column_id=col.id,
                        title=aparams.get("title", "AI Task"),
                        description=aparams.get("description", ""),
                        priority=aparams.get("priority", "Medium"),
                        due_date=aparams.get("due_date", ""),
                        assignee_name=aparams.get("assignee_name", ""),
                        assignee_avatar=avatar_key,
                        tags=aparams.get("tags", "AI"),
                        order=max_order
                    )
                    db.add(new_card)
                    db.commit()
                    applied_actions_summary.append(f"Added card '{new_card.title}' to '{col.name}'")
                    
            elif atype == "move_card":
                card_id = aparams.get("card_id")
                target_col_name = aparams.get("target_column_name")
                
                card = db.query(DBCard).filter(DBCard.id == card_id).first()
                col = db.query(DBColumn).filter(DBColumn.name.like(f"%{target_col_name}%")).first()
                
                if card and col:
                    old_col_id = card.column_id
                    card.column_id = col.id
                    max_order = db.query(DBCard).filter(DBCard.column_id == col.id).count()
                    card.order = max_order
                    db.commit()
                    reorder_column_cards(db, old_col_id)
                    reorder_column_cards(db, col.id)
                    applied_actions_summary.append(f"Moved card '{card.title}' to '{col.name}'")
                    
            elif atype == "delete_card":
                card_id = aparams.get("card_id")
                card = db.query(DBCard).filter(DBCard.id == card_id).first()
                if card:
                    col_id = card.column_id
                    title = card.title
                    db.delete(card)
                    db.commit()
                    reorder_column_cards(db, col_id)
                    applied_actions_summary.append(f"Deleted card '{title}'")
                    
            elif atype == "update_card":
                card_id = aparams.get("card_id")
                updates = aparams.get("updates", {})
                card = db.query(DBCard).filter(DBCard.id == card_id).first()
                if card:
                    for k, v in updates.items():
                        if hasattr(card, k):
                            setattr(card, k, v)
                    db.commit()
                    applied_actions_summary.append(f"Updated card '{card.title}' attributes")
                    
            elif atype == "add_column":
                col_name = aparams.get("name")
                if col_name:
                    max_order = db.query(DBColumn).count()
                    new_col = DBColumn(name=col_name, order=max_order)
                    db.add(new_col)
                    db.commit()
                    applied_actions_summary.append(f"Added column '{col_name}'")
                    
            elif atype == "delete_column":
                col_name = aparams.get("column_name")
                col = db.query(DBColumn).filter(DBColumn.name.like(f"%{col_name}%")).first()
                if col:
                    db.delete(col)
                    db.commit()
                    # Re-order columns
                    remaining = db.query(DBColumn).order_by(DBColumn.order).all()
                    for idx, c in enumerate(remaining):
                        c.order = idx
                    db.commit()
                    applied_actions_summary.append(f"Deleted column '{col_name}'")
        except Exception as ex:
            print(f"Failed to execute AI action: {ex}")
            
    # Store AI response
    ai_msg = DBChatMessage(sender="ai", message=reply)
    db.add(ai_msg)
    db.commit()
    
    return {
        "reply": reply,
        "actions_applied": applied_actions_summary
    }

@app.get("/api/chat/history")
def get_chat_history(db: Session = Depends(get_db)):
    messages = db.query(DBChatMessage).order_by(DBChatMessage.timestamp).all()
    return [{"sender": msg.sender, "message": msg.message} for msg in messages]

@app.post("/api/chat/clear")
def clear_chat_history(db: Session = Depends(get_db)):
    db.query(DBChatMessage).delete()
    db.commit()
    return {"status": "success"}

# --- Database Seeding ---

def seed_database():
    db = next(get_db())
    # Check if we already have columns seeded
    if db.query(DBColumn).count() > 0:
        db.close()
        return

    # Seed Columns
    col_names = ["Backlog", "To-Do", "In Progress", "Review", "Done"]
    columns = []
    for idx, name in enumerate(col_names):
        col = DBColumn(name=name, order=idx)
        db.add(col)
        columns.append(col)
    db.commit()

    # Seed Cards
    # 1. Backlog
    backlog_cards = [
        DBCard(
            column_id=columns[0].id,
            title="Research competitors' campaigns",
            description="Collect data on top-performing campaigns and platforms. Review their landing page copywriting and visual media choices.",
            priority="Low",
            due_date="2026-09-25",
            assignee_name="Olive Kenji",
            assignee_avatar="olive",
            tags="Research, Tech",
            files_count=56,
            subtasks=json.dumps([
                {"title": "Identify 3 core competitors", "completed": True},
                {"title": "Analyze ad spend budgets", "completed": False},
                {"title": "Collect competitor landing page URLs", "completed": False}
            ]),
            order=0
        ),
        DBCard(
            column_id=columns[0].id,
            title="Brainstorm content ideas",
            description="Initial ideas for ad creatives and blog posts. Find new angles and brainstorm with copywriters.",
            priority="Medium",
            due_date="2026-09-26",
            assignee_name="Robin Cooper",
            assignee_avatar="robin",
            tags="Planning",
            files_count=150,
            subtasks="[]",
            order=1
        ),
        DBCard(
            column_id=columns[0].id,
            title="Define campaign objectives",
            description="Clarify target KPIs, overall budget, and initial audience demographics.",
            priority="High",
            due_date="2026-09-28",
            assignee_name="Alex Hill",
            assignee_avatar="alex",
            tags="Research, SEO",
            files_count=410,
            subtasks=json.dumps([
                {"title": "Align budget details with finance", "completed": False}
            ]),
            order=2
        )
    ]

    # 2. In Progress
    in_progress_cards = [
        DBCard(
            column_id=columns[2].id,
            title="Design Instagram creatives",
            description="Carousel and story visuals aligned with the campaign theme guidelines.",
            priority="Medium",
            due_date="2026-10-05",
            assignee_name="Maya Hart",
            assignee_avatar="maya",
            tags="Social Media, Planning",
            files_count=121,
            subtasks=json.dumps([
                {"title": "Create 3 master templates", "completed": True},
                {"title": "Design story backgrounds", "completed": True},
                {"title": "Get brand manager approval on color palette", "completed": False}
            ]),
            order=0
        ),
        DBCard(
            column_id=columns[2].id,
            title="Email template design",
            description="Created main HTML/CSS template for the customer onboarding drip sequence.",
            priority="Low",
            due_date="2026-09-16",
            assignee_name="Alex Hill",
            assignee_avatar="alex",
            tags="Design, Email, Content",
            files_count=56,
            subtasks="[]",
            order=1
        ),
        DBCard(
            column_id=columns[2].id,
            title="Landing page draft",
            description="Create the first high-fidelity Figma mockup for A/B conversion testing.",
            priority="Low",
            due_date="2026-09-25",
            assignee_name="Olive Kenji",
            assignee_avatar="olive",
            tags="UI, UX, Design",
            files_count=56,
            subtasks="[]",
            order=2
        )
    ]

    # 3. Review
    review_cards = [
        DBCard(
            column_id=columns[3].id,
            title="Copywriting for ads",
            description="Review tone, clear CTAs, and overall readability scores for Search & Display ads.",
            priority="High",
            due_date="2026-10-01",
            assignee_name="Robin Cooper",
            assignee_avatar="robin",
            tags="Research",
            files_count=89,
            subtasks="[]",
            order=0
        ),
        DBCard(
            column_id=columns[3].id,
            title="Analytics setup",
            description="Ensure conversion tracking codes are properly firing and GA4 is linked.",
            priority="Medium",
            due_date="2026-10-08",
            assignee_name="Alex Hill",
            assignee_avatar="alex",
            tags="Tech",
            files_count=94,
            subtasks="[]",
            order=1
        )
    ]

    # 4. Done
    done_cards = [
        DBCard(
            column_id=columns[4].id,
            title="Audience segmentation",
            description="Customer groups successfully defined in CRM based on demographics & sign-up events.",
            priority="Low",
            due_date="2026-09-25",
            assignee_name="Marcus Levin",
            assignee_avatar="marcus",
            tags="Research, Content",
            files_count=81,
            subtasks="[]",
            order=0
        ),
        DBCard(
            column_id=columns[4].id,
            title="SEO audit results",
            description="Review findings and integrate suggestions into next-quarter sprint. Focus on website content structure.",
            priority="Medium",
            due_date="2026-09-26",
            assignee_name="Maya Hart",
            assignee_avatar="maya",
            tags="SEO, Planning",
            files_count=41,
            subtasks="[]",
            order=1
        ),
        DBCard(
            column_id=columns[4].id,
            title="Influencer outreach",
            description="Initial contact phase completed for 10 micro-influencers. Awaiting contract signatures.",
            priority="Medium",
            due_date="2026-09-19",
            assignee_name="Olive Kenji",
            assignee_avatar="olive",
            tags="Social Media",
            files_count=410,
            subtasks="[]",
            order=2
        )
    ]

    for card in backlog_cards + in_progress_cards + review_cards + done_cards:
        db.add(card)
    db.commit()
    db.close()

@app.post("/api/reset")
def reset_database(db: Session = Depends(get_db)):
    db.query(DBCard).delete()
    db.query(DBColumn).delete()
    db.query(DBChatMessage).delete()
    db.commit()
    seed_database()
    return {"status": "success"}

# Initialize DB and seed
init_db()
seed_database()

# Mount Static Files (Frontend)
frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
else:
    @app.get("/")
    def read_root():
        return {"msg": "Frontend directory not found. Please create 'frontend' folder."}
