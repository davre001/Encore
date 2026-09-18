"""Messages - notebook chat, per-user isolated."""

import logging
from typing import Optional

from fastapi import APIRouter, Depends

from .. import storage
from ..dependencies import get_user_id
from ..models.schemas import Message, MessageCreate
from ..services import analytics, gemini, minds, youtube

router = APIRouter()
log = logging.getLogger("encore.messages")


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
            history = [
                m for m in history if m.get("userId") == user_id or not m.get("userId")
            ]
    return [Message.model_validate(m) for m in history]


@router.post("", response_model=Message)
async def send_message(
    body: MessageCreate,
    user_id: Optional[str] = Depends(get_user_id),
) -> Message:
    """Send a message and return the AI response with memory-informed context."""
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

    memories = minds.get_persistent_memories(user_id)
    history = minds.get_chat_history(video_id=body.video_id, user_id=user_id)
    reply_text: Optional[str] = None

    if gemini.available():
        reply_text = gemini.chat_reply(
            text=body.text,
            context=context,
            memories=memories,
            history=history,
        )

    if not reply_text:
        if gemini.available():
            err = gemini.last_error()
            reply_text = (
                err.get("message")
                if err
                else "The AI service could not answer that. Try again in a moment."
            )
        else:
            reply_text = minds.chat_reply(
                text=body.text,
                context=context,
                video_id=body.video_id,
                user_id=user_id,
            )

    return Message.model_validate(_save_reply(reply_text, body.video_id, user_id))


def _save_reply(text: str, video_id: str, user_id: Optional[str]) -> dict:
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
