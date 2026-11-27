from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.household import get_or_create_household
from app.routers.announcements import active_announcements
from app.routers.calendar import household_calendars, household_events
from app.routers.holidays import household_holidays
from app.routers.photos import household_photos
from app.routers.settings import public_household_settings
from app.routers.tasks import household_task_lists, household_tasks
from app.routers.users import household_members
from app.schemas.all import (
    CalendarResponse,
    EventResponse,
    HolidayResponse,
    MemberResponse,
    TaskListResponse,
    TaskResponse,
)

router = APIRouter()


def _add_months(moment: datetime, delta: int) -> datetime:
    index = moment.year * 12 + (moment.month - 1) + delta
    return moment.replace(year=index // 12, month=index % 12 + 1, day=1)


def _range_bounds(from_date: str | None, to_date: str | None) -> tuple[str, str]:
    if from_date and to_date:
        return from_date, to_date
    now = datetime.now(timezone.utc)
    start = _add_months(now, -1)
    end = _add_months(now, 2) - timedelta(seconds=1)
    return from_date or start.isoformat(), to_date or end.isoformat()


def _dump(items, model=None) -> list[dict]:
    if model is None:
        return [item.model_dump(mode="json") for item in items]
    return [model.model_validate(item).model_dump(mode="json") for item in items]


@router.get("/bootstrap")
async def get_bootstrap(
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
    db: AsyncSession = Depends(get_db),
):
    household = await get_or_create_household(db)
    start, end = _range_bounds(from_date, to_date)
    return {
        "settings": public_household_settings(household),
        "members": _dump(await household_members(db), MemberResponse),
        "photos": _dump(await household_photos(db)),
        "calendars": _dump(await household_calendars(db), CalendarResponse),
        "events": _dump(await household_events(db, start, end), EventResponse),
        "task_lists": _dump(await household_task_lists(db), TaskListResponse),
        "tasks": _dump(await household_tasks(db), TaskResponse),
        "holidays": _dump(await household_holidays(db), HolidayResponse),
        "announcements": _dump(await active_announcements(db)),
    }
