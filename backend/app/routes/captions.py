"""Timed on-video captions for editor text layers.

Generation runs as a background job, not inside the request. Reading a take
through whisper is slow — it decodes the whole video — and holding the request
open meant the editor had nothing to show while it waited. The POST starts the
job, `GET /{clip_id}/job` reports where it is, and the editor's loader follows
the same bar the moments job already uses.

The timings come from the audio, not from a model asked to invent them: cues are
cut from whisper's word-level transcript, so the caption on screen names the word
the speaker is actually saying. Gemini is used only for what a transcript cannot
give — cue text in a language the take was not spoken in.
"""

import re
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends

from .. import storage
from ..dependencies import get_user_id
from ..models.schemas import (
    CaptionGenerateRequest,
    CaptionJob,
    CaptionSegment,
    CaptionTrack,
    CaptionWord,
)
from ..services import caption_cues, gemini, transcribe

router = APIRouter()

LANGUAGE_LABELS = gemini.LANGUAGE_LABELS

# Share of the bar each phase owns. Transcription is most of the work and is the
# only phase whose position is measurable, so it owns most of the bar.
_QUEUED = 5
_TRANSCRIBE_FROM = 5
_TRANSCRIBE_TO = 60
_BEATS = 72
_FITTING = 86
_COMPLETE = 100

# One job per clip at a time, same guard as the moment analysis.
_ACTIVE_JOBS: set[str] = set()


def _words(text: str) -> list[str]:
    return [
        part.strip()
        for part in re.sub(r"#[\w-]+", "", text).split()
        if part.strip()
    ]


def _publish(clip_id: str, stage: str, message: str, **extra) -> dict:
    return storage.save_caption_job(
        clip_id,
        {
            "stage": stage,
            "message": message,
            "done": stage in {"complete", "error"},
            **extra,
        },
    )


def _progress(stage: str, fraction: float) -> int:
    """Bar position for a transcription fraction, in the transcribing band."""
    band = _TRANSCRIBE_TO - _TRANSCRIBE_FROM
    return int(round(_TRANSCRIBE_FROM + max(0.0, min(1.0, fraction)) * band))


def _clip_transcript(video_id: Optional[str], on_progress) -> tuple[list[dict], bool]:
    """Word-level rows for a video, from cache when the take was already read.

    Returns (rows, from_speech). The moments job transcribes on upload, so the
    usual case here is a cache hit and no second read of the video at all.
    """
    if not video_id:
        return [], False
    cached = storage.get_transcript(video_id)
    if cached is not None:
        if on_progress:
            on_progress(1.0)
        return cached, bool(cached)
    video = storage.get_video(video_id)
    src_path = (video or {}).get("srcPath")
    if not src_path:
        return [], False
    rows = transcribe.transcribe_words(src_path, on_progress=on_progress)
    if rows:
        storage.save_transcript(video_id, rows)
    return rows, bool(rows)


def _from_words(rows: list[dict], body: CaptionGenerateRequest) -> list[dict]:
    """Cues cut from the real transcript, with the language applied."""
    marks = [
        float(moment.get("start", 0))
        for moment in storage.list_moments(body.video_id or "")
        if moment.get("start") is not None
    ]
    cues = caption_cues.build_cues(
        rows, body.start, body.end, body.aspect, beat_marks=marks
    )
    if not cues or body.language == "en":
        return cues
    label = LANGUAGE_LABELS.get(body.language, "English")
    translated = gemini.translate_cues([cue["text"] for cue in cues], label)
    if not translated:
        # No translation available: say which language the line is in rather
        # than silently presenting English as the requested language.
        return [{**cue, "text": f"[{label}] {cue['text']}"} for cue in cues]
    return [
        {**cue, "text": text, "words": []}
        for cue, text in zip(cues, translated)
        if str(text).strip()
    ]


def _estimated_segments(body: CaptionGenerateRequest, transcript: list[dict]) -> list[dict]:
    """Timings we did not hear: real transcript rows, or a split of the copy.

    Both carry word timings so the preview still moves word by word; the track
    is marked `estimated` so nobody is told these are the speaker's own beats.
    """
    label = LANGUAGE_LABELS.get(body.language, "English")

    if transcript:
        rows = [
            {
                "start": item["start"],
                "end": item["end"],
                "text": item["text"],
                "words": item.get("words") or [],
            }
            for item in transcript
            if float(item.get("end", 0)) >= body.start
            and float(item.get("start", 0)) <= body.end
        ]
        cues = caption_cues.build_cues(
            rows, body.start, body.end, body.aspect
        )
        if cues:
            return [
                {
                    **cue,
                    "text": cue["text"]
                    if body.language == "en"
                    else f"[{label}] {cue['text']}",
                }
                for cue in cues
            ]

    words = _words(body.caption or body.title or "Caption")
    chunks = [" ".join(words[i : i + 4]) for i in range(0, len(words), 4)]
    if not chunks:
        chunks = [body.title or "Caption"]
    span = max(body.end - body.start, 0.5)
    step = span / len(chunks)
    out: list[dict] = []
    for idx, text in enumerate(chunks):
        a = body.start + step * idx
        b = body.end if idx == len(chunks) - 1 else body.start + step * (idx + 1)
        parts = [part for part in text.split() if part]
        word_step = (b - a) / max(len(parts), 1)
        out.append(
            {
                "start": a,
                "end": b,
                "text": text if body.language == "en" else f"[{label}] {text}",
                "words": [
                    {
                        "start": a + word_step * i,
                        "end": a + word_step * (i + 1),
                        "text": part,
                    }
                    for i, part in enumerate(parts)
                ],
            }
        )
    return out


