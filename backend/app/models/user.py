"""SQLAlchemy User model for PostgreSQL database."""

import time
import uuid
from sqlalchemy import Column, String, BigInteger, Boolean, Float, Text
from ..db import Base
from ..services.security import hash_password, verify_password


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=True)
    name = Column(String, nullable=False, default="Creator")
    picture = Column(String, nullable=True)
    auth_provider = Column(String, nullable=False, default="local")
    created_at = Column(BigInteger, nullable=False, default=lambda: int(time.time() * 1000))

    def check_password(self, password: str) -> bool:
        """Check plain password against stored hash."""
        if not self.password_hash:
            return False
        return verify_password(password, self.password_hash)

    def set_password(self, password: str) -> None:
        """Hash and set a new password."""
        self.password_hash = hash_password(password)

    @classmethod
    def new_id(cls) -> str:
        return f"user_{uuid.uuid4().hex[:8]}"


class PasswordReset(Base):
    __tablename__ = "password_resets"

    id = Column(String, primary_key=True, index=True)
    email = Column(String, index=True, nullable=False)
    code = Column(String(6), nullable=False)
    expires_at = Column(BigInteger, nullable=False)
    used = Column(Boolean, default=False, nullable=False)
    created_at = Column(BigInteger, nullable=False, default=lambda: int(time.time() * 1000))

    @classmethod
    def new_id(cls) -> str:
        return f"reset_{uuid.uuid4().hex[:8]}"


class Project(Base):
    __tablename__ = "projects"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, nullable=True, index=True)
    name = Column(String, nullable=False, default="Untitled")
    video_id = Column(String, nullable=True)
    media_url = Column(String, nullable=True)
    status = Column(String, nullable=False, default="draft")
    # Post outcome — persisted when a cut from this project is published/checked,
    # so History can tell a draft apart from a posted hit / mid / flop.
    verdict = Column(String, nullable=True)
    views = Column(BigInteger, nullable=True)
    post_url = Column(String, nullable=True)
    post_id = Column(String, nullable=True)
    playhead = Column(Float, default=0.0)
    take_in = Column(Float, default=0.0)
    take_out = Column(Float, default=0.0)
    take_segments = Column(Text, default="[]")
    clips_data = Column(Text, default="[]")
    effects = Column(Text, default="{}")
    created_at = Column(BigInteger, nullable=False, default=lambda: int(time.time() * 1000))
    updated_at = Column(BigInteger, nullable=False, default=lambda: int(time.time() * 1000))

    @classmethod
    def new_id(cls) -> str:
        return f"proj_{uuid.uuid4().hex[:8]}"


class MindMemory(Base):
    __tablename__ = "mind_memories"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, nullable=True, index=True)
    category = Column(String, nullable=False, default="general")  # "tenet", "playbook", "preference", "context", "history"
    key = Column(String, nullable=True, index=True)  # e.g. "standing_rules", "hook_preference", "editing_style"
    content = Column(Text, nullable=False)
    metadata_json = Column(Text, default="{}")
    created_at = Column(BigInteger, nullable=False, default=lambda: int(time.time() * 1000))
    updated_at = Column(BigInteger, nullable=False, default=lambda: int(time.time() * 1000))

    @classmethod
    def new_id(cls) -> str:
        return f"mem_{uuid.uuid4().hex[:8]}"


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, nullable=True, index=True)
    video_id = Column(String, nullable=True, index=True)
    role = Column(String, nullable=False)  # "you", "mind"
    text = Column(Text, nullable=False)
    created_at = Column(BigInteger, nullable=False, default=lambda: int(time.time() * 1000))

    @classmethod
    def new_id(cls) -> str:
        return f"msg_{uuid.uuid4().hex[:8]}"


class PostAnalytics(Base):
    __tablename__ = "post_analytics"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, nullable=True, index=True)
    project_id = Column(String, nullable=True, index=True)
    video_id = Column(String, nullable=True)
    clip_id = Column(String, nullable=True)
    post_id = Column(String, nullable=True)
    title = Column(String, nullable=False)
    hook = Column(String, nullable=True)
    views = Column(BigInteger, nullable=False, default=0)
    verdict = Column(String, nullable=False, default="mid")  # "hit", "mid", "flop"
    day = Column(String, nullable=False, default="Today")
    post_url = Column(String, nullable=True)
    note = Column(Text, nullable=True)
    created_at = Column(BigInteger, nullable=False, default=lambda: int(time.time() * 1000))

    @classmethod
    def new_id(cls) -> str:
        return f"post_{uuid.uuid4().hex[:8]}"


class PlaybookRule(Base):
    __tablename__ = "playbook_rules"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, nullable=True, index=True)
    style = Column(String, nullable=False, index=True)  # e.g. "Confession hook", "Rant"
    sample = Column(BigInteger, default=1)
    hit_rate = Column(Float, default=0.5)
    note = Column(Text, nullable=True)
    locked = Column(Boolean, default=False)
    created_at = Column(BigInteger, nullable=False, default=lambda: int(time.time() * 1000))
    updated_at = Column(BigInteger, nullable=False, default=lambda: int(time.time() * 1000))

    @classmethod
    def new_id(cls) -> str:
        return f"rule_{uuid.uuid4().hex[:8]}"

