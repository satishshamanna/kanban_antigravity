import json
from sqlalchemy import create_engine, Column, Integer, String, ForeignKey, Text, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime

DATABASE_URL = "sqlite:///./kanban.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class DBColumn(Base):
    __tablename__ = "columns"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    order = Column(Integer, default=0)

    cards = relationship("DBCard", back_populates="column", cascade="all, delete-orphan")

class DBCard(Base):
    __tablename__ = "cards"

    id = Column(Integer, primary_key=True, index=True)
    column_id = Column(Integer, ForeignKey("columns.id"), nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, default="")
    priority = Column(String, default="Low") # Low, Medium, High
    due_date = Column(String, default="") # YYYY-MM-DD
    assignee_name = Column(String, default="")
    assignee_avatar = Column(String, default="") # SVG, URL, or Emojis
    tags = Column(String, default="") # Comma-separated tags
    subtasks = Column(Text, default="[]") # JSON array of checklist items
    files_count = Column(Integer, default=0)
    order = Column(Integer, default=0)

    column = relationship("DBColumn", back_populates="cards")

class DBChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    sender = Column(String, nullable=False) # "user" or "ai"
    message = Column(Text, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow)

def init_db():
    Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
