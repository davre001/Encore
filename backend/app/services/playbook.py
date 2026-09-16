"""Persistent taste memory — the "playbook" the README promises.

Earned, never seeded. A fresh account starts with no playbook at all and rows
appear only as the creator actually works: moments kept/skipped
(record_decision) and posts landing hit/mid/flop (record_outcome). Stored as a
flat JSON list via the storage layer, so it survives restarts.

That means a brand-new creator is never shown a hit rate for a style they have
never posted — an empty playbook is the honest answer until there is evidence.
"""

from typing import Optional

from .. import storage


def style_for_label(label: str) -> str:
    """Map a moment label (e.g. "Exam-panic rant") to a playbook style."""
    lowered = label.lower()
    if "confession" in lowered:
        return "Confession hook"
    if "rant" in lowered or "panic" in lowered:
        return "Rant"
    if "story" in lowered:
        return "Story-first"
    if "talking-head" in lowered or "tip" in lowered:
        return "Talking-head tip"
    return label


def load_playbook() -> list[dict]:
    """Every style the creator has actually accrued — empty on a fresh account."""
    return storage.read_playbook()


def get_row(label: str) -> Optional[dict]:
    """The playbook row for a label's style, or None if unseen."""
    style = style_for_label(label)
    for row in load_playbook():
        if row.get("style") == style:
            return row
    return None


def _row_ref(rows: list[dict], style: str) -> dict:
    for row in rows:
        if row.get("style") == style:
            return row
    fresh = {"style": style, "sample": 0, "hitRate": 0.0, "note": ""}
    rows.append(fresh)
    return fresh


def record_decision(label: str, decision: str) -> None:
    """Log a keep/skip against a style so taste accrues over time."""
    style = style_for_label(label)
    rows = load_playbook()
    row = _row_ref(rows, style)
    if decision == "accept":
        row["kept"] = int(row.get("kept", 0)) + 1
    else:
        row["skipped"] = int(row.get("skipped", 0)) + 1
    storage.write_playbook(rows)


def record_outcome(label: str, verdict: str) -> None:
    """Fold a post's hit/mid/flop verdict into the style's rolling hit rate.

    The style's existing (sample, hitRate) are all real prior observations, so
    this is a running mean over the creator's own posts — only a "hit" counts
    toward the rate, matching the frontend's notion of hitRate. A style's first
    post therefore yields a sample of 1 and a rate of 1.0 or 0.0.
    """
    style = style_for_label(label)
    rows = load_playbook()
    row = _row_ref(rows, style)
    sample = int(row.get("sample", 0))
    rate = float(row.get("hitRate", 0.0))
    hit = 1.0 if verdict == "hit" else 0.0
    row["hitRate"] = round((rate * sample + hit) / (sample + 1), 4)
    row["sample"] = sample + 1
    storage.write_playbook(rows)
