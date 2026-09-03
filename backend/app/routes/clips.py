"""Clips — list a video's cuts, and re-render one on demand."""

from fastapi import APIRouter, HTTPException

from ..models.schemas import Clip
from .. import storage
from ..services import ffmpeg

router = APIRouter()


@router.get("/{video_id}", response_model=list[Clip])
async def list_clips(video_id: str) -> list[Clip]:
    return [Clip.model_validate(c) for c in storage.list_clips(video_id)]


@router.post("/{clip_id}/render", response_model=Clip)
async def render_clip(clip_id: str) -> Clip:
    record = storage.get_clip(clip_id)
    if record is None:
        raise HTTPException(status_code=404, detail="clip not found")

    video = storage.get_video(record["videoId"])
    src_path = video.get("srcPath") if video else None
    if src_path:
        ffmpeg.render_clip(src_path, record["start"], record["end"])  # best-effort
    return Clip.model_validate(record)
