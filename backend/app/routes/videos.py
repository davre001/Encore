"""Video upload + fetch routes."""

import errno
import glob
import mimetypes
import os
import shutil
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from .. import storage
from ..dependencies import get_user_id
from ..models.schemas import AnalysisStatus, Video
from ..services import analyze, ffmpeg, gemini, transcribe

router = APIRouter()

_ACTIVE_ANALYSES: set[str] = set()
STALE_ANALYSIS_MS = 90_000


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


def _safe_upload_name(filename: str | None) -> str:
    base = os.path.basename(filename or "take.mp4")
    _, ext = os.path.splitext(base)
    return ext or ".mp4"


def _save_video_record(
    *,
    background_tasks: BackgroundTasks,
    src_path: str,
    filename: str | None,
    user_id: Optional[str],
) -> Video:
    duration = ffmpeg.probe_duration(src_path)
    video = Video(
        id=storage.new_id("vid"),
        name=filename or "take.mp4",
        duration=duration,
        created_at=storage.now_ms(),
    )
    record = video.model_dump(by_alias=True)
    record["srcPath"] = src_path
    record["userId"] = user_id
    storage.save_video(record)
    _status(video.id, "uploaded", "Upload complete. Preparing analysis.")
    # Analysis progress belongs on the status the editor polls, not in the chat.
    # A mind line here was written with nobody having asked, and it is the same
    # class of leak as a "Kept …" confirmation after a click.

    background_tasks.add_task(_propose_moments, video.id, src_path, duration)
    return video

def _propose_moments(video_id: str, src_path: str, duration: float) -> None:
    """Background analysis pipeline. Never raises."""
    if video_id in _ACTIVE_ANALYSES:
        return
    _ACTIVE_ANALYSES.add(video_id)
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
    finally:
        _ACTIVE_ANALYSES.discard(video_id)


@router.post("", response_model=Video)
async def upload_video(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user_id: Optional[str] = Depends(get_user_id),
) -> Video:
    src_path = storage.save_upload(file)
    return _save_video_record(
        background_tasks=background_tasks,
        src_path=src_path,
        filename=file.filename,
        user_id=user_id,
    )


@router.post("/chunked/start")
async def start_chunked_upload(
    filename: Optional[str] = None,
    user_id: Optional[str] = Depends(get_user_id),
) -> dict:
    storage.ensure_dirs()
    ext = _safe_upload_name(filename)
    upload_id = storage.new_id("upload")
    part_path = os.path.join(storage.UPLOAD_DIR, f"{upload_id}{ext}.part")
    with open(part_path, "wb"):
        pass
    return {"uploadId": upload_id}


@router.post("/chunked/{upload_id}/chunk")
async def append_upload_chunk(
    upload_id: str,
    request: Request,
    user_id: Optional[str] = Depends(get_user_id),
) -> dict:
    storage.ensure_dirs()
    matches = glob.glob(os.path.join(storage.UPLOAD_DIR, f"{upload_id}.*.part"))
    if not matches:
        raise HTTPException(status_code=404, detail="Upload session not found.")
    part_path = matches[0]
    chunk = await request.body()
    if not chunk:
        raise HTTPException(status_code=400, detail="Upload chunk was empty.")
    free = shutil.disk_usage(os.path.dirname(part_path)).free
    if free < len(chunk) + 64 * 1024 * 1024:
        raise HTTPException(
            status_code=507,
            detail="The disk is full, so this video could not be saved. Free some space and try again.",
        )
    try:
        with open(part_path, "ab") as out:
            out.write(chunk)
    except OSError as exc:
        if exc.errno == errno.ENOSPC:
            raise HTTPException(
                status_code=507,
                detail="The disk is full, so this video could not be saved. Free some space and try again.",
            ) from exc
        raise
    return {"ok": True, "size": os.path.getsize(part_path)}


