"""save Smart import conversations and link them to events

A Smart import chat is kept as a compact transcript so an event created from
it can reopen the same context later and apply follow-up changes.

Revision ID: 0010
Revises: 0009
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ai_conversations (
            id UUID PRIMARY KEY,
            household_id UUID NOT NULL REFERENCES households(id),
            title VARCHAR(255) NOT NULL DEFAULT '',
            turns JSON NOT NULL DEFAULT '[]',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "ALTER TABLE events ADD COLUMN IF NOT EXISTS ai_conversation_id UUID"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_events_ai_conversation_id "
        "ON events (ai_conversation_id)"
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'events_ai_conversation_id_fkey'
            ) THEN
                ALTER TABLE events
                    ADD CONSTRAINT events_ai_conversation_id_fkey
                    FOREIGN KEY (ai_conversation_id)
                    REFERENCES ai_conversations(id) ON DELETE SET NULL;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE events DROP CONSTRAINT IF EXISTS "
        "events_ai_conversation_id_fkey"
    )
    op.execute("DROP INDEX IF EXISTS ix_events_ai_conversation_id")
    op.execute("ALTER TABLE events DROP COLUMN IF EXISTS ai_conversation_id")
    op.execute("DROP TABLE IF EXISTS ai_conversations")
