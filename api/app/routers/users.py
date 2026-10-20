from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.events.publisher import publish_event
from app.models.all import Event, Household, Member, Task
from app.schemas.all import MemberCreate, MemberResponse, MemberUpdate

router = APIRouter()

DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000000"


async def _get_or_create_household(db: AsyncSession) -> Household:
    result = await db.execute(select(Household).where(Household.id == DEFAULT_HOUSEHOLD_ID))
    hh = result.scalar_one_or_none()
    if hh:
        return hh
    hh = Household(id=DEFAULT_HOUSEHOLD_ID, name="Home", settings={})
    db.add(hh)
    await db.flush()
    return hh


@router.get("/household/members", response_model=list[MemberResponse])
async def list_members(db: AsyncSession = Depends(get_db)):
    await _get_or_create_household(db)
    result = await db.execute(
        select(Member).where(Member.household_id == DEFAULT_HOUSEHOLD_ID)
    )
    return result.scalars().all()


@router.post("/household/members", response_model=MemberResponse, status_code=201)
async def create_member(req: MemberCreate, db: AsyncSession = Depends(get_db)):
    await _get_or_create_household(db)
    member = Member(
        household_id=DEFAULT_HOUSEHOLD_ID,
        name=req.name,
        avatar_url=req.avatar_url,
        color=req.color,
        role=req.role,
    )
    db.add(member)
    await db.commit()
    resp = MemberResponse.model_validate(member)
    try:
        await publish_event(DEFAULT_HOUSEHOLD_ID, "member.joined", resp.model_dump(mode="json"))
    except Exception:
        pass
    return resp


@router.patch("/household/members/{member_id}", response_model=MemberResponse)
async def update_member(member_id: UUID, req: MemberUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Member).where(
            Member.id == str(member_id),
            Member.household_id == DEFAULT_HOUSEHOLD_ID,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    if req.name is not None:
        member.name = req.name
    if req.avatar_url is not None:
        member.avatar_url = req.avatar_url
    if req.color is not None:
        member.color = req.color
    if req.role is not None:
        member.role = req.role
    await db.commit()
    resp = MemberResponse.model_validate(member)
    try:
        await publish_event(DEFAULT_HOUSEHOLD_ID, "member.updated", resp.model_dump(mode="json"))
    except Exception:
        pass
    return resp


@router.delete("/household/members/{member_id}")
async def delete_member(member_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Member).where(
            Member.id == str(member_id),
            Member.household_id == DEFAULT_HOUSEHOLD_ID,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Member not found")
    member_id_str = str(member_id)
    await db.execute(
        Task.__table__.update().where(Task.assignee_id == member_id_str).values(assignee_id=None)
    )
    await db.execute(
        Event.__table__.update().where(Event.assignee_id == member_id_str).values(assignee_id=None)
    )
    await db.execute(delete(Member).where(Member.id == member_id_str))
    await db.commit()
    try:
        await publish_event(DEFAULT_HOUSEHOLD_ID, "member.removed", {"id": member_id_str})
    except Exception:
        pass
    return {"message": "Member deleted"}
