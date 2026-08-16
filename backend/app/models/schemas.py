from pydantic import BaseModel


class UploadResponse(BaseModel):
    video_id: str


class MomentDecision(BaseModel):
    decision: str


class MessageCreate(BaseModel):
    video_id: str
    text: str
