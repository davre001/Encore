"""Posts - publish a rendered clip to YouTube and grade it later."""

import json
import os

try:
    from googleapiclient.errors import HttpError
except ImportError:  # optional dependency guard
    HttpError = Exception

from fastapi import APIRouter, Depends, HTTPException

from .. import storage
from ..dependencies import get_user_id
from ..models.schemas import PostCheck, PublishResult
from ..services import analytics, ffmpeg, playbook, youtube

router = APIRouter()


def _upload_path_for_clip(clip: dict) -> str | None:
    render_path = clip.get("renderPath")
    if render_path and os.path.isfile(render_path):
        return render_path

    video = storage.get_video(clip["videoId"])
    src_path = video.get("srcPath") if video else None
    if not src_path:
        return None

    rendered = ffmpeg.render_clip(src_path, clip["start"], clip["end"])
    if rendered:
        storage.update_clip(clip["id"], {"renderPath": rendered})
    return rendered


def _youtube_error_message(exc: Exception) -> str:
    content = getattr(exc, "content", None)
    if isinstance(content, bytes):
        content = content.decode("utf-8", errors="replace")
    if isinstance(content, str) and content:
        try:
            payload = json.loads(content)
            error = payload.get("error", {})
            message = error.get("message")
            details = error.get("errors") or []
            reason = details[0].get("reason") if details and isinstance(details[0], dict) else None
            if message and reason:
                return f"YouTube upload failed: {message} ({reason})."
            if message:
                return f"YouTube upload failed: {message}."
        except json.JSONDecodeError:
            return f"YouTube upload failed: {content[:300]}"
    status = getattr(getattr(exc, "resp", None), "status", None)
    if status:
        return f"YouTube upload failed with status {status}."
    return "YouTube upload failed. Check channel permissions, quota, or video policy status."


@router.post("/{clip_id}", response_model=PublishResult)
async def publish_clip(
    clip_id: str,
    user_id: str = Depends(get_user_id),
) -> PublishResult:
    clip = storage.get_clip(clip_id)
    if clip is None:
        raise HTTPException(status_code=404, detail="clip not found")
    if clip.get("userId") and clip["userId"] != user_id:
        raise HTTPException(status_code=404, detail="clip not found")
    if not youtube.connected(user_id):
        raise HTTPException(
            status_code=409,
            detail="Connect a YouTube channel in Settings before posting.",
        )

    upload_path = _upload_path_for_clip(clip)
    try:
        result = youtube.publish(clip, upload_path, user_id=user_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except HttpError as exc:
        raise HTTPException(status_code=502, detail=_youtube_error_message(exc)) from exc

    storage.update_clip(
        clip_id,
        {"posted": True, "postId": result["postId"], "postUrl": result["postUrl"]},
    )
    storage.save_post(
        {
            "id": result["postId"],
            "clipId": clip_id,
            "videoId": clip["videoId"],
            "userId": user_id,
        }
    )
    return PublishResult(post_id=result["postId"], post_url=result["postUrl"])


@router.get("/{post_id}/check", response_model=PostCheck)
async def check_post(
    post_id: str,
    user_id: str = Depends(get_user_id),
) -> PostCheck:
    post = storage.get_post(post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="post not found")
    if post.get("userId") and post["userId"] != user_id:
        raise HTTPException(status_code=404, detail="post not found")
    clip = storage.get_clip(post["clipId"])
    if clip is None:
        raise HTTPException(status_code=404, detail="clip not found")

    views = youtube.stats(clip, post, user_id=user_id)
    check = analytics.build_post_check(clip, post_id, views)

    moment = storage.get_moment(clip.get("momentId", ""))
    if moment:
        playbook.record_outcome(moment.get("label", ""), check["verdict"])

    return PostCheck.model_validate(check)