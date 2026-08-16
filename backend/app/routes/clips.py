from fastapi import APIRouter

router = APIRouter()


@router.get("/{video_id}")
async def list_clips(video_id: str):
    pass


@router.post("/{clip_id}/render")
async def render_clip(clip_id: str):
    pass
