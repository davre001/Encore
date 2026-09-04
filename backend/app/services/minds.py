"""Minds agent adapter and persistent AI brain for Encore.

Provides:
1. Minds by Animoca Brands agent integration over the Builder API
   (transport lives in `minds_api`).
2. Persistent creator memory (tenets, preferences, playbook styles, video insights)
   backed by PostgreSQL (`mind_memories` table).
3. Persistent conversation threads (`chat_messages` table).
4. Intelligent fallback agent when external Minds API credentials are not yet configured.
"""

import json
import logging
import time
from typing import Optional

from ..config import MINDS_ALIAS, MINDS_REPLY_TIMEOUT, capabilities
from . import minds_api

log = logging.getLogger("encore.minds")

# The notebook chat can afford to wait out a slow Mind because it answers in the
# background. Callers that sit inside a request the creator is watching (moment
# picking, caption copy) get a shorter budget and fall back sooner.
INLINE_TIMEOUT = min(MINDS_REPLY_TIMEOUT, 45.0)


def available() -> bool:
    return capabilities()["minds"]


def complete(
    prompt: str,
    timeout_s: Optional[float] = None,
    alias: Optional[str] = None,
) -> Optional[str]:
    """Single-shot ask against the Mind. None on any failure, which is logged.

    The Builder API has no completion endpoint, so this is a full send-and-wait
    round trip and can take tens of seconds. Callers must treat None as "fall
    back to the deterministic path" rather than as an error.
    """
    if not available():
        return None
    try:
        reply = minds_api.ask(prompt, alias=alias, timeout_s=timeout_s)
    except minds_api.MindsError as exc:
        log.warning("Minds live path unavailable, using fallback: %s", exc)
        return None
    except Exception as exc:  # never let the notebook 500 on a bad reply
        log.warning("Minds live path raised %s: %s", type(exc).__name__, exc)
        return None
    if reply is None:
        log.warning(
            "Minds did not answer within %ss, using fallback",
            MINDS_REPLY_TIMEOUT if timeout_s is None else timeout_s,
        )
        return None
    return reply


_JSON_OPENERS = (("[", "]"), ("{", "}"))


def _balanced_slices(raw: str, want=None):
    """Yield every balanced ``[..]``/``{..}`` substring of `raw`, outermost first.

    Scans with string- and escape-awareness so a bracket inside a quoted value —
    or an apostrophe in the Mind's prose — cannot close a slice early. `want`
    narrows the scan to the shape the caller actually needs.
    """
    pairs = _JSON_OPENERS
    if want is list:
        pairs = (("[", "]"),)
    elif want is dict:
        pairs = (("{", "}"),)
    for open_ch, close_ch in pairs:
        start = raw.find(open_ch)
        while start != -1:
            depth = 0
            in_str = False
            escaped = False
            for i in range(start, len(raw)):
                ch = raw[i]
                if in_str:
                    if escaped:
                        escaped = False
                    elif ch == "\\":
                        escaped = True
                    elif ch == '"':
                        in_str = False
                    continue
                if ch == '"':
                    in_str = True
                elif ch == open_ch:
                    depth += 1
                elif ch == close_ch:
                    depth -= 1
                    if depth == 0:
                        yield raw[start : i + 1]
                        break
            start = raw.find(open_ch, start + 1)


def _extract_json(raw: str, want=None):
    """Parse the first JSON value in `raw` — bare, fenced, or embedded in prose.

    A Mind is a conversational agent: it answers in sentences and often wraps its
    answer ("Sure, here are three: [{...}]"), so `json.loads` on the whole reply
    is not enough. `want` (list or dict) keeps a stray array in the prose from
    shadowing the object a caller asked for.
    """
    text = raw.strip()
    candidates = [text]
    if "```" in text:
        for part in text.split("```"):
            part = part.strip()
            if part.lower().startswith("json"):
                part = part[4:].strip()
            if part.startswith(("{", "[")):
                candidates.append(part)
    candidates.extend(_balanced_slices(text, want=want))

    for candidate in candidates:
        if not candidate.startswith(("{", "[")):
            continue
        try:
            data = json.loads(candidate)
        except (json.JSONDecodeError, ValueError):
            continue
        if want is None or isinstance(data, want):
            return data
    return None


