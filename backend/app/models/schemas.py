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
    # True on the placeholder returned while a real Mind composes its answer:
    # the Builder API is asynchronous, so the reply lands in history later and
    # the client polls GET /api/messages/{videoId} for it.
    pending: bool = False


# --- Request bodies --------------------------------------------------------
class MomentDecision(CamelModel):
    decision: Decision


class MessageCreate(CamelModel):
    video_id: str
    text: str


class ClipCreate(CamelModel):
    """Create a cut from an arbitrary range of the take (manual editing tools).

    Copy fields are optional: when the client already has a title/caption/tags
    (every clip the editor mints does), they are used as-is; anything missing is
    filled by the deterministic/Minds caption builder.
    """

    video_id: str
    start: float
    end: float
    title: Optional[str] = None
    caption: Optional[str] = None
    hashtags: Optional[list[str]] = None
    tags: Optional[list[str]] = None
    moment_id: Optional[str] = None
    label: Optional[str] = None


class ClipUpdate(CamelModel):
    """Patch an unposted clip's copy and/or trim; only sent fields change."""

    title: Optional[str] = None
    caption: Optional[str] = None
    hashtags: Optional[list[str]] = None
    tags: Optional[list[str]] = None
    start: Optional[float] = None
    end: Optional[float] = None


# --- Small response envelopes ----------------------------------------------
class PublishResult(CamelModel):
    post_id: str
    post_url: str


# --- Auth schemas ----------------------------------------------------------
class UserSignUp(CamelModel):
    email: str
    password: str
    name: Optional[str] = None


class UserSignIn(CamelModel):
    email: str
    password: str


class GoogleAuthRequest(CamelModel):
    email: str
    name: Optional[str] = None
    picture: Optional[str] = None
    sub: Optional[str] = None


class UserResponse(CamelModel):
    id: str
    email: str
    name: str
    picture: Optional[str] = None
    auth_provider: str = "local"
    created_at: int


class ForgotPasswordRequest(CamelModel):
    email: str
    confirm_email: str


class ResetPasswordRequest(CamelModel):
    email: str
    code: str
    new_password: str


class MessageResponse(CamelModel):
    message: str
    status: str = "ok"


# --- Project schemas -------------------------------------------------------
class TakeSegmentSchema(CamelModel):
    id: str
    title: str
    start: float
    end: float
    source_start: Optional[float] = None
    source_end: Optional[float] = None


class ProjectEffects(CamelModel):
    rotate: int = 0
    flip: bool = False
    aspect: str = "16:9"
    ai_on: bool = False
    compare_on: bool = False


class ProjectCreate(CamelModel):
    id: Optional[str] = None
    name: str = "Untitled"
    video_id: Optional[str] = None
    media_url: Optional[str] = None
    status: str = "draft"
    take_in: float = 0.0
    take_out: float = 0.0
    take_segments: list[TakeSegmentSchema] = []
    clips: list[Clip] = []
    effects: Optional[ProjectEffects] = None
    verdict: Optional[Verdict] = None
    views: Optional[int] = None
    post_url: Optional[str] = None
    post_id: Optional[str] = None
    playhead: Optional[float] = None


class ProjectUpdate(CamelModel):
    name: Optional[str] = None
    video_id: Optional[str] = None
    media_url: Optional[str] = None
    status: Optional[str] = None
    take_in: Optional[float] = None
    take_out: Optional[float] = None
    take_segments: Optional[list[TakeSegmentSchema]] = None
    clips: Optional[list[Clip]] = None
    effects: Optional[ProjectEffects] = None
    verdict: Optional[Verdict] = None
    views: Optional[int] = None
    post_url: Optional[str] = None
    post_id: Optional[str] = None
    playhead: Optional[float] = None


class ProjectResponse(CamelModel):
    id: str
    name: str
    video_id: Optional[str] = None
    media_url: Optional[str] = None
    status: str = "draft"
    take_in: float = 0.0
    take_out: float = 0.0
    take_segments: list[TakeSegmentSchema] = []
    clips: list[Clip] = []
    effects: ProjectEffects = ProjectEffects()
    verdict: Optional[Verdict] = None
    views: Optional[int] = None
    post_url: Optional[str] = None
    post_id: Optional[str] = None
    playhead: float = 0.0
    created_at: int
    updated_at: int


# --- Mind & Memory schemas --------------------------------------------------
class MindMemoryCreate(CamelModel):
    category: str = "general"
    key: Optional[str] = None
    content: str
    metadata_json: Optional[str] = "{}"


class MindMemoryResponse(CamelModel):
    id: str
    category: str
    key: Optional[str] = None
    content: str
    metadata_json: Optional[str] = "{}"
    created_at: int
    updated_at: int


class ChatPromptRequest(CamelModel):
    text: str
    video_id: Optional[str] = None
    context: Optional[str] = None


# --- Analytics & Playbook schemas -------------------------------------------
class AnalyticsPostItem(CamelModel):
    id: str
    day: str
    title: str
    hook: str
    views: int
    verdict: Verdict
    url: Optional[str] = None


class AnalyticsSummary(CamelModel):
    posts: int = 0
    total_views: int = 0
    median: int = 0
    hit_rate: float = 0.0
    hits: int = 0
    flops: int = 0
    mids: int = 0


class PlaybookRow(CamelModel):
    id: Optional[str] = None
    style: str
    sample: int
    hit_rate: float
    note: str
    locked: bool = False


class AnalyticsDataResponse(CamelModel):
    posts: list[AnalyticsPostItem] = []
    summary: AnalyticsSummary = AnalyticsSummary()
    playbook: list[PlaybookRow] = []



