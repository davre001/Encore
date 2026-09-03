"""Clips — list a video's cuts, and re-render one on demand."""

from fastapi import APIRouter, HTTPException

from ..models.schemas import Clip, ClipCreate, ClipUpdate
from .. import storage
from ..services import captions, ffmpeg

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


@router.post("", response_model=Clip)
async def create_clip(body: ClipCreate) -> Clip:
    """Create a cut from a range of the take — backs the manual editing tools.

    Mirrors moments._build_clip: fill any missing copy, persist, render on a
    best-effort basis, and return the real Clip (with a server id the publish
    endpoint will recognise).
    """
    video = storage.get_video(body.video_id)
    if video is None:
        raise HTTPException(status_code=404, detail="video not found")

    need_copy = not (body.title and body.caption and body.hashtags and body.tags)
    copy = (
        captions.build_post_copy(
            {"label": body.label or body.title or "Moment",
             "start": body.start, "end": body.end}
        )
        if need_copy
        else {}
    )

    clip = Clip(
        id=storage.new_id("clip"),
        moment_id=body.moment_id or storage.new_id("mom"),
        video_id=body.video_id,
        title=body.title or copy.get("title", "Moment"),
        caption=body.caption or copy.get("caption", ""),
        hashtags=body.hashtags or copy.get("hashtags", []),
        tags=body.tags or copy.get("tags", []),
        start=body.start,
        end=body.end,
        posted=False,
    )
    storage.save_clip(clip.model_dump(by_alias=True))

    src_path = video.get("srcPath")
    if src_path:
        ffmpeg.render_clip(src_path, clip.start, clip.end)  # best-effort
    return clip


@router.patch("/{clip_id}", response_model=Clip)
async def update_clip(clip_id: str, body: ClipUpdate) -> Clip:
    """Persist edits to an unposted clip (caption tab, regen, trim)."""
    record = storage.get_clip(clip_id)
    if record is None:
        raise HTTPException(status_code=404, detail="clip not found")
    if record.get("posted"):
        raise HTTPException(status_code=409, detail="cannot edit a posted clip")

    patch = body.model_dump(by_alias=True, exclude_none=True)
    if not patch:
        return Clip.model_validate(record)

    updated = storage.update_clip(clip_id, patch)
    if updated is None:
        raise HTTPException(status_code=404, detail="clip not found")

    # Re-cut on disk when the range moved, so the file matches the new trim.
    if "start" in patch or "end" in patch:
        video = storage.get_video(updated["videoId"])
        src_path = video.get("srcPath") if video else None
        if src_path:
            ffmpeg.render_clip(src_path, updated["start"], updated["end"])  # best-effort
    return Clip.model_validate(updated)
