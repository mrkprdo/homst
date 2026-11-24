from datetime import date, datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, SecretStr, field_validator

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


# ── Nest ──
class NestCredentials(BaseModel):
    account_type: Literal["google", "nest"]
    issue_token: Optional[str] = Field(None, max_length=20000)
    cookies: Optional[str] = Field(None, max_length=20000)
    access_token: Optional[str] = Field(None, max_length=5000)


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
    source_message: Optional[str] = Field(None, max_length=DESCRIPTION_MAX)
    start_at: datetime
    end_at: Optional[datetime] = None
    all_day: bool = False
    recurrence: Optional[Recurrence] = None
    reminder_minutes: Optional[int] = None
    assignee_id: Optional[UUID] = None


class EventUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=NAME_MAX)
    description: Optional[str] = Field(None, max_length=DESCRIPTION_MAX)
    source_message: Optional[str] = Field(None, max_length=DESCRIPTION_MAX)
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
    source_message: Optional[str] = None
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


# ── Smart import (AI) ──
class AiConfigUpdate(BaseModel):
    """Write-only key update. The key is never returned by any endpoint."""

    api_key: Optional[SecretStr] = Field(None, max_length=500)
    provider: Optional[Literal["console", "go"]] = None
    model: Optional[str] = Field(None, max_length=120)


class AiStatusResponse(BaseModel):
    configured: bool
    provider: str
    model: str
    key_hint: Optional[str] = None


class AiModelInfo(BaseModel):
    id: str
    name: str
    supports_images: bool = False


class AiModelsResponse(BaseModel):
    models: list[AiModelInfo]
    provider: str
    selected: str


class AiTestResponse(AiStatusResponse):
    ok: bool
    message: str


class AiClarification(BaseModel):
    """One answered question from the previous Smart import round."""

    question: str = Field(max_length=300)
    answer: str = Field(max_length=2000)


class AiParseRequest(BaseModel):
    text: str = Field("", max_length=100_000)
    # A data URL. The router re-encodes the image before it is forwarded.
    image: Optional[str] = Field(None, max_length=16_000_000)
    timezone: Optional[str] = Field(None, max_length=64)
    # Answers to the questions the harness asked last time. The model applies
    # them and re-emits the complete event list.
    clarifications: list[AiClarification] = Field(default_factory=list, max_length=12)


class AiEventDraft(BaseModel):
    title: str
    description: str = ""
    start_at: datetime
    end_at: Optional[datetime] = None
    all_day: bool = False
    recurrence: Optional[dict] = None
    reminder_minutes: Optional[int] = None
    assignee_id: Optional[UUID] = None
    confidence: float = 0.0


class AiQuestion(BaseModel):
    """A question the model wants answered before the import can finish."""

    id: str
    kind: Literal["clarification", "assignee", "conflict"] = "clarification"
    question: str
    options: list[str] = []
    about: Optional[str] = None


class AiConflict(BaseModel):
    """A concrete double-booking the server found in the household calendar."""

    id: str
    draft_index: int
    title: str
    start_at: datetime
    end_at: Optional[datetime] = None
    existing_title: str
    existing_start_at: datetime
    existing_end_at: Optional[datetime] = None
    existing_kind: Literal["existing", "draft"] = "existing"
    assignee_id: Optional[UUID] = None
    message: str


class AiParseResponse(BaseModel):
    events: list[AiEventDraft]
    skipped: int = 0
    model: str
    # Raw assistant output (the JSON answer) and any reasoning the model
    # streamed alongside it. Shown in a collapsed panel for transparency.
    response: str = ""
    reasoning: Optional[str] = None
    warnings: list[str] = []
    # Questions the harness needs answered before the import is final.
    questions: list[AiQuestion] = []
    conflicts: list[AiConflict] = []
    needs_input: bool = False
