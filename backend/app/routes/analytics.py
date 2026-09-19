"""Analytics & Playbook — real metrics and taste memory, scoped per user."""

import statistics
import time
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException

from .. import storage
from ..dependencies import get_user_id
from ..models.schemas import (
    AnalyticsDataResponse,
    AnalyticsPostItem,
    AnalyticsSummary,
    PlaybookRow,
)
from ..models.user import PostAnalytics, PlaybookRule, Project
from ..db import SessionLocal
from ..services import analytics as analytics_service, youtube

router = APIRouter()


@router.get("", response_model=AnalyticsDataResponse)
async def get_analytics(
    user_id: Optional[str] = Depends(get_user_id),
) -> AnalyticsDataResponse:
    """Retrieve analytics calculated from this user's posts and projects."""
    with SessionLocal() as db:
        pa_q = db.query(PostAnalytics)
        if user_id:
            pa_q = pa_q.filter(PostAnalytics.user_id == user_id)
        post_rows = pa_q.order_by(PostAnalytics.created_at.desc()).limit(100).all()

        for row in post_rows:
            if not row.post_id or not row.clip_id:
                continue
            clip = storage.get_clip(row.clip_id)
            post = storage.get_post(row.post_id) or {
                "id": row.post_id,
                "postId": row.post_id,
                "views": row.views,
                "postUrl": row.post_url,
                "userId": row.user_id,
            }
            if not clip:
                continue
            try:
                stats = youtube.stats(clip, post, user_id=user_id)
                check = analytics_service.build_post_check(
                    clip,
                    row.post_id,
                    int(stats.get("views", row.views) if isinstance(stats, dict) else stats),
                )
            except Exception:
                continue
            row.views = int(check["views"])
            row.verdict = check["verdict"]
            row.note = check["note"]
            storage.update_post(
                row.post_id,
                {
                    "views": row.views,
                    "verdict": row.verdict,
                    "postUrl": row.post_url,
                    "checkedAt": storage.now_ms(),
                },
            )
            project = None
            if row.project_id:
                project = db.query(Project).filter(Project.id == row.project_id).first()
            if not project:
                project_q = db.query(Project).filter(Project.post_id == row.post_id)
                if user_id:
                    project_q = project_q.filter(Project.user_id == user_id)
                project = project_q.first()
            if project:
                project.status = "checked"
                project.views = row.views
                project.verdict = row.verdict
                if row.post_url:
                    project.post_url = row.post_url
                project.post_id = row.post_id
                project.updated_at = storage.now_ms()
        db.commit()

        proj_q = db.query(Project).filter(
            Project.status.in_(["posted", "checked"]), Project.views.isnot(None)
        )
        if user_id:
            proj_q = proj_q.filter(Project.user_id == user_id)
        project_posts = proj_q.order_by(Project.updated_at.desc()).limit(50).all()

        seen_ids: set[str] = set()
        posts: list[AnalyticsPostItem] = []

        for p in post_rows:
            seen_ids.add(p.id)
            posts.append(
                AnalyticsPostItem(
                    id=p.id,
                    day=p.day,
                    title=p.title,
                    hook=p.hook or "Direct hook",
                    views=int(p.views),
                    verdict=p.verdict if p.verdict in ["hit", "mid", "flop"] else "mid",
                    url=p.post_url,
                )
            )

        for proj in project_posts:
            if proj.id not in seen_ids:
                seen_ids.add(proj.id)
                posts.append(
                    AnalyticsPostItem(
                        id=proj.id,
                        day="Recent",
                        title=proj.name,
                        hook="Cut from take",
                        views=int(proj.views or 0),
                        verdict=proj.verdict if proj.verdict in ["hit", "mid", "flop"] else "mid",
                        url=proj.post_url,
                    )
                )

        total_count = len(posts)
        total_views = sum(p.views for p in posts)
        view_counts = [p.views for p in posts]
        median_views = int(statistics.median(view_counts)) if view_counts else 0
        hits = sum(1 for p in posts if p.verdict == "hit")
        flops = sum(1 for p in posts if p.verdict == "flop")
        mids = sum(1 for p in posts if p.verdict == "mid")
        hit_rate = round(hits / total_count, 2) if total_count > 0 else 0.0

        summary = AnalyticsSummary(
            posts=total_count,
            total_views=total_views,
            median=median_views,
            hit_rate=hit_rate,
            hits=hits,
            flops=flops,
            mids=mids,
        )

        pb_q = db.query(PlaybookRule)
        if user_id:
            pb_q = pb_q.filter(PlaybookRule.user_id == user_id)
        db_rules = pb_q.order_by(PlaybookRule.hit_rate.desc()).all()

        playbook_list: list[PlaybookRow] = []
        if db_rules:
            for r in db_rules:
                playbook_list.append(
                    PlaybookRow(
                        id=r.id,
                        style=r.style,
                        sample=int(r.sample),
                        hit_rate=float(r.hit_rate),
                        note=r.note or "",
                        locked=bool(r.locked),
                    )
                )

        return AnalyticsDataResponse(
            posts=posts,
            summary=summary,
            playbook=playbook_list,
        )


@router.get("/playbook", response_model=list[PlaybookRow])
async def list_playbook(
    user_id: Optional[str] = Depends(get_user_id),
) -> list[PlaybookRow]:
    """List this user's playbook rules."""
    with SessionLocal() as db:
        q = db.query(PlaybookRule)
        if user_id:
            q = q.filter(PlaybookRule.user_id == user_id)
        rules = q.order_by(PlaybookRule.hit_rate.desc()).all()
        if rules:
            return [
                PlaybookRow(
                    id=r.id,
                    style=r.style,
                    sample=int(r.sample),
                    hit_rate=float(r.hit_rate),
                    note=r.note or "",
                    locked=bool(r.locked),
                )
                for r in rules
            ]

    return []


@router.post("/playbook", response_model=PlaybookRow)
async def update_playbook_rule(
    body: PlaybookRow,
    user_id: Optional[str] = Depends(get_user_id),
) -> PlaybookRow:
    """Create or update a playbook rule for this user."""
    now_ms = int(time.time() * 1000)
    with SessionLocal() as db:
        q = db.query(PlaybookRule).filter(PlaybookRule.style == body.style)
        if user_id:
            q = q.filter(PlaybookRule.user_id == user_id)
        existing = q.first()

        if existing:
            existing.note = body.note
            existing.locked = body.locked
            existing.updated_at = now_ms
            db.commit()
            db.refresh(existing)
            return PlaybookRow(
                id=existing.id,
                style=existing.style,
                sample=int(existing.sample),
                hit_rate=float(existing.hit_rate),
                note=existing.note,
                locked=existing.locked,
            )

        rule = PlaybookRule(
            id=PlaybookRule.new_id(),
            user_id=user_id,
            style=body.style,
            sample=body.sample,
            hit_rate=body.hit_rate,
            note=body.note,
            locked=body.locked,
            created_at=now_ms,
            updated_at=now_ms,
        )
        db.add(rule)
        db.commit()
        db.refresh(rule)
        return PlaybookRow(
            id=rule.id,
            style=rule.style,
            sample=int(rule.sample),
            hit_rate=float(rule.hit_rate),
            note=rule.note,
            locked=rule.locked,
        )
