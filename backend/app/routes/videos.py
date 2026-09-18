"""Video upload + fetch routes."""

import mimetypes
import os
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse

from .. import storage
from ..dependencies import get_user_id
from ..models.schemas import AnalysisStatus, Video
from ..services import analyze, ffmpeg, gemini, transcribe

router = APIRouter()


def _status(video_id: str, stage: str, message: str, **extra) -> None:
    storage.save_analysis_status(
        video_id,
        {
            "stage": stage,
            "message": message,
            "done": stage in {"complete", "empty", "error"},
            **extra,
        },
    )


def _propose_moments(video_id: str, src_path: str, duration: float) -> None:
    """Background analysis pipeline. Never raises."""
    try:
        _status(video_id, "thinking", "Preparing the video for analysis.")
        _status(video_id, "transcribing", "Reading the audio and speech timing.")
        transcript = transcribe.transcribe(src_path)
        _status(video_id, "watching", "Watching the video for standout moments.")
        moments = analyze.find_moments(video_id, duration, transcript, src_path)
        _status(video_id, "generating", "Turning the strongest beats into proposed cuts.")
        storage.save_moments(video_id, moments)
        if moments:
            suffix = "s" if len(moments) != 1 else ""
            _status(video_id, "complete", f"Found {len(moments)} standout moment{suffix}.")
            return

        ai_error = gemini.last_error()
        if ai_error:
            _status(
                video_id,
                "error",
                ai_error["message"],
                errorType=ai_error["errorType"],
            )
        else:
            _status(
                video_id,
                "empty",
                "Finished analysis, but no strong standalone moments were found.",
            )
    except Exception:
        storage.save_moments(video_id, [])
        _status(
            video_id,
            "error",
            "Unexpected error while analyzing the video.",
            errorType="unknown",
        )


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
    record["userId"] = user_id
    storage.save_video(record)
    _status(video.id, "uploaded", "Upload complete. Preparing analysis.")

    storage.save_message(
        {
            "id": storage.new_id("msg"),
            "role": "mind",
            "text": "I am preparing the video, reading the audio, and looking for beats that stand alone.",
            "createdAt": storage.now_ms(),
            "videoId": video.id,
            "userId": user_id,
        }
    )

    background_tasks.add_task(_propose_moments, video.id, src_path, duration)
    return video


@router.get("/{video_id}/analysis", response_model=AnalysisStatus)
async def get_analysis_status(
    video_id: str,
    user_id: Optional[str] = Depends(get_user_id),
) -> AnalysisStatus:
    record = storage.get_video(video_id)
    if record is None:
        raise HTTPException(status_code=404, detail="video not found")
    if user_id and record.get("userId") and record["userId"] != user_id:
        raise HTTPException(status_code=404, detail="video not found")
    status = storage.get_analysis_status(video_id) or {
        "videoId": video_id,
        "stage": "queued",
        "message": "Waiting to start analysis.",
        "updatedAt": storage.now_ms(),
        "done": False,
    }
    return AnalysisStatus.model_validate(status)


@router.get("/{video_id}", response_model=Video)
async def get_video(
    video_id: str,
    user_id: Optional[str] = Depends(get_user_id),
) -> Video:
    record = storage.get_video(video_id)
    if record is None:
        raise HTTPException(status_code=404, detail="video not found")
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
