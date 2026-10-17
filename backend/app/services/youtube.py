"""YouTube publishing integration.

Uploads use the connected user's OAuth refresh token when present. A legacy
environment refresh token is still accepted for local development, but routes
should require a connected user before calling publish for real posting.
"""

from __future__ import annotations

import os
import time
from functools import partial
from typing import Optional

try:
    from google.auth.transport.requests import Request
    from google.auth.exceptions import TransportError
    from google_auth_httplib2 import AuthorizedHttp
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    from googleapiclient.http import MediaFileUpload
    from httplib2 import Http, ServerNotFoundError
except ImportError:  # optional dependency in local dev
    Request = None
    Credentials = None
    build = None
    HttpError = Exception
    MediaFileUpload = None
    TransportError = ServerNotFoundError = OSError
    AuthorizedHttp = Http = None

from .. import storage
from ..config import (
    ANALYTICS_MEDIAN,
    YOUTUBE_CLIENT_ID,
    YOUTUBE_CLIENT_SECRET,
    YOUTUBE_REFRESH_TOKEN,
)

SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
]


def _refresh_token_for_user(user_id: Optional[str]) -> str:
    connection = storage.get_youtube_connection(user_id)
    if connection and connection.get("refreshToken"):
        return str(connection["refreshToken"])
    return YOUTUBE_REFRESH_TOKEN.strip()


def connected(user_id: Optional[str] = None) -> bool:
    return bool(
        YOUTUBE_CLIENT_ID.strip()
        and YOUTUBE_CLIENT_SECRET.strip()
        and _refresh_token_for_user(user_id)
    )


def _service(refresh_token: str):
    if not (Request and Credentials and build):
        raise RuntimeError("YouTube upload dependencies are not installed.")
    credentials = Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=YOUTUBE_CLIENT_ID,
        client_secret=YOUTUBE_CLIENT_SECRET,
        scopes=SCOPES,
    )
    credentials.refresh(partial(Request(), timeout=30))
    return build("youtube", "v3", http=AuthorizedHttp(credentials, http=Http(timeout=30)))


def publish(clip: dict, src_path: Optional[str] = None, user_id: Optional[str] = None, on_progress=None) -> dict:
    refresh_token = _refresh_token_for_user(user_id)
    if not (YOUTUBE_CLIENT_ID.strip() and YOUTUBE_CLIENT_SECRET.strip() and refresh_token):
        raise RuntimeError("Connect a YouTube channel in Settings before posting.")
    if not src_path or not os.path.exists(src_path):
        raise FileNotFoundError("The source video file is missing, so this cut cannot be uploaded.")

    if not MediaFileUpload:
        raise RuntimeError("YouTube upload dependencies are not installed.")

    description = clip.get("caption") or ""
    hashtags = " ".join(clip.get("hashtags") or [])
    if hashtags:
        description = f"{description}\n\n{hashtags}".strip()

    body = {
        "snippet": {
            "title": clip.get("title") or "Encore cut",
            "description": description,
            "tags": clip.get("tags") or [],
            "categoryId": "24",
        },
        "status": {
            "privacyStatus": "public",
            "selfDeclaredMadeForKids": False,
        },
    }
    media = MediaFileUpload(src_path, chunksize=2 * 1024 * 1024, resumable=True)
    service = None
    disconnected_at = None
    while service is None:
        try:
            service = _service(refresh_token)
        except (OSError, TransportError, ServerNotFoundError):
            if disconnected_at is None:
                disconnected_at = time.monotonic()
            elapsed = time.monotonic() - disconnected_at
            if elapsed >= 1800:
                raise RuntimeError("YouTube connection timed out.")
            if on_progress:
                on_progress("reconnecting", "Connection error, check your network." if elapsed >= 120 else (
                    "This is taking longer than usual." if elapsed >= 60 else "Connecting to YouTube."
                ), 35)
            time.sleep(5)
    request = (
        service
        .videos()
        .insert(part="snippet,status", body=body, media_body=media)
    )
    response = None
    disconnected_at = None
    while response is None:
        try:
            status, response = request.next_chunk(num_retries=2)
            disconnected_at = None
            if status and on_progress:
                on_progress("uploading", "Uploading the cut to YouTube.", 35 + int(status.progress() * 60))
        except (OSError, TransportError, ServerNotFoundError, HttpError) as exc:
            http_status = getattr(getattr(exc, "resp", None), "status", None)
            if isinstance(exc, HttpError) and http_status not in {408, 500, 502, 503, 504}:
                raise
            if disconnected_at is None:
                disconnected_at = time.monotonic()
            elapsed = time.monotonic() - disconnected_at
            if elapsed >= 1800:
                raise RuntimeError("YouTube connection timed out. Check your channel before retrying.") from exc
            if on_progress:
                message = "Connection error, check your network." if elapsed >= 120 else (
                    "This is taking longer than usual." if elapsed >= 60 else "Reconnecting to YouTube."
                )
                on_progress("reconnecting", message, 35)
            # Reuse this resumable request, not a new videos.insert request.
            time.sleep(5)
    video_id = response["id"]
    return {
        "postId": video_id,
        "postUrl": f"https://youtube.com/shorts/{video_id}",
    }


def stats(clip: dict, post: dict, user_id: Optional[str] = None) -> dict:
    refresh_token = _refresh_token_for_user(user_id)
    video_id = post.get("postId") or post.get("id")
    views = int(post.get("views") or 0)

    if video_id and refresh_token and not str(video_id).startswith("yt_"):
        try:
            response = (
                _service(refresh_token)
                .videos()
                .list(part="statistics", id=video_id)
                .execute()
            )
            items = response.get("items") or []
            if items:
                views = int((items[0].get("statistics") or {}).get("viewCount") or 0)
        except (HttpError, RuntimeError, ValueError, KeyError):
            views = int(post.get("views") or 0)

    if not views and (not video_id or str(video_id).startswith("yt_")):
        views = max(800, int((clip.get("end", 0) - clip.get("start", 0)) * 320))

    if views >= ANALYTICS_MEDIAN * 1.35:
        verdict = "hit"
        note = "Outperformed your current median. Keep this hook style in rotation."
        recut_hook = None
    elif views < ANALYTICS_MEDIAN * 0.65:
        verdict = "flop"
        note = "Under median. Tighten the opening and re-cut around the clearest payoff."
        recut_hook = "Start on the strongest reaction before the context."
    else:
        verdict = "mid"
        note = "Close to median. Worth a caption or hook variation."
        recut_hook = None

    return {
        "postId": post.get("id") or video_id or f"post_{clip['id']}",
        "clipId": clip["id"],
        "views": views,
        "median": ANALYTICS_MEDIAN,
        "verdict": verdict,
        "note": note,
        "recutHook": recut_hook,
    }