@router.post("/chunked/{upload_id}/finish", response_model=Video)
async def finish_chunked_upload(
    upload_id: str,
    background_tasks: BackgroundTasks,
    filename: Optional[str] = None,
    user_id: Optional[str] = Depends(get_user_id),
) -> Video:
    matches = glob.glob(os.path.join(storage.UPLOAD_DIR, f"{upload_id}.*.part"))
    if not matches:
        raise HTTPException(status_code=404, detail="Upload session not found.")
    part_path = matches[0]
    if os.path.getsize(part_path) <= 0:
        os.remove(part_path)
        raise HTTPException(status_code=400, detail="Upload body was empty.")
    final_path = part_path[:-5]
    os.replace(part_path, final_path)
    return _save_video_record(
        background_tasks=background_tasks,
        src_path=final_path,
        filename=filename,
        user_id=user_id,
    )

@router.post("/raw", response_model=Video)
async def upload_video_raw(
    request: Request,
    background_tasks: BackgroundTasks,
    filename: Optional[str] = None,
    user_id: Optional[str] = Depends(get_user_id),
) -> Video:
    storage.ensure_dirs()
    ext = _safe_upload_name(filename or request.headers.get("x-file-name"))
    src_path = os.path.join(storage.UPLOAD_DIR, f"{storage.new_id('src')}{ext}")
    wrote = 0
    try:
        with open(src_path, "wb") as out:
            async for chunk in request.stream():
                if not chunk:
                    continue
                wrote += len(chunk)
                out.write(chunk)
    except Exception as exc:
        if os.path.exists(src_path):
            os.remove(src_path)
        raise HTTPException(status_code=400, detail="Could not receive upload body.") from exc

    if wrote <= 0:
        if os.path.exists(src_path):
            os.remove(src_path)
        raise HTTPException(status_code=400, detail="Upload body was empty.")

    return _save_video_record(
        background_tasks=background_tasks,
        src_path=src_path,
        filename=filename or request.headers.get("x-file-name"),
        user_id=user_id,
    )


@router.post("/{video_id}/analysis/retry", response_model=AnalysisStatus)
async def retry_analysis(
    video_id: str,
    background_tasks: BackgroundTasks,
    user_id: Optional[str] = Depends(get_user_id),
) -> AnalysisStatus:
    record = storage.get_video(video_id)
    if record is None:
        raise HTTPException(status_code=404, detail="video not found")
    if user_id and record.get("userId") and record["userId"] != user_id:
        raise HTTPException(status_code=404, detail="video not found")
    src_path = record.get("srcPath")
    if not src_path or not os.path.isfile(src_path):
        raise HTTPException(status_code=404, detail="video file not found")

    if video_id not in _ACTIVE_ANALYSES:
        storage.save_moments(video_id, [])
        _status(video_id, "queued", "Regenerating moments from the video.")
        background_tasks.add_task(
            _propose_moments,
            video_id,
            src_path,
            float(record.get("duration") or 0),
        )
    status = storage.get_analysis_status(video_id)
    return AnalysisStatus.model_validate(status)


@router.get("/{video_id}/analysis", response_model=AnalysisStatus)
async def get_analysis_status(
    video_id: str,
    background_tasks: BackgroundTasks,
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

    moments = storage.list_moments(video_id)
    if moments and not status.get("done") and video_id not in _ACTIVE_ANALYSES:
        suffix = "s" if len(moments) != 1 else ""
        _status(video_id, "complete", f"Found {len(moments)} standout moment{suffix}.")
        status = storage.get_analysis_status(video_id) or status

    is_running_status = not status.get("done") and status.get("stage") in {
        "queued",
        "uploaded",
        "thinking",
        "transcribing",
        "watching",
        "generating",
    }
    age_ms = storage.now_ms() - int(status.get("updatedAt") or 0)
    src_path = record.get("srcPath")
    if (
        is_running_status
        and video_id not in _ACTIVE_ANALYSES
        and age_ms > STALE_ANALYSIS_MS
        and src_path
        and os.path.isfile(src_path)
    ):
        _status(video_id, "queued", "Resuming analysis after refresh.")
        background_tasks.add_task(
            _propose_moments,
            video_id,
            src_path,
            float(record.get("duration") or 0),
        )
        status = storage.get_analysis_status(video_id) or status

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