def _build_caption_track(body: CaptionGenerateRequest) -> None:
    """The whole caption job. Never raises — failures land on the job record."""
    clip_id = body.clip_id
    if clip_id in _ACTIVE_JOBS:
        return
    _ACTIVE_JOBS.add(clip_id)
    try:
        _publish(clip_id, "transcribing", "Reading the take's speech.", progress=_QUEUED)
        rows, from_speech = _clip_transcript(
            body.video_id,
            lambda fraction: _publish(
                clip_id,
                "transcribing",
                "Reading the take's speech.",
                progress=_progress("transcribing", fraction),
            ),
        )

        segments: list[dict] = []
        if from_speech:
            _publish(
                clip_id, "beats", "Cutting the speech into beats.", progress=_BEATS
            )
            segments = _from_words(rows, body)
            if not segments:
                # Speech, but nothing inside this clip's range.
                _publish(clip_id, "fitting", "Fitting captions to the frame.", progress=_FITTING)
                segments = _estimated_segments(body, [])
        else:
            _publish(clip_id, "beats", "Reading the words in the copy.", progress=_BEATS)
            proposed = gemini.propose_caption_segments(
                title=body.title,
                caption=body.caption,
                start=body.start,
                end=body.end,
                language=body.language,
                transcript=[],
            )
            _publish(clip_id, "fitting", "Fitting captions to the frame.", progress=_FITTING)
            segments = (
                [
                    {
                        "start": item["start"],
                        "end": item["end"],
                        "text": item["text"],
                        "words": [],
                    }
                    for item in proposed
                ]
                if proposed
                else _estimated_segments(body, [])
            )

        source = "speech" if from_speech and segments else "estimated"
        track = CaptionTrack(
            id=storage.new_id("captrack"),
            clip_id=clip_id,
            language=body.language,
            font_family="Inter",
            font_source="system",
            source=source,
            segments=[
                CaptionSegment(
                    id=storage.new_id("capseg"),
                    start=item["start"],
                    end=item["end"],
                    text=item["text"],
                    words=[
                        CaptionWord(
                            start=word["start"], end=word["end"], text=word["text"]
                        )
                        for word in item.get("words") or []
                    ],
                )
                for item in segments
            ],
        )
        count = len(track.segments)
        _publish(
            clip_id,
            "complete",
            f"{count} caption{'s' if count != 1 else ''} placed on the beat.",
            progress=_COMPLETE,
            track=track.model_dump(by_alias=True),
        )
    except Exception as error:  # a dead job must not take the server with it
        _publish(
            clip_id,
            "error",
            "Couldn't generate captions for this cut.",
            progress=_COMPLETE,
            error=str(error),
        )
    finally:
        _ACTIVE_JOBS.discard(clip_id)


@router.post("/generate", response_model=CaptionJob)
async def generate_captions(
    body: CaptionGenerateRequest,
    background_tasks: BackgroundTasks,
    _user_id: Optional[str] = Depends(get_user_id),
) -> CaptionJob:
    """Start a caption run and return its job, for the editor to poll."""
    _ACTIVE_JOBS.discard(body.clip_id)  # a re-run supersedes a stuck job
    job = _publish(
        body.clip_id,
        "queued",
        "Queued caption generation.",
        progress=_QUEUED,
        track=None,
        error=None,
    )
    background_tasks.add_task(_build_caption_track, body)
    return CaptionJob.model_validate(job)


@router.get("/{clip_id}/job", response_model=CaptionJob)
async def get_caption_job(
    clip_id: str,
    _user_id: Optional[str] = Depends(get_user_id),
) -> CaptionJob:
    job = storage.get_caption_job(clip_id) or {
        "clipId": clip_id,
        "stage": "error",
        "message": "No caption job has run for this cut.",
        "progress": 0,
        "done": True,
    }
    return CaptionJob.model_validate(job)
