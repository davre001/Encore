"""Post copy — title, caption, hashtags, tags for a cut.

Minds writes it when configured; otherwise the deterministic builder mirrors
src/lib/mockEditor.ts buildClipFromMoment exactly, so an un-keyed server
produces the same copy the mock UI shows today.
"""

from typing import Optional

from . import minds

# The exact hook lines from buildClipFromMoment().
_HOOKS: dict[str, str] = {
    "Confession hook": "I failed the exam on purpose.",
    "Talking-head tip": "Three things that fixed my study week.",
    "Exam-panic rant": "Nobody talks about the 2 a.m. spiral.",
}

_HASHTAGS = ["#studyvlog", "#encore", "#creator", "#shorts"]
_TAGS = ["study", "creator"]


def _transcript_hint(moment: dict, transcript: Optional[list[dict]]) -> str:
    """A short quote of what's actually said inside the moment, for the Mind."""
    if not transcript:
        return ""
    start, end = float(moment["start"]), float(moment["end"])
    said = " ".join(
        str(seg.get("text", ""))
        for seg in transcript
        if float(seg.get("end", 0)) >= start and float(seg.get("start", 0)) <= end
    ).strip()
    return f"What is said here: \"{said[:400]}\"." if said else ""


def build_post_copy(moment: dict, transcript: Optional[list[dict]] = None) -> dict:
    """Return {title, caption, hashtags, tags} for a moment."""
    label = str(moment.get("label", "Moment"))

    if minds.available():
        copy = minds.write_caption(label, _transcript_hint(moment, transcript))
        if copy:
            return copy

    # Deterministic fallback — byte-for-byte with buildClipFromMoment.
    title = _HOOKS.get(label, label)
    return {
        "title": title,
        "caption": f"{title}\n\nLong video → short cut. Encore kept the beat.",
        "hashtags": list(_HASHTAGS),
        "tags": list(_TAGS),
    }
