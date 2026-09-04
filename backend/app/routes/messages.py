"""Messages — the creator's notebook chat with the Mind, backed by persistent memory.

A real Mind (Minds by Animoca Brands) answers asynchronously: there is no
completion endpoint, so a send is followed by polling the conversation history.
POST therefore returns a `pending` placeholder as soon as the creator's turn is
saved, hands the round trip to a background task, and the client polls
`GET /api/messages/{video_id}` until the reply row shows up.

With no Builder API key configured the deterministic fallback answers inline, so
POST stays synchronous and returns the real reply straight away.
"""

import logging
import time
from typing import Optional

from fastapi import APIRouter, BackgroundTasks

from ..models.schemas import Message, MessageCreate
from .. import storage
from ..services import analytics, minds, youtube

router = APIRouter()

log = logging.getLogger("encore.messages")

# Shown while a real Mind is composing. Not persisted — it is replaced by the
# reply the client polls for.
THINKING_TEXT = "On it — reading the take and thinking this through…"


@router.get("/{video_id}", response_model=list[Message])
async def list_messages(video_id: str) -> list[Message]:
    """Return the persistent chat history for a video."""
    history = minds.get_chat_history(video_id=video_id)
    if not history:
        history = storage.list_messages(video_id)
    return [Message.model_validate(m) for m in history]


@router.post("", response_model=Message)
async def send_message(body: MessageCreate, background: BackgroundTasks) -> Message:
    """Send a message to the Mind and return its memory-informed response.

    Returns the reply itself on the fallback path, or a `pending` placeholder
    when a live Mind is wired and the answer is still on its way.
    """
    # Save the creator's turn to persistent DB and storage.
    user_msg = minds.save_chat_message(
        role="you",
        text=body.text,
        video_id=body.video_id,
    )
    storage.save_message(user_msg)

    # Compute live video performance context if any.
    latest = _latest_check(body.video_id)
    context = (
        f"Latest: {latest['verdict']} at {latest['views']:,} views."
        if latest
        else ""
    )

    if minds.available():
        background.add_task(_answer_in_background, body.video_id, body.text, context)
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
    )
    return Message.model_validate(_save_reply(reply_text, body.video_id))


def _answer_in_background(video_id: str, text: str, context: str) -> None:
    """Round-trip the live Mind, then persist whatever came back.

    Runs after the response is sent. `chat_reply` already degrades to the
    deterministic engine when the live path fails, so the creator always gets an
    answer in history — never silence.
    """
    try:
        reply_text = minds.chat_reply(text=text, context=context, video_id=video_id)
    except Exception as exc:  # a background task must not die silently
        log.warning("Mind reply failed for %s: %s", video_id, exc)
        reply_text = (
            "I lost the thread on that one — the Mind did not come back. Ask again?"
        )
    _save_reply(reply_text, video_id)


def _save_reply(text: str, video_id: str) -> dict:
    """Persist the Mind's turn to the DB and the in-memory store."""
    mind_msg = minds.save_chat_message(role="mind", text=text, video_id=video_id)
    storage.save_message(mind_msg)
    return mind_msg


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
