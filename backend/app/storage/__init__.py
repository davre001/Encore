"""Tiny JSON-file persistence for Encore.

Each collection is a flat JSON list under DATA_DIR (videos.json, moments.json,
…); uploaded takes live under UPLOAD_DIR. Records are stored in the same
camelCase shape the API returns, so they round-trip straight into the Pydantic
models. A single re-entrant lock guards every read-modify-write — enough for a
single-process demo, and swappable for a real DB later behind these same calls.
"""

import json
import os
import shutil
import threading
import time
import uuid
from typing import Any, Optional

from ..config import DATA_DIR, UPLOAD_DIR

_LOCK = threading.RLock()


def _path(name: str) -> str:
    return os.path.join(DATA_DIR, f"{name}.json")


def ensure_dirs() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(UPLOAD_DIR, exist_ok=True)


def _read(name: str) -> list[dict]:
    path = _path(name)
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _write(name: str, rows: list[dict]) -> None:
    ensure_dirs()
    path = _path(name)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(rows, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)  # atomic swap on the same filesystem


# --- ids / time ------------------------------------------------------------
def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def now_ms() -> int:
    return int(time.time() * 1000)


# --- generic record ops ----------------------------------------------------
def _insert(name: str, record: dict) -> dict:
    with _LOCK:
        rows = _read(name)
        rows.append(record)
        _write(name, rows)
    return record


def _get(name: str, record_id: str) -> Optional[dict]:
    with _LOCK:
        for row in _read(name):
            if row.get("id") == record_id:
                return row
    return None


def _list_by(name: str, field: str, value: Any) -> list[dict]:
    with _LOCK:
        return [row for row in _read(name) if row.get(field) == value]


def _update(name: str, record_id: str, patch: dict) -> Optional[dict]:
    with _LOCK:
        rows = _read(name)
        updated: Optional[dict] = None
        for i, row in enumerate(rows):
            if row.get("id") == record_id:
                merged = {**row, **patch}
                rows[i] = merged
                updated = merged
                break
        if updated is not None:
            _write(name, rows)
    return updated


# --- uploads ---------------------------------------------------------------
def save_upload(file: Any) -> str:
    """Persist a FastAPI UploadFile-like object; return the saved path.

    Accepts anything with a `.file` stream (UploadFile) or a raw binary stream.
    """
    ensure_dirs()
    filename = getattr(file, "filename", "") or ""
    ext = os.path.splitext(filename)[1] or ".mp4"
    dest = os.path.join(UPLOAD_DIR, f"{new_id('src')}{ext}")
    source = getattr(file, "file", file)
    try:
        source.seek(0)
    except (OSError, AttributeError):
        pass
    with open(dest, "wb") as out:
        shutil.copyfileobj(source, out)
    return dest


# --- videos ----------------------------------------------------------------
def save_video(video: dict) -> dict:
    return _insert("videos", video)


def get_video(video_id: str) -> Optional[dict]:
    return _get("videos", video_id)


def list_videos() -> list[dict]:
    with _LOCK:
        return _read("videos")


# --- moments ---------------------------------------------------------------
def save_moments(video_id: str, moments: list[dict]) -> list[dict]:
    """Replace the moment set for one video (idempotent re-proposal)."""
    with _LOCK:
        rows = [m for m in _read("moments") if m.get("videoId") != video_id]
        rows.extend(moments)
        _write("moments", rows)
    return moments


def get_moment(moment_id: str) -> Optional[dict]:
    return _get("moments", moment_id)


def list_moments(video_id: str) -> list[dict]:
    return _list_by("moments", "videoId", video_id)


def update_moment(moment_id: str, patch: dict) -> Optional[dict]:
    return _update("moments", moment_id, patch)


# --- clips -----------------------------------------------------------------
def save_clip(clip: dict) -> dict:
    return _insert("clips", clip)


def get_clip(clip_id: str) -> Optional[dict]:
    return _get("clips", clip_id)


def list_clips(video_id: str) -> list[dict]:
    return _list_by("clips", "videoId", video_id)


def update_clip(clip_id: str, patch: dict) -> Optional[dict]:
    return _update("clips", clip_id, patch)


# --- posts -----------------------------------------------------------------
def save_post(post: dict) -> dict:
    return _insert("posts", post)


def get_post(post_id: str) -> Optional[dict]:
    return _get("posts", post_id)


def list_posts(video_id: str) -> list[dict]:
    return _list_by("posts", "videoId", video_id)


def update_post(post_id: str, patch: dict) -> Optional[dict]:
    return _update("posts", post_id, patch)


# --- messages --------------------------------------------------------------
# Message records carry an extra `videoId` for filtering; the Message schema
# omits it, so it never leaks into the API response.
def save_message(message: dict) -> dict:
    return _insert("messages", message)


def list_messages(video_id: str) -> list[dict]:
    return _list_by("messages", "videoId", video_id)


# --- playbook (persistent taste memory) ------------------------------------
def read_playbook() -> list[dict]:
    with _LOCK:
        return _read("playbook")


def write_playbook(rows: list[dict]) -> None:
    with _LOCK:
        _write("playbook", rows)
