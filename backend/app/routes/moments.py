"""Moments — list the proposed beats, and accept/reject each one.

Accepting a moment is what creates its clip: it writes the caption copy (Minds
or deterministic) and renders the cut (ffmpeg or no-op). Either decision is fed
to the playbook so taste accrues. The endpoint returns the updated Moment; the
new clip surfaces via GET /api/clips/{videoId}.
"""

from fastapi import APIRouter, HTTPException

from ..models.schemas import Clip, Moment, MomentDecision
from .. import storage
from ..services import captions, ffmpeg, playbook

router = APIRouter()


@router.get("/{video_id}", response_model=list[Moment])
async def list_moments(video_id: str) -> list[Moment]:
    return [Moment.model_validate(m) for m in storage.list_moments(video_id)]


@router.post("/{moment_id}/decide", response_model=Moment)
async def decide_moment(moment_id: str, body: MomentDecision) -> Moment:
    record = storage.get_moment(moment_id)
    if record is None:
        raise HTTPException(status_code=404, detail="moment not found")

    accepted = body.decision == "accept"
    updated = storage.update_moment(
        moment_id, {"status": "accepted" if accepted else "rejected"}
    )
    playbook.record_decision(record.get("label", ""), body.decision)

    if accepted:
        _build_clip(record)

    return Moment.model_validate(updated)


def _build_clip(moment: dict) -> None:
    """Create the clip for an accepted moment, once."""
    video_id = moment["videoId"]
    already = [
        c for c in storage.list_clips(video_id) if c.get("momentId") == moment["id"]
    ]
    if already:
        return  # idempotent: deciding twice won't duplicate the cut

    copy = captions.build_post_copy(moment)
    clip = Clip(
        id=storage.new_id("clip"),
        moment_id=moment["id"],
        video_id=video_id,
        title=copy["title"],
        caption=copy["caption"],
        hashtags=copy["hashtags"],
        tags=copy["tags"],
        start=moment["start"],
        end=moment["end"],
        posted=False,
    )
    storage.save_clip(clip.model_dump(by_alias=True))

    video = storage.get_video(video_id)
    src_path = video.get("srcPath") if video else None
    if src_path:
        ffmpeg.render_clip(src_path, clip.start, clip.end)  # best-effort
