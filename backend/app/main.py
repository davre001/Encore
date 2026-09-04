"""Encore API entrypoint.

Wires CORS for the Next.js dev server, ensures the data/upload dirs exist on
startup, exposes an honest capability probe at /api/health, and mounts the
route groups. Booting requires nothing beyond fastapi/uvicorn — every real
integration is capability-gated behind its service module.

FastAPI generates an OpenAPI (Swagger) schema for every route, served as
interactive Swagger UI at /docs (ReDoc at /redoc, raw schema at /openapi.json).
Run with `python -m app` (binds :5000) or the uvicorn CLI.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from .config import CORS_ORIGINS, capabilities
from . import storage
from .db import init_db
from .routes import (
    analytics,
    auth,
    clips,
    messages,
    mind,
    moments,
    posts,
    projects,
    videos,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    storage.ensure_dirs()
    init_db()
    yield


app = FastAPI(
    title="Encore API",
    description=(
        "Long take in, standalone Shorts out — upload, moment detection, clip "
        "render, publish, and performance check.\n\n"
        "This page is the interactive **Swagger UI**. The raw OpenAPI schema is "
        "at `/openapi.json`, and ReDoc at `/redoc`. `GET /api/health` reports "
        "which integrations are real vs. simulated right now."
    ),
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs",       # Swagger UI (default, set explicitly for clarity)
    redoc_url="/redoc",     # ReDoc
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/", include_in_schema=False)
async def root() -> RedirectResponse:
    """Land visitors straight on the Swagger UI."""
    return RedirectResponse(url="/docs")


@app.get("/api/health", tags=["meta"])
async def health() -> dict:
    """What's real vs. simulated right now — reflects installed tools/keys."""
    return {"status": "ok", "capabilities": capabilities()}


app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(videos.router, prefix="/api/videos", tags=["videos"])
app.include_router(moments.router, prefix="/api/moments", tags=["moments"])
app.include_router(clips.router, prefix="/api/clips", tags=["clips"])
app.include_router(posts.router, prefix="/api/posts", tags=["posts"])
app.include_router(messages.router, prefix="/api/messages", tags=["messages"])
app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
app.include_router(analytics.router, prefix="/api/analytics", tags=["analytics"])
app.include_router(mind.router, prefix="/api/mind", tags=["mind"])
