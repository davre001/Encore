"""Projects and history management for Encore.

Persists user edits (take segments, split/trim points, clips, effects like rotate/flip/aspect)
and powers the project history. Supports auto-save from the editor so the user never
loses their progress.
"""

import json
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..models.user import Project as DBProject
from ..models.schemas import (
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
    MessageResponse,
)
from .. import storage

router = APIRouter()


def _db_to_response(db_proj: DBProject) -> ProjectResponse:
    take_segments = []
    clips = []
    effects = {}
    try:
        if db_proj.take_segments:
            take_segments = json.loads(db_proj.take_segments)
    except Exception:
        take_segments = []

    try:
        if db_proj.clips_data:
            clips = json.loads(db_proj.clips_data)
    except Exception:
        clips = []

    try:
        if db_proj.effects:
            effects = json.loads(db_proj.effects)
    except Exception:
        effects = {}

    return ProjectResponse(
        id=db_proj.id,
        name=db_proj.name,
        video_id=db_proj.video_id,
        media_url=db_proj.media_url,
        status=db_proj.status or "draft",
        take_in=db_proj.take_in or 0.0,
        take_out=db_proj.take_out or 0.0,
        take_segments=take_segments,
        clips=clips,
        effects=effects,
        verdict=db_proj.verdict,
        views=db_proj.views,
        post_url=db_proj.post_url,
        post_id=db_proj.post_id,
        playhead=db_proj.playhead or 0.0,
        created_at=db_proj.created_at,
        updated_at=db_proj.updated_at,
    )


@router.post("", response_model=ProjectResponse)
def save_or_create_project(
    payload: ProjectCreate, db: Session = Depends(get_db)
) -> ProjectResponse:
    """Create or upsert a user project with its take segments, cuts, and effects."""
    now = storage.now_ms()
    proj_id = payload.id or storage.new_id("proj")

    # Serialize JSON fields
    take_segs_json = json.dumps(
        [s.model_dump(by_alias=True) for s in payload.take_segments]
    )
    clips_json = json.dumps([c.model_dump(by_alias=True) for c in payload.clips])
    effects_json = json.dumps(
        payload.effects.model_dump(by_alias=True) if payload.effects else {}
    )

    # 1. Try DB first
    try:
        existing = db.query(DBProject).filter(DBProject.id == proj_id).first()
        if existing:
            existing.name = payload.name
            existing.video_id = payload.video_id
            existing.media_url = payload.media_url
            existing.status = payload.status
            existing.verdict = payload.verdict
            existing.views = payload.views
            existing.post_url = payload.post_url
            existing.post_id = payload.post_id
            if payload.playhead is not None:
                existing.playhead = payload.playhead
            existing.take_in = payload.take_in
            existing.take_out = payload.take_out
            existing.take_segments = take_segs_json
            existing.clips_data = clips_json
            existing.effects = effects_json
            existing.updated_at = now
            db.commit()
            db.refresh(existing)
            res = _db_to_response(existing)
        else:
            db_proj = DBProject(
                id=proj_id,
                name=payload.name,
                video_id=payload.video_id,
                media_url=payload.media_url,
                status=payload.status,
                verdict=payload.verdict,
                views=payload.views,
                post_url=payload.post_url,
                post_id=payload.post_id,
                playhead=payload.playhead if payload.playhead is not None else 0.0,
                take_in=payload.take_in,
                take_out=payload.take_out,
                take_segments=take_segs_json,
                clips_data=clips_json,
                effects=effects_json,
                created_at=now,
                updated_at=now,
            )
            db.add(db_proj)
            db.commit()
            db.refresh(db_proj)
            res = _db_to_response(db_proj)
    except Exception:
        db.rollback()
        res = None

    # 2. Also keep in JSON storage so both storage modes stay synced
    storage_dict = {
        "id": proj_id,
        "name": payload.name,
        "videoId": payload.video_id,
        "mediaUrl": payload.media_url,
        "status": payload.status,
        "verdict": payload.verdict,
        "views": payload.views,
        "postUrl": payload.post_url,
        "postId": payload.post_id,
        "playhead": payload.playhead if payload.playhead is not None else 0.0,
        "takeIn": payload.take_in,
        "takeOut": payload.take_out,
        "takeSegments": [s.model_dump(by_alias=True) for s in payload.take_segments],
        "clips": [c.model_dump(by_alias=True) for c in payload.clips],
        "effects": payload.effects.model_dump(by_alias=True) if payload.effects else {},
        "createdAt": now,
        "updatedAt": now,
    }
    existing_store = storage.get_project(proj_id)
    if existing_store:
        storage.update_project(proj_id, storage_dict)
    else:
        storage.save_project(storage_dict)

    if res is not None:
        return res

    return ProjectResponse.model_validate(storage_dict)


