"""Mind — persistent AI memory and agent control routes."""

from fastapi import APIRouter, HTTPException
from ..models.schemas import MindMemoryCreate, MindMemoryResponse, ChatPromptRequest, Message
from ..services import minds, minds_api
from ..config import capabilities

router = APIRouter()


@router.get("/status")
async def get_mind_status() -> dict:
    """Minds (Animoca Builder API) wiring and memory stats.

    `transport` is only probed when a key is configured, so an unwired
    deployment never makes an outbound call just to render Settings.
    """
    caps = capabilities()
    memories = minds.get_persistent_memories()
    return {
        "status": "ok",
        "mindsAvailable": caps["minds"],
        "persistentMemoryEnabled": True,
        "memoriesCount": len(memories),
        "transport": minds_api.probe() if caps["minds"] else None,
    }


@router.get("/memories", response_model=list[MindMemoryResponse])
async def list_memories(category: str | None = None) -> list[MindMemoryResponse]:
    """List all stored persistent memories for the creator."""
    items = minds.get_persistent_memories(category=category)
    return [MindMemoryResponse.model_validate(item) for item in items]


@router.post("/memories", response_model=MindMemoryResponse)
async def create_memory(body: MindMemoryCreate) -> MindMemoryResponse:
    """Store or update a standing rule or preference in persistent memory."""
    mem = minds.add_persistent_memory(
        content=body.content,
        category=body.category,
        key=body.key,
        metadata_json=body.metadata_json or "{}",
    )
    return MindMemoryResponse.model_validate(mem)


@router.delete("/memories/{memory_id}")
async def delete_memory(memory_id: str) -> dict:
    """Delete a memory from persistent storage."""
    deleted = minds.delete_persistent_memory(memory_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Memory not found")
    return {"status": "ok", "deleted": memory_id}


@router.post("/chat", response_model=Message)
async def chat_with_mind(body: ChatPromptRequest) -> Message:
    """Blocking one-shot ask, for scripts and diagnostics.

    The notebook UI uses POST /api/messages instead, which hands a live Mind's
    slow round trip to a background task. This route waits it out inline, so a
    wired Mind can hold the request open for as long as MINDS_REPLY_TIMEOUT.
    """
    minds.save_chat_message(role="you", text=body.text, video_id=body.video_id)
    reply_text = minds.chat_reply(
        text=body.text,
        context=body.context or "",
        video_id=body.video_id,
    )
    saved_reply = minds.save_chat_message(role="mind", text=reply_text, video_id=body.video_id)
    return Message.model_validate(saved_reply)
