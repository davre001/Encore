"""Mind — persistent AI memory and agent control routes, per-user isolated."""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException

from ..dependencies import get_user_id
from ..models.schemas import MindMemoryCreate, MindMemoryResponse, ChatPromptRequest, Message
from ..services import minds, minds_api
from ..config import capabilities

router = APIRouter()


@router.get("/status")
async def get_mind_status(
    user_id: Optional[str] = Depends(get_user_id),
) -> dict:
    """Minds (Animoca Builder API) wiring and this user's memory stats."""
    caps = capabilities()
    memories = minds.get_persistent_memories(user_id)
    return {
        "status": "ok",
        "mindsAvailable": caps["minds"],
        "persistentMemoryEnabled": True,
        "memoriesCount": len(memories),
        "transport": minds_api.probe() if caps["minds"] else None,
    }


@router.get("/memories", response_model=list[MindMemoryResponse])
async def list_memories(
    category: str | None = None,
    user_id: Optional[str] = Depends(get_user_id),
) -> list[MindMemoryResponse]:
    """List persistent memories for this creator."""
    items = minds.get_persistent_memories(user_id=user_id, category=category)
    return [MindMemoryResponse.model_validate(item) for item in items]


@router.post("/memories", response_model=MindMemoryResponse)
async def create_memory(
    body: MindMemoryCreate,
    user_id: Optional[str] = Depends(get_user_id),
) -> MindMemoryResponse:
    """Store or update a standing rule or preference for this creator."""
    mem = minds.add_persistent_memory(
        content=body.content,
        category=body.category,
        key=body.key,
        user_id=user_id,
        metadata_json=body.metadata_json or "{}",
    )
    return MindMemoryResponse.model_validate(mem)


@router.delete("/memories/{memory_id}")
async def delete_memory(
    memory_id: str,
    user_id: Optional[str] = Depends(get_user_id),
) -> dict:
    """Delete a memory — only if it belongs to this creator."""
    deleted = minds.delete_persistent_memory(memory_id, user_id=user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Memory not found")
    return {"status": "ok", "deleted": memory_id}


@router.post("/chat", response_model=Message)
async def chat_with_mind(
    body: ChatPromptRequest,
    user_id: Optional[str] = Depends(get_user_id),
) -> Message:
    """Blocking one-shot ask, for scripts and diagnostics."""
    minds.save_chat_message(
        role="you", text=body.text, video_id=body.video_id, user_id=user_id
    )
    reply_text = minds.chat_reply(
        text=body.text,
        context=body.context or "",
        video_id=body.video_id,
        user_id=user_id,
    )
    saved_reply = minds.save_chat_message(
        role="mind", text=reply_text, video_id=body.video_id, user_id=user_id
    )
    return Message.model_validate(saved_reply)
