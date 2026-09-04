"""Shared FastAPI dependencies for Encore.

`get_user_id` reads the `X-User-Id` header that the frontend attaches to
every authenticated request. Routes that need per-user isolation use this
as a dependency so every DB/storage query is automatically scoped.

Returning None (unauthenticated) is allowed — endpoints decide whether to
require a real user or fall back to unscoped data.
"""

from typing import Optional
from fastapi import Header


def get_user_id(x_user_id: Optional[str] = Header(default=None)) -> Optional[str]:
    """Extract the caller's user-id from the X-User-Id request header."""
    if x_user_id and x_user_id.strip():
        return x_user_id.strip()
    return None
