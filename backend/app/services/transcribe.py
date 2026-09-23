"""Speech-to-text via faster-whisper — the input that makes moment detection
transcript-driven rather than positional, and captions word-accurate.

Capability-gated: if faster-whisper isn't installed (or ffmpeg is missing, since
it decodes audio through ffmpeg) this returns an empty transcript and the
pipeline falls back to positional beats. The model is imported lazily so the
package is only touched when actually used.
"""

from typing import Callable, Optional

from ..config import WHISPER_MODEL, capabilities

# faster-whisper reloads the weights per call otherwise; cache one model.
_MODEL = None


def available() -> bool:
    return capabilities()["whisper"]


def _get_model():
    global _MODEL
    if _MODEL is None:
        from faster_whisper import WhisperModel  # lazy, heavy

        # int8 on CPU keeps this runnable on a laptop with no GPU.
        _MODEL = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
    return _MODEL


def transcribe_words(
    path: str,
    on_progress: Optional[Callable[[float], None]] = None,
) -> list[dict]:
    """Return [{start, end, text, words: [{start, end, text}]}], or [] when unavailable.

    Word-level timings are what let a caption light up the word being spoken
    instead of guessing where inside a line the speaker is. `on_progress` is fed
    the fraction of the audio decoded so far — whisper hands segments back
    through a generator as it reads, so this is the job's real position and not
    an estimate. It is called per segment and never allowed to break the run.
    """
    if not path or not available():
        return []
    try:
        model = _get_model()
        segments, info = model.transcribe(path, word_timestamps=True)
        span = float(getattr(info, "duration", 0) or 0)
        rows: list[dict] = []
        for seg in segments:
            end = float(seg.end or 0)
            words = [
                {
                    "start": float(word.start or 0),
                    "end": float(word.end or 0),
                    "text": str(word.word or "").strip(),
                }
                for word in (getattr(seg, "words", None) or [])
                if str(word.word or "").strip()
            ]
            rows.append(
                {
                    "start": float(seg.start or 0),
                    "end": end,
                    "text": str(seg.text or "").strip(),
                    "words": words,
                }
            )
            if on_progress and span > 0:
                try:
                    on_progress(min(0.99, end / span))
                except Exception:
                    pass  # a listener must never kill the transcription
        return rows
    except Exception:
        # Any decode/model error → no transcript; caller uses positional beats.
        return []
