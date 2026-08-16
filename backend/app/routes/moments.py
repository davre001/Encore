from fastapi import APIRouter

from ..models.schemas import MomentDecision

router = APIRouter()


@router.get("/{video_id}")
async def list_moments(video_id: str):
    pass


@router.post("/{moment_id}/decide")
async def decide_moment(moment_id: str, body: MomentDecision):
    pass
