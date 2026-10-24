from datetime import date, datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

# DB-backed text limits (see app/models/all.py).
NAME_MAX = 255
COLOR_MAX = 50
DESCRIPTION_MAX = 20000


# ── Members ──
class MemberCreate(BaseModel):
    name: str = Field(max_length=NAME_MAX)
    avatar_url: Optional[str] = None
    color: Optional[str] = Field(None, max_length=COLOR_MAX)
    role: Literal["member", "admin"] = "member"


class MemberUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=NAME_MAX)
    avatar_url: Optional[str] = None
    color: Optional[str] = Field(None, max_length=COLOR_MAX)
    role: Optional[Literal["member", "admin"]] = None


class MemberResponse(BaseModel):
    id: UUID
    household_id: UUID
    name: str
    avatar_url: Optional[str] = None
    color: Optional[str] = None
    role: str
    joined_at: datetime

    model_config = {"from_attributes": True}


# ── Household ──
class HouseholdResponse(BaseModel):
    id: UUID
    name: str
    settings: dict = {}

    model_config = {"from_attributes": True}


class HouseholdSettingsUpdate(BaseModel):
    name: Optional[str] = None
    settings: Optional[dict] = None


# ── Calendar ──
class CalendarCreate(BaseModel):
    name: str = Field(max_length=NAME_MAX)
    color: str = Field("sage", max_length=COLOR_MAX)
    source: Literal["internal", "google", "apple", "ical"] = "internal"
    feed_url: Optional[str] = None


class CalendarUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=NAME_MAX)
    color: Optional[str] = Field(None, max_length=COLOR_MAX)
    is_visible: Optional[bool] = None


class CalendarResponse(BaseModel):
    id: UUID
    household_id: UUID
    name: str
    color: str
    source: str
    feed_url: Optional[str] = None
    is_visible: bool
    created_by: Optional[UUID] = None

    model_config = {"from_attributes": True}


class SubscribeCalendarRequest(BaseModel):
    feed_url: str
    name: Optional[str] = Field(None, max_length=NAME_MAX)
    color: str = Field("sage", max_length=COLOR_MAX)


class Recurrence(BaseModel):
    """A recurrence rule as stored in ``events.recurrence`` (JSON)."""

    freq: Literal["daily", "weekly", "biweekly", "monthly", "yearly"]
    until: Optional[str] = None
    count: Optional[int] = Field(None, ge=1, le=730)

    @field_validator("until")
    @classmethod
    def _validate_until(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return value


class EventCreate(BaseModel):
    calendar_id: UUID
    title: str = Field(max_length=NAME_MAX)
    description: str = Field("", max_length=DESCRIPTION_MAX)
    start_at: datetime
    end_at: Optional[datetime] = None
    all_day: bool = False
    recurrence: Optional[Recurrence] = None
    reminder_minutes: Optional[int] = None
    assignee_id: Optional[UUID] = None


class EventUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=NAME_MAX)
    description: Optional[str] = Field(None, max_length=DESCRIPTION_MAX)
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    all_day: Optional[bool] = None
    recurrence: Optional[Recurrence] = None
    reminder_minutes: Optional[int] = None
    assignee_id: Optional[UUID] = None


class EventResponse(BaseModel):
    id: UUID
    calendar_id: UUID
    title: str
    description: str = ""
    start_at: datetime
    end_at: Optional[datetime] = None
    all_day: bool = False
    recurrence: Optional[dict] = None
    reminder_minutes: Optional[int] = None
    source: str
    external_uid: Optional[str] = None
    assignee_id: Optional[UUID] = None
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Tasks ──
class TaskListCreate(BaseModel):
    name: str = Field(max_length=NAME_MAX)
    color: str = Field("sage", max_length=COLOR_MAX)
    position: int = 0


class TaskListUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=NAME_MAX)
    color: Optional[str] = Field(None, max_length=COLOR_MAX)
    position: Optional[int] = None


class TaskListResponse(BaseModel):
    id: UUID
    household_id: UUID
    name: str
    color: str
    position: int

    model_config = {"from_attributes": True}


class TaskCreate(BaseModel):
    list_id: UUID
    title: str = Field(max_length=NAME_MAX)
    description: str = Field("", max_length=DESCRIPTION_MAX)
    assignee_id: Optional[UUID] = None
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    priority: Literal["low", "medium", "high"] = "medium"
    position: int = 0


class TaskUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=NAME_MAX)
    description: Optional[str] = Field(None, max_length=DESCRIPTION_MAX)
    assignee_id: Optional[UUID] = None
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    status: Optional[Literal["todo", "doing", "done"]] = None
    priority: Optional[Literal["low", "medium", "high"]] = None
    position: Optional[int] = None


class TaskMove(BaseModel):
    list_id: UUID
    position: int


# ── Photos ──
class PhotoUpdate(BaseModel):
    selected: bool


class PhotoResponse(BaseModel):
    id: str
    url: str
    selected: bool
    created_at: datetime


# ── Holidays ──
class HolidaySyncRequest(BaseModel):
    country_code: str = Field(pattern=r"^[A-Za-z]{2}$")
    province: Optional[str] = Field(None, max_length=100)


class HolidayResponse(BaseModel):
    id: UUID
    household_id: UUID
    date: date
    name: str
    local_name: Optional[str] = None
    country_code: str
    province: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class TaskResponse(BaseModel):
    id: UUID
    list_id: UUID
    title: str
    description: str = ""
    assignee_id: Optional[UUID] = None
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    status: str
    priority: str
    position: int
    created_by: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Announcements ──
class AnnouncementCreate(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    created_by: Optional[UUID] = None
    # None means "until someone removes it"; the default matches the composer.
    duration_minutes: Optional[int] = Field(default=30, ge=1, le=10080)
    send_push: bool = True


class AnnouncementResponse(BaseModel):
    id: UUID
    household_id: UUID
    message: str
    created_by: Optional[UUID] = None
    author_name: Optional[str] = None
    created_at: datetime
    expires_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ── Notifications ──
class NotificationTestRequest(BaseModel):
    """Send a test reminder through the HUD / Web Push channels."""

    channels: Optional[list[Literal["hud", "push"]]] = None


class NotificationTestResponse(BaseModel):
    results: dict[str, str]


# ── Web Push ──
class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscribeRequest(BaseModel):
    endpoint: str
    keys: PushSubscriptionKeys
    user_agent: Optional[str] = None


class PushUnsubscribeRequest(BaseModel):
    endpoint: str


class VapidKeyResponse(BaseModel):
    key: str
