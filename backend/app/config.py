import importlib.util
import os
import shutil

from dotenv import load_dotenv

load_dotenv()

# --- Paths -----------------------------------------------------------------
# Resolve UPLOAD_DIR / DATA_DIR against the backend root rather than the
# process CWD, so they land in the same place no matter where uvicorn is
# launched from (the old "../uploads" default was relative to the caller).
_HERE = os.path.dirname(os.path.abspath(__file__))  # .../backend/app
_BACKEND_ROOT = os.path.dirname(_HERE)  # .../backend


def _resolve(path: str) -> str:
    return path if os.path.isabs(path) else os.path.normpath(os.path.join(_BACKEND_ROOT, path))


UPLOAD_DIR = _resolve(os.getenv("UPLOAD_DIR", "../uploads"))
DATA_DIR = _resolve(os.getenv("DATA_DIR", "../data"))

# --- Credentials (empty string = not configured) ---------------------------
MINDS_BUILDER_API_KEY = os.getenv("MINDS_BUILDER_API_KEY", "")
MINDS_ID = os.getenv("MINDS_ID", "")
MINDS_BASE_URL = os.getenv("MINDS_BASE_URL", "")  # empty → Minds Cloud default
YOUTUBE_CLIENT_ID = os.getenv("YOUTUBE_CLIENT_ID", "")
YOUTUBE_CLIENT_SECRET = os.getenv("YOUTUBE_CLIENT_SECRET", "")
YOUTUBE_REFRESH_TOKEN = os.getenv("YOUTUBE_REFRESH_TOKEN", "")

# --- Tuning ----------------------------------------------------------------
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base")

# When a take's real length can't be probed (no ffprobe, or an undecodable
# stand-in), the timeline still needs a sane span. Mirrors the frontend's
# FALLBACK_DURATION in src/lib/mockEditor.ts so fallback == current app.
FALLBACK_DURATION = 184.0

# The creator's rolling median views, used to grade a post hit/mid/flop.
# Mirrors ANALYTICS_MEDIAN in src/lib/mockAnalytics.ts.
ANALYTICS_MEDIAN = 4100

# --- Server ----------------------------------------------------------------
# Bind address for `python -m app`. Default port 5000 (override via env or the
# uvicorn CLI's --port). uvicorn --port always wins when launched that way.
HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "5000"))

# --- CORS ------------------------------------------------------------------
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS", "http://localhost:3000,http://localhost:3001"
    ).split(",")
    if origin.strip()
]


def _has_module(name: str) -> bool:
    """True if an import would succeed, without actually importing it."""
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def capabilities() -> dict[str, bool]:
    """Which real integrations are wired vs. simulated, right now.

    Pure probe — checks for binaries, importable packages, and credentials, but
    never imports the heavy libs. Returned verbatim by GET /api/health so the
    running server is always honest about what is real.
    """
    ffmpeg = shutil.which("ffmpeg") is not None
    ffprobe = shutil.which("ffprobe") is not None
    return {
        "ffmpeg": ffmpeg,
        "ffprobe": ffprobe,
        # faster-whisper decodes audio through ffmpeg, so it needs both.
        "whisper": _has_module("faster_whisper") and ffmpeg,
        "minds": bool(MINDS_BUILDER_API_KEY) and _has_module("minds"),
        "youtube": bool(
            YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET and YOUTUBE_REFRESH_TOKEN
        )
        and _has_module("googleapiclient"),
    }
