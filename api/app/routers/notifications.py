from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.notifications.reminders import send_test_notification
from app.schemas.all import NotificationTestRequest, NotificationTestResponse

router = APIRouter()


@router.post("/notifications/test", response_model=NotificationTestResponse)
async def test_notification(
    req: NotificationTestRequest,
    db: AsyncSession = Depends(get_db),
):
    """Send a test reminder now (HUD / Web Push) to verify the setup."""
    results = await send_test_notification(channels=req.channels, session=db)
    return NotificationTestResponse(results=results)
