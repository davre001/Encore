"""YouTube channel OAuth connection routes."""

import secrets
from typing import Optional
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse

from .. import storage
from ..config import (
    FRONTEND_ORIGIN,
    YOUTUBE_CLIENT_ID,
    YOUTUBE_CLIENT_SECRET,
    YOUTUBE_REDIRECT_URI,
)
from ..dependencies import get_user_id
from ..models.schemas import YouTubeConnectResponse, YouTubeStatus

router = APIRouter()

SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
]


def _oauth_ready() -> bool:
    return bool(YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET and YOUTUBE_REDIRECT_URI)


def _status(user_id: Optional[str]) -> YouTubeStatus:
    connection = storage.get_youtube_connection(user_id)
    connected = bool(connection and connection.get("refreshToken"))
    channel_id = connection.get("channelId") if connection else None
    channel_title = connection.get("channelTitle") if connection else None
    return YouTubeStatus(
        connected=connected,
        oauth_ready=_oauth_ready(),
        channel_id=channel_id,
        channel_title=channel_title,
        channel_url=(
            f"https://www.youtube.com/channel/{channel_id}" if channel_id else None
        ),
        updated_at=connection.get("updatedAt") if connection else None,
    )


@router.get("/status", response_model=YouTubeStatus)
async def youtube_status(
    user_id: str = Depends(get_user_id),
) -> YouTubeStatus:
    return _status(user_id)


@router.post("/connect", response_model=YouTubeConnectResponse)
async def connect_youtube(
    user_id: str = Depends(get_user_id),
) -> YouTubeConnectResponse:
    if not _oauth_ready():
        raise HTTPException(
            status_code=400,
            detail="YouTube OAuth is not configured. Set YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REDIRECT_URI.",
        )
    state = secrets.token_urlsafe(32)
    storage.save_youtube_state(state, user_id, storage.now_ms() + 10 * 60 * 1000)
    params = {
        "client_id": YOUTUBE_CLIENT_ID,
        "redirect_uri": YOUTUBE_REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "include_granted_scopes": "true",
        "prompt": "consent",
        "state": state,
    }
    return YouTubeConnectResponse(
        auth_url=f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"
    )


@router.get("/callback", include_in_schema=False)
async def youtube_callback(
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
) -> RedirectResponse:
    if error:
        return RedirectResponse(f"{FRONTEND_ORIGIN}/settings?youtube=error")
    if not code or not state:
        return RedirectResponse(f"{FRONTEND_ORIGIN}/settings?youtube=missing")

    state_record = storage.pop_youtube_state(state)
    if not state_record:
        return RedirectResponse(f"{FRONTEND_ORIGIN}/settings?youtube=expired")
    user_id = str(state_record["userId"])

    async with httpx.AsyncClient(timeout=30.0) as client:
        token_res = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": YOUTUBE_CLIENT_ID,
                "client_secret": YOUTUBE_CLIENT_SECRET,
                "redirect_uri": YOUTUBE_REDIRECT_URI,
                "grant_type": "authorization_code",
            },
        )
        if token_res.status_code >= 400:
            return RedirectResponse(f"{FRONTEND_ORIGIN}/settings?youtube=token")
        tokens = token_res.json()
        refresh_token = tokens.get("refresh_token")
        if not refresh_token:
            return RedirectResponse(f"{FRONTEND_ORIGIN}/settings?youtube=no_refresh")

        access_token = tokens.get("access_token")
        channel_id = None
        channel_title = None
        if access_token:
            channel_res = await client.get(
                "https://www.googleapis.com/youtube/v3/channels",
                params={"part": "snippet", "mine": "true"},
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if channel_res.status_code < 400:
                items = channel_res.json().get("items", [])
                if items:
                    channel = items[0]
                    channel_id = channel.get("id")
                    channel_title = channel.get("snippet", {}).get("title")

    storage.save_youtube_connection(
        user_id,
        {
            "refreshToken": refresh_token,
            "channelId": channel_id,
            "channelTitle": channel_title or "Connected channel",
            "scope": tokens.get("scope", " ".join(SCOPES)),
        },
    )
    return RedirectResponse(f"{FRONTEND_ORIGIN}/settings?youtube=connected")


@router.delete("/disconnect", response_model=YouTubeStatus)
async def disconnect_youtube(
    user_id: str = Depends(get_user_id),
) -> YouTubeStatus:
    storage.delete_youtube_connection(user_id)
    return _status(user_id)
