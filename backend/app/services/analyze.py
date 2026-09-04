"""Moment detection — where the standalone beats are.

Three tiers, best first, each falling through to the next so there is always an
answer:
  1. Minds proposes beats from the transcript (real AI).
  2. A transcript keyword scan times the known beats to real speech.
  3. Positional beats as fractions of the take — identical to the frontend's
     src/lib/mockEditor.ts buildMoments, so with no transcript the API returns
     exactly what the current mock UI shows.
"""

from ..config import FALLBACK_DURATION
from .. import storage
from . import minds

# The three demo beats as fractions of the take, verbatim from mockEditor.ts.
# Kept as the deterministic floor so fallback == the shipped mock behaviour.
BEATS: list[dict] = [
    {
        "at": (0.1, 0.24),
        "label": "Confession hook",
        "reason": "Strong open. Your last two confession hooks beat tutorials.",
        "keywords": ("fail", "confess", "honest", "truth", "admit"),
    },
    {
        "at": (0.34, 0.5),
        "label": "Talking-head tip",
        "reason": "You rejected two of these last week. Skip unless you want it.",
        "keywords": ("tip", "three things", "learned", "how i", "advice"),
    },
    {
        "at": (0.7, 0.84),
        "label": "Exam-panic rant",
        "reason": "Good leftover energy. Saved well for Shorts.",
        "keywords": ("panic", "spiral", "2 a.m.", "2am", "exam", "stress", "rant"),
    },
]


def _span(duration: float) -> float:
    return duration if isinstance(duration, (int, float)) and duration > 0 else FALLBACK_DURATION


def _round1(value: float) -> float:
    # JS Math.round semantics (round half up), not Python's round-half-to-even,
    # so positional beats match the frontend's buildMoments for any duration.
    # All inputs here are non-negative, so int(x + 0.5) == floor(x + 0.5).
    return int(value * 10 + 0.5) / 10


def _moment(video_id: str, start: float, end: float, label: str, reason: str) -> dict:
    return {
        "id": storage.new_id("mom"),
        "videoId": video_id,
        "start": start,
        "end": end,
        "label": label,
        "reason": reason,
        "status": "pending",
    }


def _from_beats(video_id: str, span: float) -> list[dict]:
    """Positional fallback — mirrors buildMoments() exactly."""
    out: list[dict] = []
    for beat in BEATS:
        start = _round1(beat["at"][0] * span)
        end = _round1(beat["at"][1] * span)
        if end > start + 0.4 and end <= span:
            out.append(_moment(video_id, start, end, beat["label"], beat["reason"]))
    return out


def _from_transcript(video_id: str, transcript: list[dict], span: float) -> list[dict]:
    """Time the known beats to real speech; [] if nothing matches (→ fallback)."""
    out: list[dict] = []
    matched = False
    for beat in BEATS:
        hit = None
        for seg in transcript:
            text = str(seg.get("text", "")).lower()
            if any(kw in text for kw in beat["keywords"]):
                hit = seg
                break
        if hit is not None:
            start = max(0.0, _round1(float(hit["start"])))
            end = min(span, _round1(float(hit["end"])))
            if end <= start + 0.4:
                end = min(span, start + 15.0)  # pad a too-short match
            if end > start + 0.4:
                out.append(_moment(video_id, start, end, beat["label"], beat["reason"]))
                matched = True
                continue
        # No keyword hit for this beat — keep its positional slot.
        start = _round1(beat["at"][0] * span)
        end = _round1(beat["at"][1] * span)
        if end > start + 0.4 and end <= span:
            out.append(_moment(video_id, start, end, beat["label"], beat["reason"]))
    return out if matched else []


def find_moments(video_id: str, duration: float, transcript: list[dict]) -> list[dict]:
    """Propose pending moments for a video. Always returns at least the beats."""
    span = _span(duration)

    # 1. Non-verbal or empty audio: immediately use positional beats without polling or prompt
    if not transcript or not minds.is_meaningful_speech(transcript):
        return _from_beats(video_id, span)

    # 2. Real dialogue: attempt AI proposal first
    if minds.available():
        proposed = minds.propose_moments(transcript, span)
        if proposed:
            return [
                _moment(video_id, p["start"], p["end"], p["label"], p["reason"])
                for p in proposed
            ]

    # 3. Speech keyword alignment
    from_tx = _from_transcript(video_id, transcript, span)
    if from_tx:
        return from_tx

    return _from_beats(video_id, span)
