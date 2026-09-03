"""Pydantic models mirroring frontend/src/types/index.ts.

The frontend speaks camelCase (videoId, createdAt, postUrl, …). Every model
here is snake_case internally but serialises to camelCase via an alias
generator, and accepts either spelling on input (populate_by_name), so these
round-trip cleanly with the TypeScript types and a future wired client.
"""

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

Decision = Literal["accept", "reject"]
MomentStatus = Literal["pending", "accepted", "rejected"]
Verdict = Literal["hit", "mid", "flop"]
Role = Literal["mind", "you"]


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


class Video(CamelModel):
    id: str
    name: str
    duration: float
    created_at: int  # ms since epoch, like JS Date.now()


class Moment(CamelModel):
    id: str
    video_id: str
    start: float
    end: float
    label: str
    reason: str
    status: MomentStatus = "pending"


class Clip(CamelModel):
    id: str
    moment_id: str
    video_id: str
    title: str
    caption: str
    hashtags: list[str]
    tags: list[str]
    start: float
    end: float
    posted: bool = False
    post_url: Optional[str] = None
    post_id: Optional[str] = None
    frozen: Optional[bool] = None


class PostCheck(CamelModel):
    post_id: str
    clip_id: str
    views: int
    median: int
    verdict: Verdict
    note: str
    recut_hook: Optional[str] = None


class Message(CamelModel):
    id: str
    role: Role
    text: str
    created_at: int


# --- Request bodies --------------------------------------------------------
class MomentDecision(CamelModel):
    decision: Decision


class MessageCreate(CamelModel):
    video_id: str
    text: str


# --- Small response envelopes ----------------------------------------------
class PublishResult(CamelModel):
    post_id: str
    post_url: str
