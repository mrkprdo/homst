"""add reminder fields and reminder_log table

Revision ID: 0004
Revises: 0003
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Member contact details for reminder delivery
    op.add_column("members", sa.Column("email", sa.String(255), nullable=True))
    op.add_column("members", sa.Column("phone", sa.String(32), nullable=True))
    op.add_column("members", sa.Column("sms_carrier", sa.String(255), nullable=True))

    # Per-event reminder offset (minutes before start)
    op.add_column("events", sa.Column("reminder_minutes", sa.Integer(), nullable=True))

    # Idempotency ledger for delivered reminders
    op.create_table(
        "reminder_log",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("event_id", sa.String(36), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("occurrence_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("channel", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="sent"),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("event_id", "occurrence_at", "channel", name="uq_reminder_occurrence_channel"),
    )


def downgrade() -> None:
    op.drop_table("reminder_log")
    op.drop_column("events", "reminder_minutes")
    op.drop_column("members", "sms_carrier")
    op.drop_column("members", "phone")
    op.drop_column("members", "email")
