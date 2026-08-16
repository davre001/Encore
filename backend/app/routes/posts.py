from fastapi import APIRouter

router = APIRouter()


@router.post("/{clip_id}")
async def publish_clip(clip_id: str):
    pass


@router.get("/{post_id}/check")
async def check_post(post_id: str):
    pass
