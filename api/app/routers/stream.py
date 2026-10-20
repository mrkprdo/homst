import json

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.db import get_db
from app.redis_client import get_redis

router = APIRouter()

DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000000"


@router.get("/stream")
async def stream(request: Request, db: AsyncSession = Depends(get_db)):
    household_id = DEFAULT_HOUSEHOLD_ID

    def sync_required():
        """Ask the (re)connecting client to reload everything from the REST API.

        A client cannot tell whether it missed events while the server was
        restarting (or while its own connection was down), so the server pushes
        the hint on every successful (re)subscribe instead of the client
        guessing from its reconnect state.
        """
        return {"event": "sync.required", "data": json.dumps({"type": "sync.required"})}

    async def event_generator():
        r = await get_redis()
        pubsub = r.pubsub()
        channel = f"household:{household_id}"
        await pubsub.subscribe(channel)
        yield sync_required()
        try:
            while True:
                try:
                    message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=30.0)
                    if await request.is_disconnected():
                        break
                    if message:
                        data = message.get("data")
                        if isinstance(data, bytes):
                            data = data.decode()
                        if data:
                            try:
                                parsed = json.loads(data)
                                event_type = parsed.get("type", "message")
                                yield {"event": event_type, "data": data}
                            except json.JSONDecodeError:
                                yield {"data": data}
                except Exception:
                    await pubsub.close()
                    pubsub = r.pubsub()
                    await pubsub.subscribe(channel)
                    # Anything published during the gap was missed — resync.
                    yield sync_required()
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.close()

    return EventSourceResponse(event_generator())
