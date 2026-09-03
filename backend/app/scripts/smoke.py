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
        media = client.get(f"/api/videos/{vid}/file")
        check("GET /api/videos/{id}/file 200", media.status_code == 200)
        check(
            "file is not JSON metadata",
            "srcPath" not in (media.headers.get("content-type") or ""),
            media.headers.get("content-type"),
        )

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

        # 6b. manual clip creation & patch -------------------------------------
        manual_resp = client.post(
            "/api/clips",
            json={
                "videoId": vid,
                "start": 5.0,
                "end": 20.0,
                "title": "Manual Cut",
                "caption": "Manual cut caption",
                "hashtags": ["#manual"],
                "tags": ["manual"],
            },
        )
        check("POST /api/clips 200", manual_resp.status_code == 200)
        manual_clip = manual_resp.json()
        check("manual clip title set", manual_clip.get("title") == "Manual Cut")
        check("manual clip has camelCase videoId", manual_clip.get("videoId") == vid)

        patch_resp = client.patch(
            f"/api/clips/{manual_clip['id']}",
            json={"title": "Updated Manual Cut"},
        )
        check("PATCH /api/clips/{id} 200", patch_resp.status_code == 200)
        check(
            "patched title reflected",
            patch_resp.json().get("title") == "Updated Manual Cut",
        )

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
        posted_clip = [c for c in client.get(f"/api/clips/{vid}").json() if c["id"] == clip_id][0]
        check("clip flagged posted", posted_clip.get("posted") is True)

        # 8b. patching posted clip fails with 409
        conflict_resp = client.patch(
            f"/api/clips/{clip_id}",
            json={"title": "Should Fail"},
        )
        check("PATCH posted clip returns 409", conflict_resp.status_code == 409)

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

        # 11. authentication & database tests ----------------------------------
        # Weak / generic password rejection
        weak_resp = client.post(
            "/api/auth/signup",
            json={"email": "creator@example.com", "password": "password123"},
        )
        check("weak generic password rejected (400)", weak_resp.status_code == 400)

        no_sym_resp = client.post(
            "/api/auth/signup",
            json={"email": "creator@example.com", "password": "Password123"},
        )
        check("password without symbols rejected (400)", no_sym_resp.status_code == 400)

        # Successful signup with strong password
        signup_resp = client.post(
            "/api/auth/signup",
            json={
                "email": "creator@example.com",
                "password": "StrongPassword!123",
                "name": "Test Creator",
            },
        )
        check("valid signup created (201)", signup_resp.status_code == 201)
        u = signup_resp.json()
        check("user has camelCase authProvider", u.get("authProvider") == "local")
        check("user email matches", u.get("email") == "creator@example.com")

        # Duplicate email prevention (rejects with 409 and descriptive message)
        dup_resp = client.post(
            "/api/auth/signup",
            json={"email": "creator@example.com", "password": "AnotherStrong!456"},
        )
        check("duplicate email rejected (409)", dup_resp.status_code == 409)
        check(
            "duplicate email gives correct error message",
            "already exists" in str(dup_resp.json().get("detail", "")).lower(),
            str(dup_resp.json()),
        )

        # Signin with wrong password fails
        bad_signin = client.post(
            "/api/auth/signin",
            json={"email": "creator@example.com", "password": "WrongPassword!999"},
        )
        check("signin with wrong password fails (401)", bad_signin.status_code == 401)

        # Signin with correct password succeeds
        good_signin = client.post(
            "/api/auth/signin",
            json={"email": "creator@example.com", "password": "StrongPassword!123"},
        )
        check("signin with correct password succeeds (200)", good_signin.status_code == 200)

        # Google auth
        google_resp = client.post(
            "/api/auth/google",
            json={
                "email": "google.creator@gmail.com",
                "name": "Google Creator",
                "picture": "https://example.com/avatar.jpg",
                "sub": "google_12345678",
            },
        )
        check("google auth creates user (200)", google_resp.status_code == 200)
        g_user = google_resp.json()
        check("google user has authProvider google", g_user.get("authProvider") == "google")

        # 12. forgot & reset password flow -------------------------------------
        # Mismatched email confirmation rejected
        mismatch_resp = client.post(
            "/api/auth/forgot-password",
            json={"email": "creator@example.com", "confirmEmail": "other@example.com"},
        )
        check("mismatched emails rejected (400)", mismatch_resp.status_code == 400)

        # Non-existent email rejected
        unknown_resp = client.post(
            "/api/auth/forgot-password",
            json={"email": "nobody@example.com", "confirmEmail": "nobody@example.com"},
        )
        check("unknown email rejected (404)", unknown_resp.status_code == 404)

        # Successful forgot password request
        forgot_resp = client.post(
            "/api/auth/forgot-password",
            json={"email": "creator@example.com", "confirmEmail": "creator@example.com"},
        )
        check("forgot password sends 6-digit code (200)", forgot_resp.status_code == 200)

        # Retrieve generated code from database for testing
        from app.db import SessionLocal
        from app.models.user import PasswordReset
        with SessionLocal() as db_session:
            reset_record = (
                db_session.query(PasswordReset)
                .filter(PasswordReset.email == "creator@example.com", PasswordReset.used == False)
                .order_by(PasswordReset.created_at.desc())
                .first()
            )
            reset_code = reset_record.code if reset_record else ""
        check("6-digit code generated", len(reset_code) == 6 and reset_code.isdigit())

        # Reset with invalid code fails
        bad_code_resp = client.post(
            "/api/auth/reset-password",
            json={"email": "creator@example.com", "code": "000000", "newPassword": "BrandNewStrong!123"},
        )
        check("invalid code rejected (400)", bad_code_resp.status_code == 400)

        # Reset with weak password fails
        weak_reset_resp = client.post(
            "/api/auth/reset-password",
            json={"email": "creator@example.com", "code": reset_code, "newPassword": "weak"},
        )
        check("weak new password rejected (400)", weak_reset_resp.status_code == 400)

        # Successful reset
        reset_ok = client.post(
            "/api/auth/reset-password",
            json={"email": "creator@example.com", "code": reset_code, "newPassword": "BrandNewStrong!123"},
        )
        check("reset password succeeds (200)", reset_ok.status_code == 200)

        # Signin with old password fails
        old_signin = client.post(
            "/api/auth/signin",
            json={"email": "creator@example.com", "password": "StrongPassword!123"},
        )
        check("old password invalid after reset (401)", old_signin.status_code == 401)

        # Signin with new password succeeds
        new_signin = client.post(
            "/api/auth/signin",
            json={"email": "creator@example.com", "password": "BrandNewStrong!123"},
        )
        check("new password login succeeds (200)", new_signin.status_code == 200)

    print()
    if FAILS:
        print(f"SMOKE FAILED — {len(FAILS)} check(s): {FAILS}")
        return 1
    print("SMOKE PASSED — full pipeline walked on the deterministic fallback path.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
