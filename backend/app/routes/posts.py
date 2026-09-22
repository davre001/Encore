"""Posts - publish a rendered clip to YouTube and grade it later."""

import json
import os
import time

try:
    from googleapiclient.errors import HttpError
except ImportError:  # optional dependency guard
    HttpError = Exception

from fastapi import APIRouter, Depends, HTTPException

from .. import storage
from ..db import SessionLocal
from ..dependencies import get_user_id
from ..models.user import PostAnalytics, Project
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


def _safe_verdict(value: str | None) -> str:
    return value if value in {"hit", "mid", "flop"} else "mid"


def _upsert_post_analytics(
    *,
    user_id: str | None,
    clip: dict,
    post_id: str,
    post_url: str | None,
    views: int = 0,
    verdict: str = "mid",
    note: str | None = None,
) -> None:
    with SessionLocal() as db:
        query = db.query(PostAnalytics).filter(PostAnalytics.post_id == post_id)
        if user_id:
            query = query.filter(PostAnalytics.user_id == user_id)
        existing = query.first()
        title = clip.get("title") or "Untitled cut"
        hook = clip.get("title") or clip.get("caption") or "Cut from take"
        if existing:
            existing.title = title
            existing.hook = hook
            existing.views = views
            existing.verdict = _safe_verdict(verdict)
            existing.post_url = post_url
            existing.note = note
        else:
            db.add(
                PostAnalytics(
                    id=PostAnalytics.new_id(),
                    user_id=user_id,
                    video_id=clip.get("videoId"),
                    clip_id=clip.get("id"),
                    post_id=post_id,
                    title=title,
                    hook=hook,
                    views=views,
                    verdict=_safe_verdict(verdict),
                    day="Recent",
                    post_url=post_url,
                    note=note,
                    created_at=int(time.time() * 1000),
                )
            )
        db.commit()


def _update_project_from_post(
    *,
    user_id: str | None,
    clip: dict,
    post_id: str,
    post_url: str | None,
    views: int | None = None,
    verdict: str | None = None,
) -> None:
    video_id = clip.get("videoId")
    if not video_id:
        return
    with SessionLocal() as db:
        query = db.query(Project).filter(Project.video_id == video_id)
        if user_id:
            query = query.filter(Project.user_id == user_id)
        project = query.order_by(Project.updated_at.desc()).first()
        if not project:
            return
        project.status = "checked" if verdict else "posted"
        project.post_id = post_id
        project.post_url = post_url
        if views is not None:
            project.views = views
        if verdict in {"hit", "mid", "flop"}:
            project.verdict = verdict
        project.updated_at = int(time.time() * 1000)
        db.commit()


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

    posted_clip = storage.update_clip(
        clip_id,
        {"posted": True, "postId": result["postId"], "postUrl": result["postUrl"]},
    ) or {**clip, "id": clip_id}
    storage.save_post(
        {
            "id": result["postId"],
            "clipId": clip_id,
            "videoId": clip["videoId"],
            "userId": user_id,
            "postUrl": result["postUrl"],
            "views": 0,
            "verdict": "mid",
            "createdAt": storage.now_ms(),
        }
    )
    _upsert_post_analytics(
        user_id=user_id,
        clip=posted_clip,
        post_id=result["postId"],
        post_url=result["postUrl"],
    )
    _update_project_from_post(
        user_id=user_id,
        clip=posted_clip,
        post_id=result["postId"],
        post_url=result["postUrl"],
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

    stats = youtube.stats(clip, post, user_id=user_id)
    views = int(stats.get("views", 0) if isinstance(stats, dict) else stats)
    post_url = post.get("postUrl") or clip.get("postUrl")

    # A post checked while it is still fresh reads ~0 views, which grades as a
    # flop. That verdict is not merely a wrong label on screen: it is fed to the
    # playbook below, so a hook style got marked as failed seconds after going
    # live. Until the post is old enough to have a meaningful count, report the
    # pending state and leave the stored verdict, analytics, project and playbook
    # untouched.
    now = storage.now_ms()
    if analytics.too_early(post.get("createdAt"), now):
        pending = analytics.build_pending_check(clip, post_id, views, now - int(post["createdAt"]))
        storage.update_post(post_id, {"views": views, "postUrl": post_url, "checkedAt": now})
        return PostCheck.model_validate(pending)

    check = analytics.build_post_check(clip, post_id, views)
    storage.update_post(
        post_id,
        {
            "views": check["views"],
            "verdict": check["verdict"],
            "postUrl": post_url,
            "checkedAt": storage.now_ms(),
        },
    )
    _upsert_post_analytics(
        user_id=user_id,
        clip=clip,
        post_id=post_id,
        post_url=post_url,
        views=check["views"],
        verdict=check["verdict"],
        note=check["note"],
    )
    _update_project_from_post(
        user_id=user_id,
        clip=clip,
        post_id=post_id,
        post_url=post_url,
        views=check["views"],
        verdict=check["verdict"],
    )

    moment = storage.get_moment(clip.get("momentId", ""))
    if moment:
        playbook.record_outcome(moment.get("label", ""), check["verdict"])

    return PostCheck.model_validate(check)