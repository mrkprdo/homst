from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.events.publisher import publish_event
from app.models.all import Household, Task, TaskList
from app.schemas.all import (
    TaskCreate,
    TaskListCreate,
    TaskListResponse,
    TaskListUpdate,
    TaskMove,
    TaskResponse,
    TaskUpdate,
)

router = APIRouter()

DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000000"


async def _ensure_household(db: AsyncSession) -> None:
    result = await db.execute(select(Household).where(Household.id == DEFAULT_HOUSEHOLD_ID))
    if result.scalar_one_or_none():
        return
    db.add(Household(id=DEFAULT_HOUSEHOLD_ID, name="Home", settings={}))
    await db.commit()


def _task_to_response(t: Task) -> TaskResponse:
    return TaskResponse(
        id=UUID(t.id), list_id=UUID(t.list_id), title=t.title,
        description=t.description or "",
        assignee_id=UUID(t.assignee_id) if t.assignee_id else None,
        start_at=t.start_at, end_at=t.end_at,
        status=t.status, priority=t.priority, position=t.position,
        created_by=UUID(t.created_by) if t.created_by else None,
        created_at=t.created_at, updated_at=t.updated_at,
    )


def _task_list_dict(lst: TaskList) -> dict:
    return {
        "id": lst.id,
        "household_id": lst.household_id,
        "name": lst.name,
        "color": lst.color,
        "position": lst.position,
    }


# ── Task Lists ──

@router.get("/task-lists", response_model=list[TaskListResponse])
async def list_task_lists(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TaskList)
        .where(TaskList.household_id == DEFAULT_HOUSEHOLD_ID)
        .order_by(TaskList.position)
    )
    return result.scalars().all()


@router.post("/task-lists", response_model=TaskListResponse, status_code=201)
async def create_task_list(req: TaskListCreate, db: AsyncSession = Depends(get_db)):
    await _ensure_household(db)
    lst = TaskList(
        household_id=DEFAULT_HOUSEHOLD_ID, name=req.name, color=req.color, position=req.position
    )
    db.add(lst)
    await db.commit()
    try:
        await publish_event(DEFAULT_HOUSEHOLD_ID, "task-list.created", _task_list_dict(lst))
    except Exception:
        pass
    return lst


@router.patch("/task-lists/{list_id}", response_model=TaskListResponse)
async def update_task_list(list_id: UUID, req: TaskListUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TaskList).where(
            TaskList.id == str(list_id), TaskList.household_id == DEFAULT_HOUSEHOLD_ID
        )
    )
    lst = result.scalar_one_or_none()
    if not lst:
        raise HTTPException(status_code=404, detail="Task list not found")
    if req.name is not None:
        lst.name = req.name
    if req.color is not None:
        lst.color = req.color
    if req.position is not None:
        lst.position = req.position
    await db.commit()
    try:
        await publish_event(DEFAULT_HOUSEHOLD_ID, "task-list.updated", _task_list_dict(lst))
    except Exception:
        pass
    return lst


@router.delete("/task-lists/{list_id}")
async def delete_task_list(list_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TaskList).where(
            TaskList.id == str(list_id), TaskList.household_id == DEFAULT_HOUSEHOLD_ID
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Task list not found")
    await db.execute(delete(Task).where(Task.list_id == str(list_id)))
    await db.execute(delete(TaskList).where(TaskList.id == str(list_id)))
    await db.commit()
    try:
        await publish_event(DEFAULT_HOUSEHOLD_ID, "task-list.deleted", {"id": str(list_id)})
    except Exception:
        pass
    return {"message": "Task list deleted"}


# ── Tasks ──

@router.get("/tasks", response_model=list[TaskResponse])
async def list_tasks(
    list_id: UUID | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    lists_result = await db.execute(
        select(TaskList.id).where(TaskList.household_id == DEFAULT_HOUSEHOLD_ID)
    )
    household_list_ids = [row[0] for row in lists_result.all()]
    if not household_list_ids:
        return []

    query = select(Task).where(Task.list_id.in_(household_list_ids))
    if list_id:
        query = query.where(Task.list_id == str(list_id))
    query = query.order_by(Task.position)
    result = await db.execute(query)
    return [_task_to_response(t) for t in result.scalars().all()]


@router.post("/tasks", response_model=TaskResponse, status_code=201)
async def create_task(req: TaskCreate, db: AsyncSession = Depends(get_db)):
    lst_result = await db.execute(
        select(TaskList).where(
            TaskList.id == str(req.list_id), TaskList.household_id == DEFAULT_HOUSEHOLD_ID
        )
    )
    if not lst_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Task list not found")
    task = Task(
        list_id=str(req.list_id), title=req.title,
        description=req.description or "",
        assignee_id=str(req.assignee_id) if req.assignee_id else None,
        start_at=req.start_at, end_at=req.end_at,
        priority=req.priority, position=req.position, created_by=None,
    )
    db.add(task)
    await db.commit()
    resp = _task_to_response(task)
    try:
        await publish_event(DEFAULT_HOUSEHOLD_ID, "task.created", resp.model_dump(mode="json"))
    except Exception:
        pass
    return resp

@router.patch("/tasks/{task_id}", response_model=TaskResponse)
async def update_task(task_id: UUID, req: TaskUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Task).join(TaskList).where(
            Task.id == str(task_id),
            TaskList.household_id == DEFAULT_HOUSEHOLD_ID,
        )
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if req.title is not None:
        task.title = req.title
    if req.description is not None:
        task.description = req.description
    if req.start_at is not None:
        task.start_at = req.start_at
    if req.end_at is not None:
        task.end_at = req.end_at
    if req.assignee_id is not None:
        task.assignee_id = str(req.assignee_id) if req.assignee_id else None
    if req.status is not None:
        task.status = req.status
    if req.priority is not None:
        task.priority = req.priority
    if req.position is not None:
        task.position = req.position
    await db.commit()
    resp = _task_to_response(task)
    try:
        await publish_event(DEFAULT_HOUSEHOLD_ID, "task.updated", resp.model_dump(mode="json"))
    except Exception:
        pass
    return resp


@router.patch("/tasks/{task_id}/move", response_model=TaskResponse)
async def move_task(task_id: UUID, req: TaskMove, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Task).join(TaskList).where(
            Task.id == str(task_id),
            TaskList.household_id == DEFAULT_HOUSEHOLD_ID,
        )
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task.list_id = str(req.list_id)
    task.position = req.position
    await db.commit()
    resp = _task_to_response(task)
    try:
        await publish_event(DEFAULT_HOUSEHOLD_ID, "task.updated", resp.model_dump(mode="json"))
    except Exception:
        pass
    return resp


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Task).join(TaskList).where(
            Task.id == str(task_id),
            TaskList.household_id == DEFAULT_HOUSEHOLD_ID,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Task not found")
    await db.execute(delete(Task).where(Task.id == str(task_id)))
    await db.commit()
    try:
        await publish_event(DEFAULT_HOUSEHOLD_ID, "task.deleted", {"id": str(task_id)})
    except Exception:
        pass
    return {"message": "Task deleted"}
