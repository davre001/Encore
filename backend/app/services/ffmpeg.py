"""ffmpeg/ffprobe adapters — real media work when the binaries exist, safe
no-ops when they don't.

Everything is wrapped so a missing binary or a bad file degrades to the
deterministic fallback (FALLBACK_DURATION for probing, the source path for
rendering) instead of raising — the server must run on a box with no ffmpeg.
"""

import os
import re
import shutil
import subprocess
import uuid
from typing import Optional

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



def probe_dimensions(path: str) -> tuple[Optional[int], Optional[int]]:
    """Real pixel size of a media file, or (None, None) when unreadable.

    The editor also probes this in the browser on import; this copy is for the
    server's own record of the take (and for caption line budgets when the
    client has not said which frame it is drawing into).
    """
    if not path or not os.path.exists(path) or not _has("ffprobe"):
        return None, None
    try:
        out = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height",
                "-of",
                "csv=s=x:p=0",
                path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        width, _, height = out.stdout.strip().partition("x")
        w, h = int(width), int(height)
        return (w, h) if w > 0 and h > 0 else (None, None)
    except (ValueError, OSError, subprocess.SubprocessError):
        return None, None


def _drawtext_escape(value: str) -> str:
    """Escape user caption text for ffmpeg drawtext."""
    value = re.sub(r"\s+", " ", value or "").strip()
    return (
        value.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "\\'")
        .replace("%", "\\%")
        .replace("[", "\\[")
        .replace("]", "\\]")
    )


def _caption_filter(start: float, end: float, caption_segments: list[dict] | None) -> str:
    filters: list[str] = []
    for segment in caption_segments or []:
        try:
            seg_start = max(0.0, float(segment.get("start", 0)) - start)
            seg_end = min(end - start, float(segment.get("end", 0)) - start)
        except (TypeError, ValueError):
            continue
        text = _drawtext_escape(str(segment.get("text", "")))
        if not text or seg_end <= seg_start:
            continue
        filters.append(
            "drawtext="
            f"text='{text}':"
            "x=(w-text_w)/2:"
            "y=h-(text_h*3.2):"
            "fontsize=42:"
            "fontcolor=white:"
            "borderw=4:"
            "bordercolor=black@0.85:"
            "box=1:"
            "boxcolor=black@0.28:"
            "boxborderw=14:"
            f"enable='between(t,{seg_start:.3f},{seg_end:.3f})'"
        )
    return ",".join(filters)


def render_clip(
    src_path: str,
    start: float,
    end: float,
    caption_segments: list[dict] | None = None,
) -> str:
    """Cut [start, end] out of src into a new file under UPLOAD_DIR.

    When caption_segments are provided, burn them into the rendered file. With no
    ffmpeg (or on any failure) returns src_path unchanged.
    """
    if not src_path or not os.path.exists(src_path) or not _has("ffmpeg"):
        return src_path
    if end <= start:
        return src_path
    out_path = os.path.join(UPLOAD_DIR, f"clip_{uuid.uuid4().hex[:8]}.mp4")
    base = ["ffmpeg", "-y", "-ss", f"{start:.3f}", "-to", f"{end:.3f}", "-i", src_path]
    vf = _caption_filter(start, end, caption_segments)
    if vf:
        try:
            result = subprocess.run(
                base
                + [
                    "-vf",
                    vf,
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-c:a",
                    "aac",
                    "-movflags",
                    "+faststart",
                    out_path,
                ],
                capture_output=True,
                timeout=600,
            )
            if result.returncode == 0 and os.path.exists(out_path) and os.path.getsize(out_path) > 0:
                return out_path
        except (OSError, subprocess.SubprocessError):
            return src_path
        return src_path

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


def analysis_proxy(src_path: str) -> str:
    """Create a small video copy for AI review; return source on failure."""
    if not src_path or not os.path.exists(src_path) or not _has("ffmpeg"):
        return src_path
    try:
        if os.path.getsize(src_path) <= 45 * 1024 * 1024:
            return src_path
    except OSError:
        return src_path

    out_path = os.path.join(UPLOAD_DIR, f"analysis_{uuid.uuid4().hex[:8]}.mp4")
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        src_path,
        "-vf",
        "scale=-2:640",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "31",
        "-c:a",
        "aac",
        "-b:a",
        "64k",
        "-ac",
        "1",
        "-movflags",
        "+faststart",
        out_path,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=900)
        if result.returncode == 0 and os.path.exists(out_path) and os.path.getsize(out_path) > 0:
            return out_path
    except (OSError, subprocess.SubprocessError):
        pass
    return src_path
