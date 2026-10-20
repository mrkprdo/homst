import json

from app.redis_client import get_redis


async def publish_event(household_id: str, event_type: str, data: dict):
    """Publish an event to a household's Redis channel for SSE fan-out."""
    r = await get_redis()
    payload = json.dumps({"type": event_type, **data})
    await r.publish(f"household:{household_id}", payload)
