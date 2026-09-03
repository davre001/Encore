"""Minds (MindsDB) agent adapter — the persistent AI brain.

Fully isolated and defensive on purpose: the exact minds-sdk surface can shift
between versions, so every call is capability-gated and wrapped so that a
missing package, a bad key, or an unexpected response shape returns None. Every
caller (analyze / captions / messages) treats None as "use the deterministic
fallback", so the server can never be broken by this module.

Config: MINDS_BUILDER_API_KEY + MINDS_ID (an existing Mind's name), optional
MINDS_BASE_URL for a custom server — all read in config.py. pip package:
`minds-sdk` (import root `minds`). API confirmed against
github.com/mindsdb/minds_python_sdk:
    from minds.client import Client
    client = Client(api_key, base_url=...)   # base_url optional
    mind = client.minds.get(name)
    resp = mind.completion(prompt)           # prompt positional
"""

import json
from typing import Optional

from ..config import MINDS_BASE_URL, MINDS_BUILDER_API_KEY, MINDS_ID, capabilities


def available() -> bool:
    return capabilities()["minds"]


def _mind():
    """Resolve the configured Mind, or None on any error."""
    try:
        from minds.client import Client  # lazy; package: minds-sdk

        # api_key is positional; base_url is optional (empty → Minds Cloud).
        client = (
            Client(MINDS_BUILDER_API_KEY, base_url=MINDS_BASE_URL)
            if MINDS_BASE_URL
            else Client(MINDS_BUILDER_API_KEY)
        )
        return client.minds.get(MINDS_ID)
    except Exception:
        return None


def complete(prompt: str) -> Optional[str]:
    """Single-shot completion against the Mind. None on any failure."""
    if not available():
        return None
    mind = _mind()
    if mind is None:
        return None
    try:
        resp = mind.completion(prompt)  # positional, per the SDK README
    except TypeError:
        # Tolerate a keyword signature across SDK versions.
        try:
            resp = mind.completion(message=prompt)
        except Exception:
            return None
    except Exception:
        return None
    if isinstance(resp, str):
        return resp
    # Be liberal about the response object's shape.
    for attr in ("content", "message", "text"):
        value = getattr(resp, attr, None)
        if isinstance(value, str):
            return value
    return str(resp) if resp is not None else None


def _complete_json(prompt: str):
    """Complete and parse a JSON body out of the reply, tolerating fences."""
    raw = complete(prompt)
    if not raw:
        return None
    text = raw.strip()
    if "```" in text:
        # Strip a ```json ... ``` fence if the model wrapped its answer.
        parts = text.split("```")
        for part in parts:
            candidate = part.strip()
            if candidate.startswith("json"):
                candidate = candidate[4:].strip()
            if candidate.startswith(("{", "[")):
                text = candidate
                break
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return None


# --- high-level helpers (all return None → caller falls back) --------------
def propose_moments(transcript: list[dict], span: float) -> Optional[list[dict]]:
    """Ask the Mind for standalone beats given a transcript.

    Expects a JSON list of {start, end, label, reason}. None on any problem.
    """
    if not available() or not transcript:
        return None
    lines = "\n".join(
        f"[{seg['start']:.1f}-{seg['end']:.1f}] {seg['text']}" for seg in transcript[:400]
    )
    prompt = (
        "You are Encore, cutting a long creator video into standalone short "
        f"beats. The take is {span:.0f}s long. From this transcript, pick 2-4 "
        "moments that stand alone as Shorts. Reply ONLY with a JSON array of "
        '{"start": seconds, "end": seconds, "label": short style label, '
        '"reason": one sentence why}.\n\nTranscript:\n' + lines
    )
    data = _complete_json(prompt)
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
    """Ask the Mind for {title, caption, hashtags, tags}. None on failure."""
    if not available():
        return None
    prompt = (
        "Write short-form post copy for a creator clip. Style label: "
        f"'{label}'. {hint} Reply ONLY as JSON with keys title (string), "
        "caption (string), hashtags (array of #tags), tags (array of plain "
        "words)."
    )
    data = _complete_json(prompt)
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


def chat_reply(text: str, context: str = "") -> Optional[str]:
    """Conversational reply for the notebook chat. None → keyword fallback."""
    if not available():
        return None
    prompt = (
        "You are Encore, a creator's editing copilot. Be terse and practical. "
        f"{context}\n\nCreator: {text}"
    )
    return complete(prompt)


def review_post(title: str, views: int, verdict: str) -> Optional[str]:
    """A one-line take on a post's performance. None → deterministic note."""
    if not available():
        return None
    prompt = (
        f"A clip titled '{title}' got {views} views and graded '{verdict}' "
        "against the creator's median. Give a one-sentence next step."
    )
    return complete(prompt)
