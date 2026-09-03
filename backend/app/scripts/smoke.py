"""End-to-end smoke test for the Encore API — no server, no external deps.

Drives the whole pipeline in-process with Starlette's TestClient against an
isolated temp data dir, asserting the camelCase contract (matching
frontend/src/types/index.ts) at every hop. Proves the deterministic fallback
path: with no ffmpeg / keys installed it still walks upload → moments → accept
→ clip → publish → check → chat.

Run from the backend/ directory:
    python -m app.scripts.smoke
"""

import os
import sys
import tempfile

# Point storage at a throwaway dir BEFORE importing the app. load_dotenv() does
# not override already-set env vars, so this wins even if a real .env appears.
_TMP = tempfile.mkdtemp(prefix="encore_smoke_")
os.environ["DATA_DIR"] = os.path.join(_TMP, "data")
os.environ["UPLOAD_DIR"] = os.path.join(_TMP, "uploads")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

FAILS: list[str] = []


def check(label: str, cond: bool, detail: str = "") -> None:
    mark = "ok  " if cond else "FAIL"
    print(f"  [{mark}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILS.append(label)


def main() -> int:
    with TestClient(app) as client:
        # 1. root redirects to Swagger UI; health reports capabilities --------
        r = client.get("/", follow_redirects=False)
        check(
            "GET / redirects to Swagger UI (/docs)",
            r.status_code in (301, 302, 307, 308) and r.headers.get("location") == "/docs",
            f"{r.status_code} -> {r.headers.get('location')}",
        )
        docs = client.get("/docs")
        check(
            "GET /docs serves Swagger UI",
            docs.status_code == 200 and "swagger-ui" in docs.text.lower(),
            str(docs.status_code),
        )

        health = client.get("/api/health").json()
        caps = health.get("capabilities", {})
        check("GET /api/health has capabilities", isinstance(caps, dict) and bool(caps))
        check(
            "capabilities are all booleans",
            all(isinstance(v, bool) for v in caps.values()),
            str(caps),
        )
        print(f"        capabilities: {caps}")

        # 2. upload ------------------------------------------------------------
        resp = client.post(
            "/api/videos",
            files={"file": ("study-vlog-final.mp4", b"not-a-real-video", "video/mp4")},
        )
        check("POST /api/videos 200", resp.status_code == 200, str(resp.status_code))
        video = resp.json()
        check("video has camelCase createdAt", "createdAt" in video, str(video.keys()))
        check("video id present", bool(video.get("id")))
        check(
            "duration falls back to 184",
            video.get("duration") == 184.0,
            str(video.get("duration")),
        )
        vid = video["id"]

        # 3. get video ---------------------------------------------------------
        got = client.get(f"/api/videos/{vid}")
        check("GET /api/videos/{id} 200", got.status_code == 200)
        check("no srcPath leak", "srcPath" not in got.json(), str(got.json().keys()))

        # 4. moments (background task has run by now) --------------------------
        moments = client.get(f"/api/moments/{vid}").json()
        check("3 moments proposed", len(moments) == 3, str(len(moments)))
        if moments:
            m0 = moments[0]
            check("moment has camelCase videoId", "videoId" in m0, str(m0.keys()))
            check("moment status pending", m0.get("status") == "pending")
            check(
                "first beat is Confession hook",
                m0.get("label") == "Confession hook",
                str(m0.get("label")),
            )

        # 5. seeded message ----------------------------------------------------
        msgs = client.get(f"/api/messages/{vid}").json()
        check("upload seeded a mind message", len(msgs) >= 1, str(len(msgs)))
        if msgs:
            check("message has camelCase createdAt", "createdAt" in msgs[0])

        # 6. accept the first moment → creates a clip --------------------------
        mom_id = moments[0]["id"]
        decided = client.post(f"/api/moments/{mom_id}/decide", json={"decision": "accept"})
        check("POST decide 200", decided.status_code == 200)
        check("moment now accepted", decided.json().get("status") == "accepted")

        clips = client.get(f"/api/clips/{vid}").json()
        check("one clip created on accept", len(clips) == 1, str(len(clips)))
        clip = clips[0] if clips else {}
        check(
            "clip title from confession hook",
            clip.get("title") == "I failed the exam on purpose.",
            str(clip.get("title")),
        )
        check("clip has camelCase momentId", "momentId" in clip, str(clip.keys()))
        check("clip hashtags is a list", isinstance(clip.get("hashtags"), list))

        # idempotency: deciding again must not duplicate the clip
        client.post(f"/api/moments/{mom_id}/decide", json={"decision": "accept"})
        check(
            "accept is idempotent (still 1 clip)",
            len(client.get(f"/api/clips/{vid}").json()) == 1,
        )

        clip_id = clip["id"]

        # 7. render ------------------------------------------------------------
        rendered = client.post(f"/api/clips/{clip_id}/render")
        check("POST render 200", rendered.status_code == 200)

        # 8. publish -----------------------------------------------------------
        published = client.post(f"/api/posts/{clip_id}")
        check("POST publish 200", published.status_code == 200)
        pub = published.json()
        check("publish returns camelCase postUrl", "postUrl" in pub, str(pub.keys()))
        check(
            "postUrl matches shipToYouTube format",
            str(pub.get("postUrl", "")).startswith("https://youtube.com/shorts/encore-"),
            str(pub.get("postUrl")),
        )
        post_id = pub["postId"]

        # clip is now flagged posted
        posted_clip = client.get(f"/api/clips/{vid}").json()[0]
        check("clip flagged posted", posted_clip.get("posted") is True)

        # 9. check post → hit (the "failed" hook is the breakout) --------------
        checked = client.get(f"/api/posts/{post_id}/check")
        check("GET check 200", checked.status_code == 200)
        pc = checked.json()
        check("check has camelCase clipId", "clipId" in pc, str(pc.keys()))
        check("views 12400 for failed hook", pc.get("views") == 12400, str(pc.get("views")))
        check("median 4100", pc.get("median") == 4100)
        check("verdict hit", pc.get("verdict") == "hit", str(pc.get("verdict")))

        # 10. chat fallbacks ---------------------------------------------------
        r_check = client.post("/api/messages", json={"videoId": vid, "text": "check the flop?"}).json()
        check("chat reply is a mind message", r_check.get("role") == "mind")
        check(
            "flop/check reply reports latest verdict",
            str(r_check.get("text", "")).startswith("Latest:"),
            str(r_check.get("text")),
        )

        r_left = client.post("/api/messages", json={"videoId": vid, "text": "any leftover?"}).json()
        check(
            "leftover reply mentions the rant",
            "exam-panic rant" in str(r_left.get("text", "")),
            str(r_left.get("text")),
        )

        r_def = client.post("/api/messages", json={"videoId": vid, "text": "hello there"}).json()
        check(
            "default reply is the notebook line",
            "on the notebook" in str(r_def.get("text", "")),
            str(r_def.get("text")),
        )

    print()
    if FAILS:
        print(f"SMOKE FAILED — {len(FAILS)} check(s): {FAILS}")
        return 1
    print("SMOKE PASSED — full pipeline walked on the deterministic fallback path.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
