"""Cut a transcript into caption cues that fit the frame and follow the voice.

Two rules decide everything here:

* A cue turns over when the speaker pauses, finishes a sentence, or has held the
  screen about as long as a subtitle should. Those breaks come from the audio's
  own timing (the gaps between words), so the captions change where the speech
  changes rather than on an even division of the clip.
* A cue has to fit the frame it will be drawn into. A 9:16 frame is narrow, so
  its lines are short; a 16:9 frame holds roughly twice the words. Cues are
  budgeted per aspect before they are ever rendered, which is the half of
  "keep captions inside the frame" that CSS cannot do.

Each cue keeps its words and their individual timings, which is what lets the
preview light up the word actually being spoken.
"""

import re

# A pause long enough to read as a break rather than a breath inside a phrase.
PAUSE_BREAK = 0.45
# Sentence-final punctuation ends a cue even when the speaker runs straight on.
_SENTENCE_END = re.compile(r"[.!?…]$")
# A cue stops growing here even with no pause to justify it, so a fast talker
# never gets a wall of text. The word cap is the frame's own budget (below).
MAX_CUE_SECONDS = 3.6

# Words per line by frame shape. Portrait frames are narrow: a long line either
# shrinks to unreadable or spills, so the budget is deliberately small.
_WORDS_PER_LINE = {
    "9:16": 4,
    "4:5": 4,
    "1:1": 5,
    "4:3": 7,
    "16:9": 8,
    "21:9": 8,
}
DEFAULT_WORDS_PER_LINE = 8
MAX_LINES = 2


def words_per_line(aspect: str) -> int:
    return _WORDS_PER_LINE.get((aspect or "").strip(), DEFAULT_WORDS_PER_LINE)


def _budget(aspect: str) -> int:
    """Most words one cue may hold in this frame (lines × words per line)."""
    return words_per_line(aspect) * MAX_LINES


def flatten(rows: list[dict], start: float, end: float) -> list[dict]:
    """Every spoken word inside [start, end], in time order.

    Falls back to the segment's own text when whisper returned no word timings
    (an older cached transcript, or a segment it could not align), spreading
    those words evenly across the segment so nothing is silently dropped.
    """
    out: list[dict] = []
    for row in rows or []:
        try:
            row_start = float(row.get("start", 0))
            row_end = float(row.get("end", 0))
        except (TypeError, ValueError):
            continue
        if row_end < start or row_start > end:
            continue
        words = row.get("words") or []
        if words:
            for word in words:
                try:
                    a = max(start, float(word.get("start", 0)))
                    b = min(end, float(word.get("end", 0)))
                except (TypeError, ValueError):
                    continue
                text = str(word.get("text", "")).strip()
                if text and b > a:
                    out.append({"start": a, "end": b, "text": text})
            continue
        text = str(row.get("text", "")).strip()
        parts = [p for p in text.split() if p]
        if not parts:
            continue
        a = max(start, row_start)
        b = min(end, row_end)
        if b <= a:
            continue
        step = (b - a) / len(parts)
        for index, part in enumerate(parts):
            out.append(
                {
                    "start": a + step * index,
                    "end": a + step * (index + 1),
                    "text": part,
                }
            )
    out.sort(key=lambda item: item["start"])
    return out


def _closes_a_beat(word: dict, next_word: dict | None, first: dict) -> bool:
    """Whether the cue should end after `word`."""
    if _SENTENCE_END.search(word["text"]):
        return True
    if next_word is None:
        return True
    if next_word["start"] - word["end"] >= PAUSE_BREAK:
        return True
    if word["end"] - first["start"] >= MAX_CUE_SECONDS:
        return True
    return False


def _split_to_budget(words: list[dict], budget: int) -> list[list[dict]]:
    """Break an over-long beat in two, at the strongest pause.

    Long beats happen: someone talks through a sentence for eight seconds. The
    break goes at the biggest gap, and between equal gaps the one nearest the
    middle, so the halves read as phrases rather than as an arbitrary cut.
    """
    parts: list[list[dict]] = []
    remaining = words
    while len(remaining) > budget:
        midpoint = len(remaining) / 2
        gaps = [
            (remaining[i + 1]["start"] - remaining[i]["end"], i)
            for i in range(len(remaining) - 1)
        ]
        _, index = max(
            gaps,
            key=lambda item: (round(item[0], 2), -abs(item[1] - midpoint)),
        )
        parts.append(remaining[: index + 1])
        remaining = remaining[index + 1 :]
    if remaining:
        parts.append(remaining)
    return parts


def group_into_beats(words: list[dict], aspect: str) -> list[list[dict]]:
    """Split words into cue-sized beats: pause, punctuation, length, then budget."""
    budget = _budget(aspect)
    beats: list[list[dict]] = []
    current: list[dict] = []
    for index, word in enumerate(words):
        current.append(word)
        nxt = words[index + 1] if index + 1 < len(words) else None
        if _closes_a_beat(word, nxt, current[0]):
            beats.append(current)
            current = []
    if current:
        beats.append(current)

    out: list[list[dict]] = []
    for beat in beats:
        out.extend(_split_to_budget(beat, budget) if len(beat) > budget else [beat])
    return [beat for beat in out if beat]


def build_cues(
    rows: list[dict],
    start: float,
    end: float,
    aspect: str,
    beat_marks: list[float] | None = None,
) -> list[dict]:
    """Cues for one clip range: [{start, end, text, words}].

    `beat_marks` are the times the editor already treats as the take's beats
    (its detected moments). A cue boundary landing on one means the captions
    turn over with the cut rather than a beat late.
    """
    words = flatten(rows, start, end)
    if not words:
        return []
    per_line = words_per_line(aspect)
    marks = sorted(float(m) for m in (beat_marks or []) if start < float(m) < end)

    cues: list[dict] = []
    for beat in group_into_beats(words, aspect):
        # Prefer a marked beat time inside this group when one exists: it is a
        # boundary the rest of the editor already agrees on.
        split_at = None
        for mark in marks:
            if len(beat) < 2:
                break
            if beat[0]["start"] < mark < beat[-1]["end"]:
                index = min(
                    range(len(beat) - 1),
                    key=lambda i: abs(beat[i]["end"] - mark),
                )
                if 0 < index + 1 < len(beat):
                    split_at = index + 1
                    break
        groups = (
            [beat[:split_at], beat[split_at:]]
            if split_at and len(beat) > per_line
            else [beat]
        )

        for group in groups:
            if not group:
                continue
            text = " ".join(word["text"] for word in group)
            text = re.sub(r"\s+([,.!?;:])", r"\1", text).strip()
            if not text:
                continue
            cues.append(
                {
                    "start": group[0]["start"],
                    "end": group[-1]["end"],
                    "text": text,
                    "words": [
                        {"start": w["start"], "end": w["end"], "text": w["text"]}
                        for w in group
                    ],
                }
            )
    return cues
