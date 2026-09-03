"""ffmpeg/ffprobe adapters — real media work when the binaries exist, safe
no-ops when they don't.

Everything is wrapped so a missing binary or a bad file degrades to the
deterministic fallback (FALLBACK_DURATION for probing, the source path for
rendering) instead of raising — the server must run on a box with no ffmpeg.
"""

import os
import shutil
import subprocess
import uuid

from ..config import FALLBACK_DURATION, UPLOAD_DIR


def _has(binary: str) -> bool:
    return shutil.which(binary) is not None


def probe_duration(path: str) -> float:
    """Real length of a media file in seconds, or FALLBACK_DURATION.

    Mirrors the frontend's probeDuration → buildVideo fallback: an unreadable or
    metadata-less file yields the same 184s floor the mock uses.
    """
    if not path or not os.path.exists(path) or not _has("ffprobe"):
        return FALLBACK_DURATION
    try:
        out = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        value = float(out.stdout.strip())
        return value if value > 0 else FALLBACK_DURATION
    except (ValueError, OSError, subprocess.SubprocessError):
        return FALLBACK_DURATION


def render_clip(src_path: str, start: float, end: float) -> str:
    """Cut [start, end] out of src into a new file under UPLOAD_DIR.

    Returns the rendered path on success. With no ffmpeg (or on any failure)
    returns src_path unchanged — the clip still points at real footage, exactly
    as the frontend reuses the single uploaded blob for every cut.
    """
    if not src_path or not os.path.exists(src_path) or not _has("ffmpeg"):
        return src_path
    if end <= start:
        return src_path
    out_path = os.path.join(UPLOAD_DIR, f"clip_{uuid.uuid4().hex[:8]}.mp4")
    base = ["ffmpeg", "-y", "-ss", f"{start:.3f}", "-to", f"{end:.3f}", "-i", src_path]
    # Stream-copy first (fast, lossless); fall back to a re-encode if the cut
    # can't land on keyframes, then to the source if ffmpeg fails outright.
    for tail in (["-c", "copy", out_path], ["-c:v", "libx264", "-c:a", "aac", out_path]):
        try:
            result = subprocess.run(base + tail, capture_output=True, timeout=600)
            if result.returncode == 0 and os.path.exists(out_path) and os.path.getsize(out_path) > 0:
                return out_path
        except (OSError, subprocess.SubprocessError):
            continue
    return src_path
