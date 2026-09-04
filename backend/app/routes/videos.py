"""Video upload + fetch — tags every video with the uploading user's id."""

import mimetypes
import os
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse

from ..dependencies import get_user_id
from ..models.schemas import Video
from .. import storage
from ..services import analyze, ffmpeg, transcribe

router = APIRouter()


def _propose_moments(video_id: str, src_path: str, duration: float) -> None:
    """Background: transcribe → detect beats → persist. Never raises."""
    try:
        transcript = transcribe.transcribe(src_path)
        moments = analyze.find_moments(video_id, duration, transcript)
        storage.save_moments(video_id, moments)
    except Exception:
        storage.save_moments(video_id, [])


@router.post("", response_model=Video)
async def upload_video(
    file: UploadFile,
    background_tasks: BackgroundTasks,
    user_id: Optional[str] = Depends(get_user_id),
) -> Video:
    src_path = storage.save_upload(file)
    duration = ffmpeg.probe_duration(src_path)

    video = Video(
        id=storage.new_id("vid"),
        name=file.filename or "take.mp4",
        duration=duration,
        created_at=storage.now_ms(),
    )
    record = video.model_dump(by_alias=True)
    record["srcPath"] = src_path
    record["userId"] = user_id          # tag with owner
    storage.save_video(record)

    storage.save_message(
        {
            "id": storage.new_id("msg"),
            "role": "mind",
            "text": "Watching the tape and cutting the beats that stand alone…",
            "createdAt": storage.now_ms(),
            "videoId": video.id,
            "userId": user_id,
        }
    )

    background_tasks.add_task(_propose_moments, video.id, src_path, duration)
    return video


@router.get("/{video_id}", response_model=Video)
async def get_video(
    video_id: str,
    user_id: Optional[str] = Depends(get_user_id),
) -> Video:
    record = storage.get_video(video_id)
    if record is None:
        raise HTTPException(status_code=404, detail="video not found")
    # Enforce ownership only when both sides have a userId set
    if user_id and record.get("userId") and record["userId"] != user_id:
        raise HTTPException(status_code=404, detail="video not found")
    return Video.model_validate(record)


@router.get("/{video_id}/file")
async def get_video_file(
    video_id: str,
    user_id: Optional[str] = Depends(get_user_id),
) -> FileResponse:
    """Serve the original uploaded take so the editor can resume playback."""
    record = storage.get_video(video_id)
    if record is None:
        raise HTTPException(status_code=404, detail="video not found")
    if user_id and record.get("userId") and record["userId"] != user_id:
        raise HTTPException(status_code=404, detail="video not found")
    src_path = record.get("srcPath")
    if not src_path or not os.path.isfile(src_path):
        raise HTTPException(status_code=404, detail="video file not found")
    media_type = mimetypes.guess_type(src_path)[0] or "video/mp4"
    return FileResponse(
        src_path,
        media_type=media_type,
        content_disposition_type="inline",
    )
