"""Clips — list a video's cuts, create and edit them, per-user isolated."""

import mimetypes
import os
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from ..dependencies import get_user_id
from pydantic import BaseModel, Field

from ..models.schemas import Clip, ClipCreate, ClipUpdate
from .. import storage
from ..services import captions, ffmpeg

router = APIRouter()


class ClipRenderBody(BaseModel):
    """Optional render-only overlays. Rendering must work even for posted clips."""

    caption_track: Optional[dict] = Field(default=None, alias="captionTrack")


class RewriteBody(BaseModel):
    """Optional beat to write the new title, description, and hashtags from."""

    label: Optional[str] = None
    reason: Optional[str] = None

@router.get("/{video_id}", response_model=list[Clip])
async def list_clips(
    video_id: str,
    user_id: Optional[str] = Depends(get_user_id),
) -> list[Clip]:
    clips = storage.list_clips(video_id)
    if user_id:
        clips = [c for c in clips if c.get("userId") == user_id or not c.get("userId")]
    return [Clip.model_validate(c) for c in clips]


@router.post("/{clip_id}/rewrite", response_model=Clip)
async def rewrite_clip(
    clip_id: str,
    body: RewriteBody | None = None,
    user_id: Optional[str] = Depends(get_user_id),
) -> Clip:
    """Regenerate the post title, description, hashtags, and tags for one cut."""
    record = storage.get_clip(clip_id)
    if record is None:
        raise HTTPException(status_code=404, detail="clip not found")
    if user_id and record.get("userId") and record["userId"] != user_id:
        raise HTTPException(status_code=404, detail="clip not found")
    if record.get("posted"):
        raise HTTPException(status_code=409, detail="cannot rewrite a posted clip")

    moment = storage.get_moment(record["momentId"]) if record.get("momentId") else None
    source = dict(moment or {})
    if body and body.label:
        source["label"] = body.label
    if body and body.reason:
        source["reason"] = body.reason
    source.setdefault("label", record.get("title") or "Moment")
    source.setdefault("start", record.get("start") or 0)
    source.setdefault("end", record.get("end") or 0)

    copy = captions.build_post_copy(source)
    updated = storage.update_clip(
        clip_id,
        {
            "title": copy["title"],
            "caption": copy["caption"],
            "hashtags": copy["hashtags"],
            "tags": copy["tags"],
        },
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="clip not found")
    return Clip.model_validate(updated)


@router.post("/{clip_id}/render", response_model=Clip)
async def render_clip(
    clip_id: str,
    body: ClipRenderBody | None = None,
    user_id: Optional[str] = Depends(get_user_id),
) -> Clip:
    record = storage.get_clip(clip_id)
    if record is None:
        raise HTTPException(status_code=404, detail="clip not found")
    if user_id and record.get("userId") and record["userId"] != user_id:
        raise HTTPException(status_code=404, detail="clip not found")

    video = storage.get_video(record["videoId"])
    src_path = video.get("srcPath") if video else None
    caption_segments = None
    if body and isinstance(body.caption_track, dict):
        caption_segments = body.caption_track.get("segments")
    if src_path:
        rendered = ffmpeg.render_clip(
            src_path,
            record["start"],
            record["end"],
            caption_segments if isinstance(caption_segments, list) else None,
        )
        record = storage.update_clip(clip_id, {"renderPath": rendered}) or record
    return Clip.model_validate(record)


@router.delete("/{clip_id}/hashtags/{hashtag}", response_model=Clip)
async def remove_clip_hashtag(
    clip_id: str,
    hashtag: str,
    user_id: Optional[str] = Depends(get_user_id),
) -> Clip:
    """Remove one hashtag from a draft clip and persist the user's choice."""
    record = storage.get_clip(clip_id)
    if record is None:
        raise HTTPException(status_code=404, detail="clip not found")
    if user_id and record.get("userId") and record["userId"] != user_id:
        raise HTTPException(status_code=404, detail="clip not found")
    if record.get("posted"):
        raise HTTPException(status_code=409, detail="cannot edit a posted clip")

    next_hashtags = [
        tag for tag in record.get("hashtags", []) if str(tag) != hashtag
    ]
    updated = storage.update_clip(clip_id, {"hashtags": next_hashtags})
    if updated is None:
        raise HTTPException(status_code=404, detail="clip not found")
    return Clip.model_validate(updated)


@router.get("/{clip_id}/file")
async def get_clip_file(
    clip_id: str,
    user_id: Optional[str] = Depends(get_user_id),
) -> FileResponse:
    record = storage.get_clip(clip_id)
    if record is None:
        raise HTTPException(status_code=404, detail="clip not found")
    if user_id and record.get("userId") and record["userId"] != user_id:
        raise HTTPException(status_code=404, detail="clip not found")

    path = record.get("renderPath")
    if not path or not os.path.isfile(path):
        video = storage.get_video(record["videoId"])
        src_path = video.get("srcPath") if video else None
        if not src_path:
            raise HTTPException(status_code=404, detail="clip file not found")
        path = ffmpeg.render_clip(src_path, record["start"], record["end"])
        storage.update_clip(clip_id, {"renderPath": path})

    media_type = mimetypes.guess_type(path)[0] or "video/mp4"
    return FileResponse(
        path,
        media_type=media_type,
        filename=f"{clip_id}.mp4",
        content_disposition_type="attachment",
    )


@router.post("", response_model=Clip)
async def create_clip(
    body: ClipCreate,
    user_id: Optional[str] = Depends(get_user_id),
) -> Clip:
    """Create a cut from a range of the take — backs the manual editing tools."""
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
    record = clip.model_dump(by_alias=True)
    record["userId"] = user_id

    src_path = video.get("srcPath")
    if src_path:
        record["renderPath"] = ffmpeg.render_clip(src_path, clip.start, clip.end)
    storage.save_clip(record)
    return clip


@router.patch("/{clip_id}", response_model=Clip)
async def update_clip(
    clip_id: str,
    body: ClipUpdate,
    user_id: Optional[str] = Depends(get_user_id),
) -> Clip:
    """Persist edits to an unposted clip — owner only."""
    record = storage.get_clip(clip_id)
    if record is None:
        raise HTTPException(status_code=404, detail="clip not found")
    if user_id and record.get("userId") and record["userId"] != user_id:
        raise HTTPException(status_code=404, detail="clip not found")
    if record.get("posted"):
        raise HTTPException(status_code=409, detail="cannot edit a posted clip")

    patch = body.model_dump(by_alias=True, exclude_none=True)
    if not patch:
        return Clip.model_validate(record)

    updated = storage.update_clip(clip_id, patch)
    if updated is None:
        raise HTTPException(status_code=404, detail="clip not found")

    if "start" in patch or "end" in patch:
        video = storage.get_video(updated["videoId"])
        src_path = video.get("srcPath") if video else None
        if src_path:
            rendered = ffmpeg.render_clip(src_path, updated["start"], updated["end"])
            updated = storage.update_clip(clip_id, {"renderPath": rendered}) or updated
    return Clip.model_validate(updated)