@router.get("", response_model=list[ProjectResponse])
def list_projects(db: Session = Depends(get_db)) -> list[ProjectResponse]:
    """List all projects for history, ordered by most recently updated first."""
    # 1. Try DB
    try:
        db_projs = (
            db.query(DBProject).order_by(DBProject.updated_at.desc()).all()
        )
        if db_projs:
            return [_db_to_response(p) for p in db_projs]
    except Exception:
        pass

    # 2. Fallback to storage
    stored = storage.list_projects()
    return [ProjectResponse.model_validate(p) for p in stored]


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(project_id: str, db: Session = Depends(get_db)) -> ProjectResponse:
    """Get a single project by ID."""
    # 1. Try DB
    try:
        db_proj = db.query(DBProject).filter(DBProject.id == project_id).first()
        if db_proj:
            return _db_to_response(db_proj)
    except Exception:
        pass

    # 2. Fallback to storage
    stored = storage.get_project(project_id)
    if not stored:
        raise HTTPException(status_code=404, detail="Project not found")
    return ProjectResponse.model_validate(stored)


@router.patch("/{project_id}", response_model=ProjectResponse)
@router.put("/{project_id}", response_model=ProjectResponse)
def update_project(
    project_id: str, payload: ProjectUpdate, db: Session = Depends(get_db)
) -> ProjectResponse:
    """Update / auto-save an existing project."""
    now = storage.now_ms()
    patch: dict = {"updatedAt": now}

    if payload.name is not None:
        patch["name"] = payload.name
    if payload.video_id is not None:
        patch["videoId"] = payload.video_id
    if payload.media_url is not None:
        patch["mediaUrl"] = payload.media_url
    if payload.status is not None:
        patch["status"] = payload.status
    if payload.verdict is not None:
        patch["verdict"] = payload.verdict
    if payload.views is not None:
        patch["views"] = payload.views
    if payload.post_url is not None:
        patch["postUrl"] = payload.post_url
    if payload.post_id is not None:
        patch["postId"] = payload.post_id
    if payload.playhead is not None:
        patch["playhead"] = payload.playhead
    if payload.take_in is not None:
        patch["takeIn"] = payload.take_in
    if payload.take_out is not None:
        patch["takeOut"] = payload.take_out
    if payload.take_segments is not None:
        patch["takeSegments"] = [
            s.model_dump(by_alias=True) for s in payload.take_segments
        ]
    if payload.clips is not None:
        patch["clips"] = [c.model_dump(by_alias=True) for c in payload.clips]
    if payload.effects is not None:
        patch["effects"] = payload.effects.model_dump(by_alias=True)

    # 1. Try DB
    try:
        db_proj = db.query(DBProject).filter(DBProject.id == project_id).first()
        if db_proj:
            if payload.name is not None:
                db_proj.name = payload.name
            if payload.video_id is not None:
                db_proj.video_id = payload.video_id
            if payload.media_url is not None:
                db_proj.media_url = payload.media_url
            if payload.status is not None:
                db_proj.status = payload.status
            if payload.verdict is not None:
                db_proj.verdict = payload.verdict
            if payload.views is not None:
                db_proj.views = payload.views
            if payload.post_url is not None:
                db_proj.post_url = payload.post_url
            if payload.post_id is not None:
                db_proj.post_id = payload.post_id
            if payload.playhead is not None:
                db_proj.playhead = payload.playhead
            if payload.take_in is not None:
                db_proj.take_in = payload.take_in
            if payload.take_out is not None:
                db_proj.take_out = payload.take_out
            if payload.take_segments is not None:
                db_proj.take_segments = json.dumps(patch["takeSegments"])
            if payload.clips is not None:
                db_proj.clips_data = json.dumps(patch["clips"])
            if payload.effects is not None:
                db_proj.effects = json.dumps(patch["effects"])
            db_proj.updated_at = now
            db.commit()
            db.refresh(db_proj)
            storage.update_project(project_id, patch)
            return _db_to_response(db_proj)
    except Exception:
        db.rollback()

    # 2. Fallback to storage
    updated = storage.update_project(project_id, patch)
    if not updated:
        # If project did not exist in storage yet, create it
        full_dict = {
            "id": project_id,
            "name": payload.name or "Untitled",
            "videoId": payload.video_id,
            "mediaUrl": payload.media_url,
            "status": payload.status or "draft",
            "verdict": patch.get("verdict"),
            "views": patch.get("views"),
            "postUrl": patch.get("postUrl"),
            "postId": patch.get("postId"),
            "playhead": patch.get("playhead", 0.0),
            "takeIn": payload.take_in or 0.0,
            "takeOut": payload.take_out or 0.0,
            "takeSegments": patch.get("takeSegments", []),
            "clips": patch.get("clips", []),
            "effects": patch.get("effects", {}),
            "createdAt": now,
            "updatedAt": now,
        }
        storage.save_project(full_dict)
        return ProjectResponse.model_validate(full_dict)

    return ProjectResponse.model_validate(updated)


@router.delete("/{project_id}", response_model=MessageResponse)
def delete_project(
    project_id: str, db: Session = Depends(get_db)
) -> MessageResponse:
    """Delete a project from history."""
    deleted = False
    try:
        db_proj = db.query(DBProject).filter(DBProject.id == project_id).first()
        if db_proj:
            db.delete(db_proj)
            db.commit()
            deleted = True
    except Exception:
        db.rollback()

    store_deleted = storage.delete_project(project_id)
    if not deleted and not store_deleted:
        raise HTTPException(status_code=404, detail="Project not found")

    return MessageResponse(message="Project deleted successfully")
