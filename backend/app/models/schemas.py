"""Pydantic models mirroring frontend/src/types/index.ts.

The frontend speaks camelCase (videoId, createdAt, postUrl, …). Every model
here is snake_case internally but serialises to camelCase via an alias
generator, and accepts either spelling on input (populate_by_name), so these
round-trip cleanly with the TypeScript types and a future wired client.
"""

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, field_validator
from pydantic.alias_generators import to_camel

Decision = Literal["accept", "reject"]
MomentStatus = Literal["pending", "accepted", "rejected"]
Verdict = Literal["hit", "mid", "flop"]
# A check result, not a stored grade: "pending" marks a post too young to judge.
# Stored verdicts stay hit/mid/flop — nothing writes "pending" to a post row.
CheckVerdict = Literal["hit", "mid", "flop", "pending"]
Role = Literal["mind", "you"]
CaptionLanguage = Literal["en", "fr", "es", "pt", "de", "it", "ar", "hi"]
# Whether a caption track's timings were heard (cut from a transcript) or
# distributed by the builder.
CaptionSource = Literal["speech", "estimated"]
AnalysisStage = Literal[
    "queued",
    "uploaded",
    "thinking",
    "transcribing",
    "watching",
    "generating",
    "complete",
    "empty",
    "error",
]
AnalysisErrorType = Literal["network", "timeout", "quota", "api", "unknown"]


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
    # Source dimensions when ffprobe could read them. The editor uses the ratio
    # to open a take in its own aspect instead of assuming 16:9.
    width: Optional[int] = None
    height: Optional[int] = None


class Moment(CamelModel):
    id: str
    video_id: str
    start: float
    end: float
    label: str
    reason: str
    status: MomentStatus = "pending"
    # How strongly this beat stands alone, 0-100, as judged by the detector.
    # Drives best-first ordering and "pick the best cut" selection; older rows
    # written before this field existed default to 0 and keep their time order.
    score: float = 0.0

    @field_validator("score", mode="before")
    @classmethod
    def _coerce_score(cls, value: object) -> float:
        """Tolerate a missing, null or out-of-range score on stored rows rather
        than rejecting the whole list — one bad row must not empty the tab."""
        try:
            return max(0.0, min(100.0, float(value)))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return 0.0


class AnalysisStatus(CamelModel):
    video_id: str
    stage: AnalysisStage
    message: str
    updated_at: int
    error_type: Optional[AnalysisErrorType] = None
    done: bool = False


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
    verdict: CheckVerdict
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
    # The project whose thread this message belongs to. One thread per project:
    # a chat started in one project can never surface in another, and a project
    # that has just been created starts with nothing to read.
    thread_id: str
    text: str


class MessageEventCreate(CamelModel):
    thread_id: str
    text: str
    role: Role = "mind"


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


class CaptionWord(CamelModel):
    """One spoken word on the timeline — what makes a caption track beat with
    the voice instead of guessing where inside a line the speaker has got to."""

    start: float
    end: float
    text: str


class CaptionSegment(CamelModel):
    id: str
    start: float
    end: float
    text: str
    # Empty for a cue whose text was typed by hand or estimated without an
    # audio read; the preview falls back to the plain line when it is.
    words: list[CaptionWord] = []


class CaptionTrack(CamelModel):
    id: str
    clip_id: str
    language: CaptionLanguage
    font_family: str = "Inter"
    font_source: Optional[str] = "system"
    font_url: Optional[str] = None
    segments: list[CaptionSegment]
    # "speech" when every cue is cut from a real transcript; "estimated" when
    # the timings are distributed rather than heard. The panel says which, so a
    # creator is never told a guess is word-accurate.
    source: CaptionSource = "estimated"


CaptionStage = Literal[
    "queued",
    "transcribing",
    "beats",
    "fitting",
    "complete",
    "error",
]


class CaptionJob(CamelModel):
    """Progress for a caption run, polled by the editor.

    Generating captions reads the whole take through whisper, which is far too
    long to hold a request open for with nothing on screen. The POST starts the
    job and this is what the loader follows — `progress` is the share of the
    audio actually decoded, not a timer.
    """

    clip_id: str
    stage: CaptionStage
    message: str
    progress: int = 0
    done: bool = False
    error: Optional[str] = None
    track: Optional[CaptionTrack] = None


class CaptionGenerateRequest(CamelModel):
    clip_id: str
    video_id: Optional[str] = None
    title: str
    caption: str
    start: float
    end: float
    language: CaptionLanguage = "en"
    # The frame the captions will be drawn into ("9:16", "16:9", …). Cues are
    # budgeted to it so a portrait clip never gets a landscape-length line.
    aspect: str = "16:9"


# --- Small response envelopes ----------------------------------------------
class PublishResult(CamelModel):
    post_id: str
    post_url: str


class YouTubeStatus(CamelModel):
    connected: bool
    oauth_ready: bool
    channel_id: Optional[str] = None
    channel_title: Optional[str] = None
    channel_url: Optional[str] = None
    updated_at: Optional[int] = None


class YouTubeConnectResponse(CamelModel):
    auth_url: str


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


class AuthResponse(CamelModel):
    user: UserResponse
    access_token: str
    token_type: str = "bearer"


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


class AiSettings(CamelModel):
    user_id: Optional[str] = None
    ai_permission_mode: Literal["auto", "ask"] = "ask"
    updated_at: int


class AiSettingsUpdate(CamelModel):
    ai_permission_mode: Literal["auto", "ask"]


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
    ai_permission_mode: Literal["auto", "ask"] = "ask"
    compare_on: bool = False
    caption_tracks: list[dict] = []


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
