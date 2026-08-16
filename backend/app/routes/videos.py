from fastapi import APIRouter, UploadFile

router = APIRouter()


@router.post("")
async def upload_video(file: UploadFile):
    pass


@router.get("/{video_id}")
async def get_video(video_id: str):
    pass
