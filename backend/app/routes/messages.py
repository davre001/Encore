"""Messages — notebook chat with the Mind, per-user isolated."""

import logging
import time
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends

from ..dependencies import get_user_id
from ..models.schemas import Message, MessageCreate
from .. import storage
from ..services import analytics, minds, youtube

router = APIRouter()
log = logging.getLogger("encore.messages")

THINKING_TEXT = "On it — reading the take and thinking this through…"


@router.get("/{video_id}", response_model=list[Message])
async def list_messages(
    video_id: str,
    user_id: Optional[str] = Depends(get_user_id),
) -> list[Message]:
    """Return the persistent chat history for a video, scoped to this user."""
    history = minds.get_chat_history(video_id=video_id, user_id=user_id)
    if not history:
        history = storage.list_messages(video_id)
        if user_id:
            history = [m for m in history if m.get("userId") == user_id or not m.get("userId")]
    return [Message.model_validate(m) for m in history]


@router.post("", response_model=Message)
async def send_message(
    body: MessageCreate,
    background: BackgroundTasks,
    user_id: Optional[str] = Depends(get_user_id),
) -> Message:
    """Send a message to the Mind and return its memory-informed response."""
    user_msg = minds.save_chat_message(
        role="you",
        text=body.text,
        video_id=body.video_id,
        user_id=user_id,
    )
    storage.save_message({**user_msg, "userId": user_id})

    latest = _latest_check(body.video_id)
    context = (
        f"Latest: {latest['verdict']} at {latest['views']:,} views."
        if latest
        else ""
    )

    if minds.available():
        background.add_task(
            _answer_in_background, body.video_id, body.text, context, user_id
        )
        return Message(
            id=f"pending_{user_msg['id']}",
            role="mind",
            text=THINKING_TEXT,
            created_at=int(time.time() * 1000),
            pending=True,
        )

    reply_text = minds.chat_reply(
        text=body.text,
        context=context,
        video_id=body.video_id,
        user_id=user_id,
    )
    return Message.model_validate(
        _save_reply(reply_text, body.video_id, user_id)
    )


def _answer_in_background(
    video_id: str, text: str, context: str, user_id: Optional[str]
) -> None:
    try:
        reply_text = minds.chat_reply(
            text=text, context=context, video_id=video_id, user_id=user_id
        )
    except Exception as exc:
        log.warning("Mind reply failed for %s: %s", video_id, exc)
        reply_text = (
            "I lost the thread on that one — the Mind did not come back. Ask again?"
        )
    _save_reply(reply_text, video_id, user_id)


def _save_reply(
    text: str, video_id: str, user_id: Optional[str]
) -> dict:
    mind_msg = minds.save_chat_message(
        role="mind", text=text, video_id=video_id, user_id=user_id
    )
    storage.save_message({**mind_msg, "userId": user_id})
    return mind_msg


def _latest_check(video_id: str) -> Optional[dict]:
    posts = storage.list_posts(video_id)
    if not posts:
        return None
    post = posts[-1]
    clip = storage.get_clip(post["clipId"])
    if clip is None:
        return None
    views = youtube.stats(clip, post)
    return {"verdict": analytics.grade(views), "views": views}
