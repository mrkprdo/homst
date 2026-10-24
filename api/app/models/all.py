import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import relationship

from app.db import Base


def new_uuid():
    return str(uuid.uuid4())


def utcnow():
    return datetime.now(timezone.utc)


class Household(Base):
    __tablename__ = "households"

    id = Column(Uuid(as_uuid=False), primary_key=True, default=new_uuid)
    name = Column(String(255), nullable=False)
    settings = Column(JSON, default=dict)

    members = relationship("Member", back_populates="household")
    calendars = relationship("Calendar", back_populates="household")
    task_lists = relationship("TaskList", back_populates="household")
    holidays = relationship("Holiday", back_populates="household")
    photos = relationship("Photo", back_populates="household", cascade="all, delete-orphan")


class Member(Base):
    __tablename__ = "members"

    id = Column(Uuid(as_uuid=False), primary_key=True, default=new_uuid)
    household_id = Column(Uuid(as_uuid=False), ForeignKey("households.id"), nullable=False)
    name = Column(String(255), nullable=False)
    avatar_url = Column(Text, nullable=True)
    color = Column(String(50), nullable=True)
    role = Column(Enum("member", "admin", name="role_enum"), nullable=False, default="member")
    joined_at = Column(DateTime(timezone=True), default=utcnow)

    household = relationship("Household", back_populates="members")


class Calendar(Base):
    __tablename__ = "calendars"

    id = Column(Uuid(as_uuid=False), primary_key=True, default=new_uuid)
    household_id = Column(Uuid(as_uuid=False), ForeignKey("households.id"), nullable=False)
    name = Column(String(255), nullable=False)
    color = Column(String(50), nullable=False)
    source = Column(
        Enum("internal", "google", "apple", "ical", name="calendar_source_enum"),
        nullable=False, default="internal",
    )
    feed_url = Column(Text, nullable=True)
    is_visible = Column(Boolean, default=True)
    created_by = Column(Uuid(as_uuid=False), ForeignKey("members.id"), nullable=True)

    household = relationship("Household", back_populates="calendars")
    events = relationship("Event", back_populates="calendar")


