from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.all import Household

DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000000"


async def get_or_create_household(db: AsyncSession) -> Household:
    result = await db.execute(select(Household).where(Household.id == DEFAULT_HOUSEHOLD_ID))
    household = result.scalar_one_or_none()
    if household:
        return household
    household = Household(id=DEFAULT_HOUSEHOLD_ID, name="Home", settings={})
    db.add(household)
    await db.flush()
    return household
