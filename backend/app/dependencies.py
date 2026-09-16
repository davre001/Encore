"""Shared FastAPI dependencies for Encore."""

from typing import Optional

from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .services.security import verify_access_token

bearer_scheme = HTTPBearer(auto_error=False)


def get_user_id(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    access_token: Optional[str] = Query(default=None),
) -> str:
    """Verify the bearer token and return the authenticated Encore user id."""
    token = access_token
    if credentials and credentials.scheme.lower() == "bearer":
        token = credentials.credentials

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    claims = verify_access_token(token)
    if claims is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return str(claims["sub"])
