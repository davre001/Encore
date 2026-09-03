"""Speech-to-text via faster-whisper — the input that makes moment detection
transcript-driven rather than positional.

Capability-gated: if faster-whisper isn't installed (or ffmpeg is missing, since
it decodes audio through ffmpeg) this returns an empty transcript and the
pipeline falls back to positional beats. The model is imported lazily so the
package is only touched when actually used.
"""

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


def transcribe(path: str) -> list[dict]:
    """Return [{start, end, text}] segments, or [] when unavailable/failed."""
    if not path or not available():
        return []
    try:
        model = _get_model()
        segments, _info = model.transcribe(path)
        return [
            {"start": float(seg.start), "end": float(seg.end), "text": seg.text.strip()}
            for seg in segments
        ]
    except Exception:
        # Any decode/model error → no transcript; caller uses positional beats.
        return []
