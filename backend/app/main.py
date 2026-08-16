from fastapi import FastAPI

from .routes import clips, messages, moments, posts, videos

app = FastAPI(title="Encore")

app.include_router(videos.router, prefix="/api/videos", tags=["videos"])
app.include_router(moments.router, prefix="/api/moments", tags=["moments"])
app.include_router(clips.router, prefix="/api/clips", tags=["clips"])
app.include_router(posts.router, prefix="/api/posts", tags=["posts"])
app.include_router(messages.router, prefix="/api/messages", tags=["messages"])
