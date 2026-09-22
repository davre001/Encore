"""Messages - project chat threads, per-user isolated.

A thread belongs to a project and to nobody else: `/api/messages/{threadId}` with
a project id reads that project's chat and nothing else, so opening a new project
always opens an empty conversation.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends

from .. import storage
from ..dependencies import get_user_id
from ..models.schemas import Message, MessageCreate, MessageEventCreate
from ..services import analytics, gemini, minds, youtube

router = APIRouter()
log = logging.getLogger("encore.messages")


@router.get("/{thread_id}", response_model=list[Message])
async def list_messages(
    thread_id: str,
    user_id: Optional[str] = Depends(get_user_id),
) -> list[Message]:
    """Return the chat history of one project, scoped to this user."""
    history = _merged_history(thread_id, user_id)
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
        thread_id=body.thread_id,
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
    thread_id = body.thread_id
    user_msg = minds.save_chat_message(
        role="you",
        text=body.text,
        thread_id=thread_id,
        user_id=user_id,
    )
    storage.save_message({**user_msg, "userId": user_id})

    # The thread is the project, but everything worth telling the Mind about —
    # the take, its moments, its cuts, its posts — hangs off the video. Without
    # this hop the Mind would answer every question about a project that, as far
    # as it could see, had no video at all.
    video_id = _video_for_thread(thread_id)

    latest = _latest_check(video_id, user_id)
    context_parts = [_editor_context(video_id, user_id)]
    if latest:
        context_parts.append(f"Latest post check: {latest['verdict']} at {latest['views']:,} views.")
    context = "\n".join(part for part in context_parts if part)

    memories = minds.get_persistent_memories(user_id)
    history = _merged_history(thread_id, user_id)
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
                video_id=video_id,
                user_id=user_id,
            )

    return Message.model_validate(_save_reply(reply_text, thread_id, user_id))


def _save_reply(text: str, thread_id: str, user_id: Optional[str]) -> dict:
    mind_msg = minds.save_chat_message(
        role="mind", text=text, thread_id=thread_id, user_id=user_id
    )
    storage.save_message({**mind_msg, "userId": user_id})
    return mind_msg


def _video_for_thread(thread_id: str) -> str:
    """The video behind a project thread, for building the Mind's context.

    Falls back to the thread id itself so the diagnostic `/api/mind/chat` route
    and the pre-project thread still resolve to something harmless.
    """
    project = storage.get_project(thread_id)
    return (project or {}).get("videoId") or thread_id


def _merged_history(thread_id: str, user_id: Optional[str]) -> list[dict]:
    rows: list[dict] = []
    rows.extend(storage.list_messages(thread_id))
    rows.extend(minds.get_chat_history(thread_id=thread_id, user_id=user_id, limit=50))

    out: list[dict] = []
    seen: set[tuple[str, str, int]] = set()
    for row in sorted(rows, key=lambda item: int(item.get("createdAt", 0) or 0)):
        if user_id and row.get("userId") != user_id:
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


def _editor_context(video_id: str, user_id: Optional[str]) -> str:
    video = storage.get_video(video_id)
    status = storage.get_analysis_status(video_id)
    ai_settings = storage.get_ai_settings(user_id)
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
    if ai_settings:
        mode = ai_settings.get("aiPermissionMode", "ask")
        lines.append(
            "AI permission mode: "
            + ("Auto approve" if mode == "auto" else "Ask every time")
            + "."
        )
        # The thread is a reply channel, not a status feed. Left to itself the
        # model volunteered reports and next steps nobody asked for — "Best cut
        # ready: … Say 'add captions' to subtitle it, or 'post it' to publish" —
        # which the creator has to read and dismiss every time a step finishes.
        lines.append(
            "Reply only to what the creator's message asks. Do not volunteer status, "
            "summaries of what the editor has done, suggestions, or offers to do "
            "something next: the editor reports its own progress in the UI. Do not "
            "mention moments, cuts, captions, publishing or view counts unless the "
            "creator's message is about them. A greeting or a thank-you gets one "
            "short line back, not a report."
        )
        if mode == "auto":
            # Auto approve means the editor acts on its own, so the Mind must not
            # hand the work back. Without this the model offered to export cuts
            # that had already been published, and asked permission it already had.
            lines.append(
                "Auto approve is ON: the editor accepts the strongest moments, cuts "
                "them and publishes the best one by itself. Never ask the creator to "
                "confirm or approve anything, and never offer to do something that is "
                "already handled."
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
        live = [clip for clip in clips if clip.get("posted")]
        lines.append(f"Cuts: {len(clips)} created, {len(live)} already on YouTube.")
        for clip in clips[:8]:
            hashtags = " ".join(clip.get("hashtags") or [])
            # State each cut's publish status inline. The old context listed cuts
            # with no posted flag, so a live cut was indistinguishable from a
            # draft and the Mind kept offering to upload work that was already up.
            if clip.get("posted"):
                where = clip.get("postUrl") or "a live YouTube post"
                status = f"ALREADY PUBLISHED to YouTube at {where}"
            else:
                status = "not published yet"
            lines.append(
                "- Cut: "
                f"{float(clip.get('start') or 0):.1f}-{float(clip.get('end') or 0):.1f}s, "
                f"{clip.get('title', 'Untitled')} [{status}]. Hashtags: {hashtags or 'none'}."
            )
    else:
        lines.append("Cuts: none created yet.")
    if posts:
        published = ", ".join(
            str(post.get("postUrl") or post.get("postId") or "post")
            for post in posts[-5:]
        )
        lines.append(
            f"Posts: {len(posts)} published. Do not offer to publish these again: {published}."
        )
    return "\n".join(lines)


def _latest_check(video_id: str, user_id: Optional[str] = None) -> Optional[dict]:
    posts = storage.list_posts(video_id)
    if not posts:
        return None
    post = posts[-1]
    clip = storage.get_clip(post["clipId"])
    if clip is None:
        return None
    stats = youtube.stats(clip, post, user_id=user_id)
    views = int(stats.get("views") or 0)
    verdict = str(stats.get("verdict") or analytics.grade(views))
    return {"verdict": verdict, "views": views}