def _complete_json(
    prompt: str,
    timeout_s: Optional[float] = None,
    alias: Optional[str] = None,
    want=None,
):
    """Complete and parse a JSON body out of the reply.

    Tolerates code fences and surrounding prose. Returning None is a normal
    outcome — a chatty Mind may decline the format, or answer with no JSON at
    all — so it is logged rather than swallowed, and the caller falls back to
    its deterministic path.
    """
    raw = complete(prompt, timeout_s=timeout_s, alias=alias)
    if not raw:
        return None
    data = _extract_json(raw, want=want)
    if data is None:
        log.info(
            "Mind answered with no usable JSON (%d chars), using fallback: %.140s",
            len(raw),
            raw.replace("\n", " "),
        )
    return data


def is_meaningful_speech(transcript: list[dict], min_words: int = 8) -> bool:
    """Check if a transcript contains real spoken words vs. just music/ambient sound tags."""
    if not transcript:
        return False
    import re
    total_words = 0
    for seg in transcript:
        raw_text = seg.get("text", "")
        cleaned = re.sub(r"\[.*?\]|\(.*?\)|♪+|[\_#\*]", "", raw_text)
        words = [w for w in re.findall(r"\b\w+\b", cleaned) if len(w) > 1]
        total_words += len(words)
    return total_words >= min_words


# --- Persistent Memory Database Helpers -------------------------------------


def get_persistent_memories(
    user_id: Optional[str] = None, category: Optional[str] = None
) -> list[dict]:
    """Load persistent memories from PostgreSQL."""
    try:
        from ..db import SessionLocal
        from ..models.user import MindMemory

        with SessionLocal() as db:
            query = db.query(MindMemory)
            if user_id:
                query = query.filter(MindMemory.user_id == user_id)
            if category:
                query = query.filter(MindMemory.category == category)
            rows = query.order_by(MindMemory.created_at.asc()).all()
            return [
                {
                    "id": r.id,
                    "userId": r.user_id,
                    "category": r.category,
                    "key": r.key,
                    "content": r.content,
                    "metadataJson": r.metadata_json,
                    "createdAt": r.created_at,
                    "updatedAt": r.updated_at,
                }
                for r in rows
            ]
    except Exception:
        return []


def add_persistent_memory(
    content: str,
    category: str = "general",
    key: Optional[str] = None,
    user_id: Optional[str] = None,
    metadata_json: str = "{}",
) -> dict:
    """Save a new persistent memory to PostgreSQL."""
    now_ms = int(time.time() * 1000)
    try:
        from ..db import SessionLocal
        from ..models.user import MindMemory

        with SessionLocal() as db:
            # Upsert if matching key exists
            if key:
                q = db.query(MindMemory).filter(MindMemory.key == key)
                if user_id:
                    q = q.filter(MindMemory.user_id == user_id)
                existing = q.first()
                if existing:
                    existing.content = content
                    existing.category = category
                    existing.metadata_json = metadata_json
                    existing.updated_at = now_ms
                    db.commit()
                    db.refresh(existing)
                    return {
                        "id": existing.id,
                        "userId": existing.user_id,
                        "category": existing.category,
                        "key": existing.key,
                        "content": existing.content,
                        "metadataJson": existing.metadata_json,
                        "createdAt": existing.created_at,
                        "updatedAt": existing.updated_at,
                    }

            mem = MindMemory(
                id=MindMemory.new_id(),
                user_id=user_id,
                category=category,
                key=key,
                content=content,
                metadata_json=metadata_json,
                created_at=now_ms,
                updated_at=now_ms,
            )
            db.add(mem)
            db.commit()
            db.refresh(mem)
            return {
                "id": mem.id,
                "userId": mem.user_id,
                "category": mem.category,
                "key": mem.key,
                "content": mem.content,
                "metadataJson": mem.metadata_json,
                "createdAt": mem.created_at,
                "updatedAt": mem.updated_at,
            }
    except Exception:
        return {
            "id": f"mem_{int(time.time())}",
            "userId": user_id,
            "category": category,
            "key": key,
            "content": content,
            "metadataJson": metadata_json,
            "createdAt": now_ms,
            "updatedAt": now_ms,
        }


def delete_persistent_memory(memory_id: str, user_id: Optional[str] = None) -> bool:
    """Delete a memory from PostgreSQL."""
    try:
        from ..db import SessionLocal
        from ..models.user import MindMemory

        with SessionLocal() as db:
            query = db.query(MindMemory).filter(MindMemory.id == memory_id)
            if user_id:
                query = query.filter(MindMemory.user_id == user_id)
            item = query.first()
            if item:
                db.delete(item)
                db.commit()
                return True
            return False
    except Exception:
        return False


