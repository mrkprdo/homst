from pydantic import BaseModel, Field


class InstallRequest(BaseModel):
    version: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    retry: bool = False
