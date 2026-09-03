"""Posts — publish a clip to YouTube and grade it later.

Publish marks the clip posted and records the post (real upload when creds are
present, simulated id/URL otherwise). Check reads the live view count (or the
deterministic stand-in), grades it hit/mid/flop against the creator's median,
and folds the verdict back into the playbook via the originating moment.
"""

from fastapi import APIRouter, HTTPException

from ..models.schemas import PostCheck, PublishResult
from .. import storage
from ..services import analytics, playbook, youtube

router = APIRouter()


@router.post("/{clip_id}", response_model=PublishResult)
async def publish_clip(clip_id: str) -> PublishResult:
    clip = storage.get_clip(clip_id)
    if clip is None:
        raise HTTPException(status_code=404, detail="clip not found")

    video = storage.get_video(clip["videoId"])
    src_path = video.get("srcPath") if video else None
    result = youtube.publish(clip, src_path)

    storage.update_clip(
        clip_id,
        {"posted": True, "postId": result["postId"], "postUrl": result["postUrl"]},
    )
    storage.save_post(
        {"id": result["postId"], "clipId": clip_id, "videoId": clip["videoId"]}
    )
    return PublishResult(post_id=result["postId"], post_url=result["postUrl"])


@router.get("/{post_id}/check", response_model=PostCheck)
async def check_post(post_id: str) -> PostCheck:
    post = storage.get_post(post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="post not found")
    clip = storage.get_clip(post["clipId"])
    if clip is None:
        raise HTTPException(status_code=404, detail="clip not found")

    views = youtube.stats(clip, post)
    check = analytics.build_post_check(clip, post_id, views)

    moment = storage.get_moment(clip.get("momentId", ""))
    if moment:
        playbook.record_outcome(moment.get("label", ""), check["verdict"])

    return PostCheck.model_validate(check)
