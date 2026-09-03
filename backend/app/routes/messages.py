"""Messages — the creator's notebook chat with the Mind.

GET returns the stored thread for a video. POST saves the creator's line, asks
the Mind for a reply (falling back to the frontend's exact keyword responses
when Minds isn't wired), saves that too, and returns the Mind's message.
"""

from typing import Optional

from fastapi import APIRouter

from ..models.schemas import Message, MessageCreate
from .. import storage
from ..services import analytics, minds, youtube

router = APIRouter()


@router.get("/{video_id}", response_model=list[Message])
async def list_messages(video_id: str) -> list[Message]:
    return [Message.model_validate(m) for m in storage.list_messages(video_id)]


@router.post("", response_model=Message)
async def send_message(body: MessageCreate) -> Message:
    storage.save_message(
        {
            "id": storage.new_id("msg"),
            "role": "you",
            "text": body.text,
            "createdAt": storage.now_ms(),
            "videoId": body.video_id,
        }
    )

    mind = {
        "id": storage.new_id("msg"),
        "role": "mind",
        "text": _reply(body.video_id, body.text),
        "createdAt": storage.now_ms(),
        "videoId": body.video_id,
    }
    storage.save_message(mind)
    return Message.model_validate(mind)


def _latest_check(video_id: str) -> Optional[dict]:
    """Recompute the newest post's views + verdict for this video, if any."""
    posts = storage.list_posts(video_id)
    if not posts:
        return None
    post = posts[-1]
    clip = storage.get_clip(post["clipId"])
    if clip is None:
        return None
    views = youtube.stats(clip, post)
    return {"verdict": analytics.grade(views), "views": views}


def _reply(video_id: str, text: str) -> str:
    latest = _latest_check(video_id)

    # Real brain first, with a little live context.
    context = (
        f"Most recent post: {latest['verdict']} at {latest['views']} views."
        if latest
        else "No posts are live yet."
    )
    ai = minds.chat_reply(text, context)
    if ai:
        return ai

    # Deterministic keyword fallback — verbatim from Editor.handleSend.
    lower = text.lower()
    if "leftover" in lower or "left over" in lower:
        return (
            "You still have the exam-panic rant unused. Shorts liked rants last "
            "month — want me to ship it?"
        )
    if "flop" in lower or "check" in lower:
        if latest:
            return f"Latest: {latest['verdict']} at {latest['views']:,} views."
        return (
            "Nothing live yet. Export a cut to YouTube and I’ll check it on my own."
        )
    return (
        "I’m on the notebook. Keep or skip the moments, edit captions, export — "
        "I’ll handle the live check."
    )
