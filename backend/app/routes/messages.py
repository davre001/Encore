from fastapi import APIRouter

from ..models.schemas import MessageCreate

router = APIRouter()


@router.get("/{video_id}")
async def list_messages(video_id: str):
    pass


@router.post("")
async def send_message(body: MessageCreate):
    pass
