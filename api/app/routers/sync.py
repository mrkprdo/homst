from fastapi import APIRouter

router = APIRouter()


@router.post("/sync")
async def sync_data():
    return {"message": "Sync started"}


@router.get("/sync/status")
async def sync_status():
    return {"status": "idle"}