class Event(Base):
    __tablename__ = "events"

    id = Column(Uuid(as_uuid=False), primary_key=True, default=new_uuid)
    calendar_id = Column(Uuid(as_uuid=False), ForeignKey("calendars.id"), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, default="")
    start_at = Column(DateTime(timezone=True), nullable=False)
    end_at = Column(DateTime(timezone=True), nullable=True)
    all_day = Column(Boolean, default=False)
    recurrence = Column(JSON, nullable=True)
    reminder_minutes = Column(Integer, nullable=True)
    source = Column(
        Enum("internal", "external", name="event_source_enum"),
        nullable=False, default="internal",
    )
    external_uid = Column(Text, nullable=True)
    # Migration 0002 and the startup shim create this column as VARCHAR(36),
    # not UUID. Keep the model in step with the schema: comparing a UUID bind
    # parameter against a varchar column fails on PostgreSQL (member deletion
    # nulls this column first), while strings compare cleanly everywhere.
    assignee_id = Column(String(36), nullable=True)
    created_by = Column(Uuid(as_uuid=False), ForeignKey("members.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    calendar = relationship("Calendar", back_populates="events")


class PushSubscription(Base):
    """A browser/phone that opted in to Web Push reminders.

    Keyed by ``endpoint`` (unique per push service); the ``p256dh``/``auth``
    keys encrypt each payload. Dead endpoints (HTTP 404/410) are pruned when a
    send fails.
    """

    __tablename__ = "push_subscriptions"

    id = Column(Uuid(as_uuid=False), primary_key=True, default=new_uuid)
    household_id = Column(Uuid(as_uuid=False), ForeignKey("households.id"), nullable=False)
    endpoint = Column(Text, nullable=False, unique=True)
    p256dh = Column(Text, nullable=False)
    auth = Column(Text, nullable=False)
    user_agent = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    last_seen_at = Column(DateTime(timezone=True), default=utcnow)


class ServerSetting(Base):
    """Small key/value store for server-level secrets (e.g. the VAPID key pair).

    Kept out of ``households.settings`` so private keys are never returned by
    ``GET /api/v1/household/settings``.
    """

    __tablename__ = "server_settings"

    key = Column(String(64), primary_key=True)
    value = Column(Text, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Announcement(Base):
    """A short message broadcast to every connected screen.

    ``expires_at`` is NULL when the announcement stays until someone removes
    it; otherwise readers ignore it after the timestamp without needing a
    cleanup job.
    """

    __tablename__ = "announcements"
    __table_args__ = (
        Index("ix_announcements_household_created", "household_id", "created_at"),
    )

    id = Column(Uuid(as_uuid=False), primary_key=True, default=new_uuid)
    household_id = Column(Uuid(as_uuid=False), ForeignKey("households.id"), nullable=False)
    message = Column(Text, nullable=False)
    created_by = Column(Uuid(as_uuid=False), ForeignKey("members.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    expires_at = Column(DateTime(timezone=True), nullable=True)


class ReminderLog(Base):
    """Idempotency ledger: one row per (event occurrence, channel) delivered.

    The reminders worker runs once a minute; a unique constraint stops a
    reminder being sent twice for the same occurrence (e.g. across restarts
    or overlapping cron ticks).
    """

    __tablename__ = "reminder_log"
    __table_args__ = (
        UniqueConstraint(
            "event_id", "occurrence_at", "channel", name="uq_reminder_occurrence_channel"
        ),
    )

    id = Column(Uuid(as_uuid=False), primary_key=True, default=new_uuid)
    event_id = Column(Uuid(as_uuid=False), ForeignKey("events.id"), nullable=False)
    occurrence_at = Column(DateTime(timezone=True), nullable=False)
    channel = Column(String(20), nullable=False)  # hud | push
    status = Column(String(20), nullable=False, default="sent")  # sent | failed | skipped
    detail = Column(Text, nullable=True)
    sent_at = Column(DateTime(timezone=True), default=utcnow)


class TaskList(Base):
    __tablename__ = "task_lists"

    id = Column(Uuid(as_uuid=False), primary_key=True, default=new_uuid)
    household_id = Column(Uuid(as_uuid=False), ForeignKey("households.id"), nullable=False)
    name = Column(String(255), nullable=False)
    color = Column(String(50), nullable=False)
    position = Column(Integer, default=0)

    household = relationship("Household", back_populates="task_lists")
    tasks = relationship("Task", back_populates="list")


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Uuid(as_uuid=False), primary_key=True, default=new_uuid)
    list_id = Column(Uuid(as_uuid=False), ForeignKey("task_lists.id"), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, default="")
    assignee_id = Column(Uuid(as_uuid=False), ForeignKey("members.id"), nullable=True)
    start_at = Column(DateTime(timezone=True), nullable=True)
    end_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(
        Enum("todo", "doing", "done", name="task_status_enum"),
        nullable=False, default="todo",
    )
    priority = Column(
        Enum("low", "medium", "high", name="task_priority_enum"),
        nullable=False, default="medium",
    )
    position = Column(Integer, default=0)
    created_by = Column(Uuid(as_uuid=False), ForeignKey("members.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    list = relationship("TaskList", back_populates="tasks")


class Photo(Base):
    __tablename__ = "photos"

    id = Column(Uuid(as_uuid=False), primary_key=True, default=new_uuid)
    household_id = Column(Uuid(as_uuid=False), ForeignKey("households.id"), nullable=False)
    filename = Column(String(255), nullable=False)
    selected = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    household = relationship("Household", back_populates="photos")


class Holiday(Base):
    __tablename__ = "holidays"

    id = Column(Uuid(as_uuid=False), primary_key=True, default=new_uuid)
    household_id = Column(Uuid(as_uuid=False), ForeignKey("households.id"), nullable=False)
    date = Column(Date, nullable=False)
    name = Column(String(255), nullable=False)
    local_name = Column(String(255), nullable=True)
    country_code = Column(String(10), nullable=False)
    province = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    household = relationship("Household", back_populates="holidays")
