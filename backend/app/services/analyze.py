"""Real moment detection from a video's transcript.

Encore should not show demo beats as if they came from the user's video. This
module only returns moments grounded in transcribed speech or an AI proposal
made from that transcript. If there is no meaningful speech, it returns [].
"""

from ..config import FALLBACK_DURATION
from .. import storage
from . import gemini, minds


def _span(duration: float) -> float:
    return duration if isinstance(duration, (int, float)) and duration > 0 else FALLBACK_DURATION


def _round1(value: float) -> float:
    return int(value * 10 + 0.5) / 10


def _moment(video_id: str, start: float, end: float, label: str, reason: str) -> dict:
    return {
        "id": storage.new_id("mom"),
        "videoId": video_id,
        "start": _round1(start),
        "end": _round1(end),
        "label": label,
        "reason": reason,
        "status": "pending",
    }


def _from_transcript_chunks(video_id: str, transcript: list[dict], span: float) -> list[dict]:
    """Neutral fallback: group actual speech into usable chunks."""
    chunks: list[dict] = []
    current: list[dict] = []
    for seg in transcript:
        text = str(seg.get("text", "")).strip()
        if not text:
            continue
        try:
            start = float(seg.get("start", 0))
            end = float(seg.get("end", 0))
        except (TypeError, ValueError):
            continue
        if not current:
            current = [{"start": start, "end": end, "text": text}]
            continue
        cur_start = float(current[0]["start"])
        cur_end = float(current[-1]["end"])
        if end - cur_start <= 24 and start - cur_end <= 2.5:
            current.append({"start": start, "end": end, "text": text})
        else:
            chunks.append({"start": cur_start, "end": cur_end, "rows": current})
            current = [{"start": start, "end": end, "text": text}]
    if current:
        chunks.append({"start": current[0]["start"], "end": current[-1]["end"], "rows": current})

    out: list[dict] = []
    for index, chunk in enumerate(chunks[:5], start=1):
        start = max(0.0, float(chunk["start"]))
        end = min(span, float(chunk["end"]))
        if end <= start + 0.4:
            continue
        first_text = str(chunk["rows"][0].get("text", "")).strip()
        label = first_text[:42].rstrip(" .,") or f"Speech moment {index}"
        out.append(
            _moment(
                video_id,
                start,
                end,
                label,
                "Detected from the video's spoken transcript.",
            )
        )
    return out


def find_moments(
    video_id: str,
    duration: float,
    transcript: list[dict],
    src_path: str | None = None,
) -> list[dict]:
    span = _span(duration)
    proposed = None

    if src_path and gemini.available():
        proposed = gemini.propose_video_moments(src_path, transcript, span)
    if proposed:
        return [
            _moment(video_id, item["start"], item["end"], item["label"], item["reason"])
            for item in proposed
        ]

    if not transcript or not minds.is_meaningful_speech(transcript):
        return []

    proposed = gemini.propose_moments(transcript, span)
    if not proposed and minds.available():
        proposed = minds.propose_moments(transcript, span)
    if proposed:
        return [
            _moment(video_id, item["start"], item["end"], item["label"], item["reason"])
            for item in proposed
        ]

    return []
