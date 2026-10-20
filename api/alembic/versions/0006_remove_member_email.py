"""remove member email field

Email reminders were removed in favour of Web Push, so the member ``email``
column no longer serves any purpose. Historical ``reminder_log`` rows for the
retired email channel are cleared as well.

Revision ID: 0006
Revises: 0005
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DELETE FROM reminder_log WHERE channel = 'email'")
    op.drop_column("members", "email")


def downgrade() -> None:
    op.add_column("members", sa.Column("email", sa.String(255), nullable=True))
