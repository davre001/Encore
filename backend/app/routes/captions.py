"""Timed on-video captions for editor text layers."""

import re
from typing import Optional

from fastapi import APIRouter, Depends

from .. import storage
from ..dependencies import get_user_id
from ..models.schemas import CaptionGenerateRequest, CaptionSegment, CaptionTrack
from ..services import gemini, transcribe

router = APIRouter()

LANGUAGE_LABELS = gemini.LANGUAGE_LABELS


def _words(text: str) -> list[str]:
    return [
        part.strip()
        for part in re.sub(r"#[\w-]+", "", text).split()
        if part.strip()
    ]


def _clip_transcript(video_id: Optional[str], start: float, end: float) -> list[dict]:
    if not video_id:
        return []
    video = storage.get_video(video_id)
    src_path = video.get("srcPath") if video else None
    if not src_path:
        return []
    try:
        rows = transcribe.transcribe(src_path)
    except Exception:
        return []
    out: list[dict] = []
    for seg in rows:
        try:
            a = float(seg.get("start", 0))
            b = float(seg.get("end", 0))
        except (TypeError, ValueError):
            continue
        if b < start or a > end:
            continue
        text = str(seg.get("text", "")).strip()
        if text:
            out.append({"start": max(start, a), "end": min(end, b), "text": text})
    return out


def _fallback_segments(body: CaptionGenerateRequest, transcript: list[dict]) -> list[dict]:
    if transcript:
        label = LANGUAGE_LABELS.get(body.language, "English")
        return [
            {
                "start": item["start"],
                "end": item["end"],
                "text": item["text"] if body.language == "en" else f"[{label}] {item['text']}",
            }
            for item in transcript
        ]
    words = _words(body.caption or body.title or "Caption")
    chunks = [" ".join(words[i : i + 4]) for i in range(0, len(words), 4)]
    if not chunks:
        chunks = [body.title or "Caption"]
    span = max(body.end - body.start, 0.5)
    step = span / len(chunks)
    label = LANGUAGE_LABELS.get(body.language, "English")
    out: list[dict] = []
    for idx, text in enumerate(chunks):
        out.append(
            {
                "start": body.start + step * idx,
                "end": body.end if idx == len(chunks) - 1 else body.start + step * (idx + 1),
                "text": text if body.language == "en" else f"[{label}] {text}",
            }
        )
    return out


@router.post("/generate", response_model=CaptionTrack)
async def generate_captions(
    body: CaptionGenerateRequest,
    _user_id: Optional[str] = Depends(get_user_id),
) -> CaptionTrack:
    transcript = _clip_transcript(body.video_id, body.start, body.end)
    segments = gemini.propose_caption_segments(
        title=body.title,
        caption=body.caption,
        start=body.start,
        end=body.end,
        language=body.language,
        transcript=transcript,
    )
    if not segments:
        segments = _fallback_segments(body, transcript)

    return CaptionTrack(
        id=storage.new_id("captrack"),
        clip_id=body.clip_id,
        language=body.language,
        font_family="Inter",
        font_source="system",
        segments=[
            CaptionSegment(
                id=storage.new_id("capseg"),
                start=item["start"],
                end=item["end"],
                text=item["text"],
            )
            for item in segments
        ],
    )
