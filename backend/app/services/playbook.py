"""Persistent taste memory — the "playbook" the README promises.

Seeded from the frontend's src/lib/mockAnalytics.ts so a fresh install already
knows the creator's leanings, then updated for real as moments are kept/skipped
(record_decision) and posts land hit/mid/flop (record_outcome). Stored as a flat
JSON list via the storage layer, so it survives restarts.

Consumed by analyze/captions to bias what gets proposed and how it's framed.
"""

from typing import Optional

from .. import storage

# The four rows from mockAnalytics.ts `playbook`, verbatim. `sample`/`hitRate`
# act as a prior; record_outcome nudges them with real observations.
DEFAULT_PLAYBOOK: list[dict] = [
    {
        "style": "Confession hook",
        "sample": 8,
        "hitRate": 0.75,
        "note": "First two seconds as a guilty line. Keep using.",
    },
    {
        "style": "Rant",
        "sample": 5,
        "hitRate": 0.6,
        "note": "Shorts like these. Save leftovers for Sunday.",
    },
    {
        "style": "Story-first",
        "sample": 4,
        "hitRate": 0.5,
        "note": "Better than tutorials on Reels / Shorts.",
    },
    {
        "style": "Talking-head tip",
        "sample": 6,
        "hitRate": 0.16,
        "note": "You skip these. Encore will stop pushing them.",
    },
]


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
    """Return the playbook, seeding the defaults on first use."""
    rows = storage.read_playbook()
    if not rows:
        rows = [dict(row) for row in DEFAULT_PLAYBOOK]
        storage.write_playbook(rows)
    return rows


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

    Treats the seeded (sample, hitRate) as prior observations and updates the
    running mean — only a "hit" counts toward the rate, matching the frontend's
    notion of hitRate.
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
