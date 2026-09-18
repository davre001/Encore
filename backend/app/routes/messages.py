"""Messages - notebook chat, per-user isolated."""

import logging
from typing import Optional

from fastapi import APIRouter, Depends

from .. import storage
from ..dependencies import get_user_id
from ..models.schemas import Message, MessageCreate, MessageEventCreate
from ..services import analytics, gemini, minds, youtube

router = APIRouter()
log = logging.getLogger("encore.messages")


@router.get("/{video_id}", response_model=list[Message])
async def list_messages(
    video_id: str,
    user_id: Optional[str] = Depends(get_user_id),
) -> list[Message]:
    """Return the persistent chat history for a video, scoped to this user."""
    history = _merged_history(video_id, user_id)
    return [Message.model_validate(m) for m in history]


@router.post("/events", response_model=Message)
async def save_editor_event(
    body: MessageEventCreate,
    user_id: Optional[str] = Depends(get_user_id),
) -> Message:
    """Persist an editor event into the same thread the AI uses as context."""
    saved = minds.save_chat_message(
        role=body.role,
        text=body.text,
        video_id=body.video_id,
        user_id=user_id,
    )
    storage.save_message({**saved, "userId": user_id})
    return Message.model_validate(saved)


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
    context_parts = [_editor_context(body.video_id)]
    if latest:
        context_parts.append(f"Latest post check: {latest['verdict']} at {latest['views']:,} views.")
    context = "\n".join(part for part in context_parts if part)

    memories = minds.get_persistent_memories(user_id)
    history = _merged_history(body.video_id, user_id)
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


def _merged_history(video_id: str, user_id: Optional[str]) -> list[dict]:
    rows: list[dict] = []
    rows.extend(storage.list_messages(video_id))
    rows.extend(minds.get_chat_history(video_id=video_id, user_id=user_id, limit=50))

    out: list[dict] = []
    seen: set[tuple[str, str, int]] = set()
    for row in sorted(rows, key=lambda item: int(item.get("createdAt", 0) or 0)):
        if user_id and row.get("userId") and row.get("userId") != user_id:
            continue
        key = (
            str(row.get("role", "")),
            str(row.get("text", "")),
            int(row.get("createdAt", 0) or 0),
        )
        if key in seen:
            continue
        seen.add(key)
        out.append(row)
    return out[-50:]


def _editor_context(video_id: str) -> str:
    video = storage.get_video(video_id)
    status = storage.get_analysis_status(video_id)
    moments = storage.list_moments(video_id)
    clips = storage.list_clips(video_id)
    posts = storage.list_posts(video_id)

    lines: list[str] = []
    if video:
        lines.append(
            f"Video: {video.get('name', 'Untitled')} ({float(video.get('duration') or 0):.1f}s)."
        )
    if status:
        lines.append(
            f"Analysis: {status.get('stage')} - {status.get('message')}"
        )
    if moments:
        pending = sum(1 for item in moments if item.get("status") == "pending")
        kept = sum(1 for item in moments if item.get("status") == "accepted")
        skipped = sum(1 for item in moments if item.get("status") == "rejected")
        lines.append(
            f"Moments: {len(moments)} total, {pending} pending, {kept} kept, {skipped} skipped."
        )
        for item in moments[:8]:
            lines.append(
                "- Moment: "
                f"{float(item.get('start') or 0):.1f}-{float(item.get('end') or 0):.1f}s, "
                f"{item.get('label', 'Moment')} [{item.get('status', 'pending')}]. "
                f"Reason: {item.get('reason', '')}"
            )
    else:
        lines.append("Moments: none currently loaded.")
    if clips:
        lines.append(f"Cuts: {len(clips)} created.")
        for clip in clips[:8]:
            hashtags = " ".join(clip.get("hashtags") or [])
            lines.append(
                "- Cut: "
                f"{float(clip.get('start') or 0):.1f}-{float(clip.get('end') or 0):.1f}s, "
                f"{clip.get('title', 'Untitled')}. Hashtags: {hashtags or 'none'}."
            )
    else:
        lines.append("Cuts: none created yet.")
    if posts:
        lines.append(f"Posts: {len(posts)} published/exported records.")
    return "\n".join(lines)


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
