"""Post grading — turns a view count into a hit/mid/flop verdict and note.

Mirrors src/lib/mockEditor.ts buildPostCheck and the ANALYTICS_MEDIAN grading
from src/lib/mockAnalytics.ts, so the verdict, note, and recut hook are exactly
what the mock produced.
"""

from ..config import ANALYTICS_MEDIAN, VERDICT_MIN_AGE_MS


def simulated_views(clip: dict) -> int:
    """Deterministic view count — the "failed" hook is the breakout, like the mock."""
    return 12400 if "failed" in str(clip.get("title", "")).lower() else 410


def too_early(created_at_ms: int | None, now_ms: int, min_age_ms: int = VERDICT_MIN_AGE_MS) -> bool:
    """Whether a post is too young for its view count to mean anything.

    A post with no recorded creation time is never treated as young: legacy rows
    would otherwise be locked out of grading forever.
    """
    if not created_at_ms:
        return False
    return now_ms - int(created_at_ms) < min_age_ms


def build_pending_check(clip: dict, post_id: str, views: int, age_ms: int) -> dict:
    """A check result for a post that is still too fresh to grade.

    No verdict and no recut hook: there is nothing yet to judge, and inventing
    one is what produced "0 views. Flop." seconds after an upload.
    """
    hours = max(age_ms / 3_600_000, 0.0)
    minutes = int(age_ms / 60_000)
    # Just-posted reads as "0.0h", so minutes carry the wait when it is under an
    # hour — and under a minute says so rather than reporting "0 minutes".
    if hours < 1:
        if minutes < 1:
            lived = "less than a minute"
        else:
            lived = f"{minutes} minute" + ("" if minutes == 1 else "s")
    else:
        lived = f"{hours:.1f} hours"
    return {
        "postId": post_id,
        "clipId": clip["id"],
        "views": views,
        "median": ANALYTICS_MEDIAN,
        "verdict": "pending",
        "note": (
            f"Live for {lived}. YouTube needs a few hours before a view count "
            "means anything, so this one is not graded yet."
        ),
    }


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