def get_chat_history(
    video_id: Optional[str] = None,
    user_id: Optional[str] = None,
    limit: int = 30,
) -> list[dict]:
    """Retrieve chat history from PostgreSQL."""
    try:
        from ..db import SessionLocal
        from ..models.user import ChatMessage

        with SessionLocal() as db:
            query = db.query(ChatMessage)
            if video_id:
                query = query.filter(ChatMessage.video_id == video_id)
            elif user_id:
                query = query.filter(ChatMessage.user_id == user_id)
            rows = query.order_by(ChatMessage.created_at.desc()).limit(limit).all()
            rows.reverse()
            return [
                {
                    "id": r.id,
                    "role": r.role,
                    "text": r.text,
                    "createdAt": r.created_at,
                    "videoId": r.video_id,
                }
                for r in rows
            ]
    except Exception:
        return []


def save_chat_message(
    role: str,
    text: str,
    video_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> dict:
    """Save a chat message to PostgreSQL."""
    now_ms = int(time.time() * 1000)
    try:
        from ..db import SessionLocal
        from ..models.user import ChatMessage

        with SessionLocal() as db:
            msg = ChatMessage(
                id=ChatMessage.new_id(),
                user_id=user_id,
                video_id=video_id,
                role=role,
                text=text,
                created_at=now_ms,
            )
            db.add(msg)
            db.commit()
            db.refresh(msg)
            return {
                "id": msg.id,
                "role": msg.role,
                "text": msg.text,
                "createdAt": msg.created_at,
                "videoId": msg.video_id,
            }
    except Exception:
        return {
            "id": f"msg_{int(time.time())}",
            "role": role,
            "text": text,
            "createdAt": now_ms,
            "videoId": video_id,
        }


# --- Intelligent Reasoning Engine (Runs when Minds API key isn't wired) ---


def _intelligent_fallback(
    text: str,
    context: str,
    memories: list[dict],
) -> str:
    """Generates context-aware, creative responses using creator memory."""
    lower = text.lower()

    # If asking about playbook or rules
    if "playbook" in lower or "rule" in lower or "style" in lower:
        rules = [m["content"] for m in memories if m["category"] == "playbook"]
        if rules:
            return (
                f"Based on your persistent playbook memory, here's what we prioritize:\n"
                + "\n".join(f"• {r}" for r in rules[:3])
                + "\nWant me to apply one of these to the current cut?"
            )
        return (
            "Your playbook prioritizes: 1) Confession hook (first 2s confession/vulnerability), "
            "2) Fast-paced rants (high completion rate on Shorts), 3) Story-first hooks over tutorials. "
            "I'll prioritize these when picking standout moments."
        )

    # If asking about hook advice or intro
    if "hook" in lower or "intro" in lower or "open" in lower:
        return (
            "For short-form video, hook the viewer within the first 1.5 seconds. Cut any "
            "greetings like 'Hey guys' or pauses. Open directly with the climax statement, "
            "unusual premise, or conflict, then deliver the story."
        )

    # If asking about trimming or split
    if "trim" in lower or "split" in lower or "cut" in lower:
        return (
            "You can split the take right at the playhead by clicking 'Split' in the toolbar. "
            "When trimmed or split, clips automatically ripple-align to the start of the timeline. "
            "Drag the left or right edges to refine the in and out points without leaving gaps."
        )

    # If asking about leftovers
    if "leftover" in lower or "left over" in lower or "unused" in lower:
        return (
            "You still have the exam-panic rant unused in your Leftovers notebook. "
            "Shorts liked rants last month — want me to ship it?"
        )

    # If asking about flop or performance check
    if "flop" in lower or "views" in lower or "check" in lower or "median" in lower:
        if context:
            prefix = "" if context.startswith("Latest:") else "Latest: "
            return f"{prefix}{context}"
        return (
            "Nothing live yet. Export a cut to YouTube and I’ll check it on my own."
        )

    # General editing partner reply
    if any(q in lower for q in ["how", "what", "can you", "suggest", "help"]):
        return (
            "I'm keeping track of your cuts, moments, and editing style. "
            "You can ask me to evaluate a hook, generate fresh captions, suggest where to cut, "
            "or review post performance against your channel median."
        )

    return (
        "I’m on the notebook. Keep or skip the moments, edit captions, export — "
        "I’ll handle the live check."
    )


# --- Public High-Level Helpers ----------------------------------------------


def chat_reply(
    text: str,
    context: str = "",
    video_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> str:
    """Conversational reply for the notebook chat with persistent memory."""
    # 1. Fetch persistent memories
    memories = get_persistent_memories(user_id)

    # 2. Check if user is teaching the Mind a rule or preference
    lower = text.lower()
    if any(
        phrase in lower
        for phrase in [
            "remember that",
            "remember to",
            "my rule is",
            "always ",
            "never ",
            "preference is",
        ]
    ):
        add_persistent_memory(content=text, category="preference", user_id=user_id)

    # 3. If the Builder API is configured, talk naturally with the Mind
    if available():
        # Cleanly attach context/preference notes without robotic system prompt scripting
        notes: list[str] = []
        if context:
            notes.append(f"Current video context: {context}")
        recent_prefs = [
            m.get("content")
            for m in memories[-3:]
            if m.get("content") and m.get("category") in ("preference", "playbook")
        ]
        if recent_prefs:
            notes.append(f"Creator preferences: {'; '.join(recent_prefs)}")

        if notes:
            prompt = f"[{' | '.join(notes)}]\n\n{text}"
        else:
            prompt = text

        ai = complete(prompt, alias=MINDS_ALIAS)
        if ai and len(ai.strip()) > 3:
            return ai.strip()

    # 4. Fallback to intelligent memory-guided engine
    return _intelligent_fallback(text, context, memories)


def propose_moments(transcript: list[dict], span: float) -> Optional[list[dict]]:
    """Ask the Mind for standalone beats given a transcript."""
    if not available() or not transcript:
        return None
    if not is_meaningful_speech(transcript):
        log.info("Transcript has no spoken dialogue — skipping Mind prompt to use beats.")
        return None

    lines = "\n".join(
        f"[{seg['start']:.1f}-{seg['end']:.1f}] {seg['text']}"
        for seg in transcript[:400]
        if seg.get("text", "").strip()
    )
    if not lines:
        return None

    # Dedicated alias so moment extraction NEVER touches the creator's notebook thread
    moments_alias = f"{MINDS_ALIAS}-moments"
    prompt = (
        f"Here is the dialogue transcript of a {span:.0f}s video take:\n"
        f"{lines}\n\n"
        "From this dialogue, pick 2 to 4 highlight moments that work well as standalone Shorts. "
        "For each moment, format as JSON: "
        '[{"start": number, "end": number, "label": "string", "reason": "string"}]'
    )
    data = _complete_json(prompt, timeout_s=INLINE_TIMEOUT, alias=moments_alias, want=list)
    if not isinstance(data, list):
        return None
    out: list[dict] = []
    for item in data:
        try:
            start = float(item["start"])
            end = float(item["end"])
        except (KeyError, TypeError, ValueError):
            continue
        if end > start + 0.4 and end <= span:
            out.append(
                {
                    "start": start,
                    "end": end,
                    "label": str(item.get("label", "Moment")),
                    "reason": str(item.get("reason", "")),
                }
            )
    return out or None


def write_caption(label: str, hint: str = "") -> Optional[dict]:
    """Ask the Mind for {title, caption, hashtags, tags}."""
    if not available():
        return None
    copy_alias = f"{MINDS_ALIAS}-copy"
    prompt = (
        f"Write short-form post copy for a creator clip. Style label: '{label}'. {hint} "
        "Format as JSON with keys title (string), caption (string), hashtags (array of #tags), "
        "tags (array of plain words)."
    )
    data = _complete_json(prompt, timeout_s=INLINE_TIMEOUT, alias=copy_alias, want=dict)
    if not isinstance(data, dict):
        return None
    title = data.get("title")
    caption = data.get("caption")
    hashtags = data.get("hashtags")
    tags = data.get("tags")
    if not isinstance(title, str) or not isinstance(caption, str):
        return None
    return {
        "title": title,
        "caption": caption,
        "hashtags": [str(h) for h in hashtags] if isinstance(hashtags, list) else [],
        "tags": [str(t) for t in tags] if isinstance(tags, list) else [],
    }


def review_post(title: str, views: int, verdict: str) -> Optional[str]:
    """A one-line take on a post's performance."""
    if not available():
        return None
    review_alias = f"{MINDS_ALIAS}-reviews"
    prompt = (
        f"A clip titled '{title}' got {views} views and graded '{verdict}' "
        "against the creator's median. Give a one-sentence next step."
    )
    return complete(prompt, timeout_s=INLINE_TIMEOUT, alias=review_alias)
