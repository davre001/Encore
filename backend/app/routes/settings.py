"""Creator-level editor settings."""

from typing import Optional

from fastapi import APIRouter, Depends

from .. import storage
from ..dependencies import get_user_id
from ..models.schemas import AiSettings, AiSettingsUpdate

router = APIRouter()


@router.get("/ai", response_model=AiSettings)
async def get_ai_settings(
    user_id: Optional[str] = Depends(get_user_id),
) -> AiSettings:
    record = storage.get_ai_settings(user_id)
    return AiSettings(
        user_id=user_id,
        ai_permission_mode=record.get("aiPermissionMode", "ask"),
        updated_at=record.get("updatedAt", storage.now_ms()),
    )


@router.patch("/ai", response_model=AiSettings)
async def update_ai_settings(
    body: AiSettingsUpdate,
    user_id: Optional[str] = Depends(get_user_id),
) -> AiSettings:
    record = storage.save_ai_settings(
        user_id,
        {"aiPermissionMode": body.ai_permission_mode},
    )
    return AiSettings(
        user_id=user_id,
        ai_permission_mode=record.get("aiPermissionMode", "ask"),
        updated_at=record.get("updatedAt", storage.now_ms()),
    )
