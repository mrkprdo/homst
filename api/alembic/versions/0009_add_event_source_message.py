"""store the message that produced an AI-imported event

Smart import keeps the raw email/screenshot text on every generated event so
the household can see why it exists. It lives beside ``description`` instead
of inside it, so parsed notes stay readable.

Revision ID: 0009
Revises: 0008
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE events ADD COLUMN IF NOT EXISTS source_message TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE events DROP COLUMN IF EXISTS source_message")
