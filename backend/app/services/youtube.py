"""YouTube publish + stats.

With OAuth creds present, uploads the rendered cut and reads back real view
counts via the YouTube Data API. With no creds it returns a simulated post
whose id/URL match the frontend's shipToYouTube() format, and hands view
counting to analytics.simulated_views — so the whole ship→check loop runs
end to end with nothing configured.
"""

import os
from typing import Optional

from ..config import (
    YOUTUBE_CLIENT_ID,
    YOUTUBE_CLIENT_SECRET,
    YOUTUBE_REFRESH_TOKEN,
    capabilities,
)
from .. import storage
from . import analytics


def available() -> bool:
    return capabilities()["youtube"]


def _service():
    """Build an authorized YouTube client from the refresh token, or None."""
    try:
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build

        creds = Credentials(
            None,
            refresh_token=YOUTUBE_REFRESH_TOKEN,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=YOUTUBE_CLIENT_ID,
            client_secret=YOUTUBE_CLIENT_SECRET,
        )
        return build("youtube", "v3", credentials=creds, cache_discovery=False)
    except Exception:
        return None


def _simulated(clip: dict) -> dict:
    """Post id/URL in the frontend's exact shipToYouTube() shape."""
    clip_id = clip["id"]
    return {
        "postId": f"post_{clip_id}",
        "postUrl": f"https://youtube.com/shorts/encore-{clip_id[-5:]}",
    }


def publish(clip: dict, src_path: Optional[str] = None) -> dict:
    """Publish a clip; return {postId, postUrl}. Falls back to simulated."""
    if available() and src_path and os.path.exists(src_path):
        service = _service()
        if service is not None:
            try:
                from googleapiclient.http import MediaFileUpload

                body = {
                    "snippet": {
                        "title": clip.get("title", "Encore clip")[:100],
                        "description": clip.get("caption", ""),
                        "tags": clip.get("tags", []),
                    },
                    "status": {"privacyStatus": "unlisted", "selfDeclaredMadeForKids": False},
                }
                media = MediaFileUpload(src_path, chunksize=-1, resumable=False)
                response = (
                    service.videos()
                    .insert(part="snippet,status", body=body, media_body=media)
                    .execute()
                )
                video_id = response["id"]
                return {
                    "postId": video_id,
                    "postUrl": f"https://youtube.com/shorts/{video_id}",
                }
            except Exception:
                pass  # fall through to simulated
    return _simulated(clip)


def stats(clip: dict, post: dict) -> int:
    """Live view count for a post; simulated when YouTube isn't wired."""
    post_id = post.get("id", "")
    # A real upload's id is a bare YouTube id; simulated ids are "post_…".
    if available() and post_id and not post_id.startswith("post_"):
        service = _service()
        if service is not None:
            try:
                response = service.videos().list(part="statistics", id=post_id).execute()
                items = response.get("items", [])
                if items:
                    return int(items[0]["statistics"].get("viewCount", 0))
            except Exception:
                pass
    return analytics.simulated_views(clip)
