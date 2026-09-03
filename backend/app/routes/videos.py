"""Video upload + fetch.

Upload persists the file, probes its real duration (ffprobe when present, else
the 184s fallback), stores the Video, and kicks moment detection off in the
background so the response returns immediately — GET /api/moments/{videoId}
returns [] until the transcript + analysis land.
"""

from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile

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
async def upload_video(file: UploadFile, background_tasks: BackgroundTasks) -> Video:
    src_path = storage.save_upload(file)
    duration = ffmpeg.probe_duration(src_path)

    video = Video(
        id=storage.new_id("vid"),
        name=file.filename or "take.mp4",
        duration=duration,
        created_at=storage.now_ms(),
    )
    record = video.model_dump(by_alias=True)
    record["srcPath"] = src_path  # internal; dropped by the Video model on read
    storage.save_video(record)

    # Seed the notebook with the same line the frontend shows post-upload.
    storage.save_message(
        {
            "id": storage.new_id("msg"),
            "role": "mind",
            "text": "Watching the tape and cutting the beats that stand alone…",
            "createdAt": storage.now_ms(),
            "videoId": video.id,
        }
    )

    background_tasks.add_task(_propose_moments, video.id, src_path, duration)
    return video


@router.get("/{video_id}", response_model=Video)
async def get_video(video_id: str) -> Video:
    record = storage.get_video(video_id)
    if record is None:
        raise HTTPException(status_code=404, detail="video not found")
    return Video.model_validate(record)
