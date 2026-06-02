import sys
import os

# Append current directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from backend.db import init_db, get_db, DBColumn, DBCard, SessionLocal
from backend.ai_agent import fallback_rule_agent

def verify():
    print("Initializing Database...")
    init_db()
    print("Database Initialized successfully!")
    
    print("Opening database session...")
    db = SessionLocal()
    try:
        # Create a test column
        print("Testing column insertion...")
        test_col = DBColumn(name="Test Column Verification", order=99)
        db.add(test_col)
        db.commit()
        db.refresh(test_col)
        print(f"Column created with ID: {test_col.id}")

        # Create a test card
        print("Testing card insertion...")
        test_card = DBCard(
            column_id=test_col.id,
            title="Verification Task",
            description="Verify if SQLite database stores values properly",
            priority="High",
            tags="Test, Verification",
            order=0
        )
        db.add(test_card)
        db.commit()
        db.refresh(test_card)
        print(f"Card created with ID: {test_card.id}")

        # Verify query
        print("Verifying query accuracy...")
        queried_col = db.query(DBColumn).filter(DBColumn.id == test_col.id).first()
        assert queried_col is not None
        assert len(queried_col.cards) == 1
        assert queried_col.cards[0].title == "Verification Task"
        print("Assertion check PASSED!")

        # Test AI agent fallback logic
        print("Testing fallback AI parser logic...")
        state_mock = [{
            "column_id": test_col.id,
            "column_name": "Test Column Verification",
            "cards": [{
                "card_id": test_card.id,
                "title": "Verification Task",
                "description": "",
                "priority": "High",
                "due_date": "",
                "assignee": "",
                "tags": ""
            }]
        }]
        
        # Test add card parser
        res_add = fallback_rule_agent("add card \"AI Test Card\" to Test Column Verification", state_mock)
        assert "actions" in res_add
        assert len(res_add["actions"]) == 1
        assert res_add["actions"][0]["type"] == "add_card"
        assert res_add["actions"][0]["params"]["title"] == "Ai Test Card"
        print("AI Add parsing check PASSED!")

        # Test move card parser
        res_move = fallback_rule_agent("move card \"Verification Task\" to Test Column Verification", state_mock)
        assert len(res_move["actions"]) == 1
        assert res_move["actions"][0]["type"] == "move_card"
        assert res_move["actions"][0]["params"]["card_id"] == test_card.id
        print("AI Move parsing check PASSED!")

        # Clean up database test entries
        print("Cleaning up test elements...")
        db.delete(test_card)
        db.delete(test_col)
        db.commit()
        print("Cleanup completed.")
        
        print("\nAll database and agent fallback verifications PASSED successfully! [Success]")
    except Exception as e:
        print(f"\nVerification failed: {e}")
        db.rollback()
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    verify()
