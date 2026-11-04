"""cascade reminder_log rows when an event is deleted

Reminder history referenced events with a plain foreign key, so deleting an
event that had ever fired a reminder failed with a ForeignKeyViolation. Rebuild
the constraint with ON DELETE CASCADE.

Revision ID: 0008
Revises: 0007
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            -- Serialize the swap so concurrent upgrades cannot drop/add the
            -- same constraint at the same time.
            PERFORM pg_advisory_xact_lock(482937461);
            IF EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'reminder_log_event_id_fkey'
                  AND conrelid = 'reminder_log'::regclass
                  AND confdeltype <> 'c'
            ) THEN
                ALTER TABLE reminder_log DROP CONSTRAINT reminder_log_event_id_fkey;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'reminder_log_event_id_fkey'
                  AND conrelid = 'reminder_log'::regclass
            ) THEN
                ALTER TABLE reminder_log
                    ADD CONSTRAINT reminder_log_event_id_fkey
                    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.drop_constraint(
        "reminder_log_event_id_fkey", "reminder_log", type_="foreignkey"
    )
    op.create_foreign_key(
        "reminder_log_event_id_fkey",
        "reminder_log",
        "events",
        ["event_id"],
        ["id"],
    )
