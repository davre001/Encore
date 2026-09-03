"""Post grading — turns a view count into a hit/mid/flop verdict and note.

Mirrors src/lib/mockEditor.ts buildPostCheck and the ANALYTICS_MEDIAN grading
from src/lib/mockAnalytics.ts, so the verdict, note, and recut hook are exactly
what the mock produced.
"""

from ..config import ANALYTICS_MEDIAN


def simulated_views(clip: dict) -> int:
    """Deterministic view count — the "failed" hook is the breakout, like the mock."""
    return 12400 if "failed" in str(clip.get("title", "")).lower() else 410


def grade(views: int, median: int = ANALYTICS_MEDIAN) -> str:
    if views >= median * 2:
        return "hit"
    if views < median * 0.4:
        return "flop"
    return "mid"


def build_post_check(clip: dict, post_id: str, views: int) -> dict:
    """Assemble a PostCheck dict (camelCase) from a clip + its view count."""
    median = ANALYTICS_MEDIAN
    verdict = grade(views, median)
    note = {
        "hit": "3× your median. Keep this hook style.",
        "flop": "Buried. New hook ready from the same moment.",
        "mid": "Mid pack. Leave it and ship a leftover tomorrow.",
    }[verdict]
    check = {
        "postId": post_id,
        "clipId": clip["id"],
        "views": views,
        "median": median,
        "verdict": verdict,
        "note": note,
    }
    if verdict == "flop":
        # Curly quotes verbatim from buildPostCheck().
        check["recutHook"] = "Story-first open: “Nobody talks about the 2 a.m. spiral.”"
    return check
