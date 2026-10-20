"""remove sms reminder fields

SMS delivery via carrier email-to-SMS gateways proved unreliable; reminders
now go out over the HUD and email only. Dropping the member contact columns
that only served SMS.

Revision ID: 0005
Revises: 0004
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("members", "sms_carrier")
    op.drop_column("members", "phone")


def downgrade() -> None:
    op.add_column("members", sa.Column("phone", sa.String(32), nullable=True))
    op.add_column("members", sa.Column("sms_carrier", sa.String(255), nullable=True))
