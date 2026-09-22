"""Moments — list the proposed beats, and accept/reject each one.

Accepting a moment is what creates its clip: it writes the caption copy (Minds
or deterministic) and renders the cut (ffmpeg or no-op). Either decision is fed
to the playbook so taste accrues. The endpoint returns the updated Moment; the
new clip surfaces via GET /api/clips/{videoId}.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from ..dependencies import get_user_id
from ..models.schemas import Clip, Moment, MomentDecision
from .. import storage
from ..services import captions, playbook

router = APIRouter()

@router.get("/{video_id}", response_model=list[Moment])
async def list_moments(video_id: str) -> list[Moment]:
    """Every moment the detector proposed for this take, best-first.

    Do NOT filter rows by their label or reason here. The detector labels beats
    using the creator's own playbook styles ("Confession hook", "Talking-head
    tip", "Exam-panic rant"), so matching on those strings silently discarded
    real AI moments and left the Moments tab empty.
    """
    moments = [Moment.model_validate(m) for m in storage.list_moments(video_id)]
    # Best-first so callers taking the first N get the strongest beats. The sort
    # is stable, so rows that share a score (e.g. legacy rows with none) keep
    # their stored order.
    moments.sort(key=lambda moment: moment.score, reverse=True)
    return moments


@router.post("/{moment_id}/decide", response_model=Moment)
async def decide_moment(
    moment_id: str,
    body: MomentDecision,
    user_id: Optional[str] = Depends(get_user_id),
) -> Moment:
    record = storage.get_moment(moment_id)
    if record is None:
        raise HTTPException(status_code=404, detail="moment not found")

    accepted = body.decision == "accept"
    updated = storage.update_moment(
        moment_id, {"status": "accepted" if accepted else "rejected"}
    )
    playbook.record_decision(record.get("label", ""), body.decision)

    if accepted:
        # Called for its effect, not its return value: accepting a moment is what
        # renders its cut. The clip reaches the editor through
        # GET /api/clips/{videoId}.
        _build_clip(record, user_id)

    # Nothing is written to the chat thread here, deliberately. Keep and Skip
    # are buttons, and auto-approve is the editor acting on its own. Neither is
    # a prompt. The Moments row already shows Kept / Skipped, so a "Kept …
    # Cut created in Cuts." line would only be the editor talking to itself.
    return Moment.model_validate(updated)


def _build_clip(moment: dict, user_id: Optional[str] = None) -> dict:
    """Create the clip for an accepted moment, once, and return it.

    The clip carries the title written by the post-copy model, which usually
    differs from the moment's own label ("Clicking a Suspicious Link" becomes "I
    clicked the ultimate scam link"), so callers should use `title` rather than
    `label` when they need to name a cut.
    """
    video_id = moment["videoId"]
    already = [
        c for c in storage.list_clips(video_id) if c.get("momentId") == moment["id"]
    ]
    if already:
        return already[0]  # idempotent: deciding twice won't duplicate the cut

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
    record = clip.model_dump(by_alias=True)
    record["userId"] = user_id
    storage.save_clip(record)

    # Rendering is intentionally deferred until export/publish/file download.
    # Moment acceptance must stay fast so chat actions can create several cuts
    # without blocking on ffmpeg for each one.
    return record
