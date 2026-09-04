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

# Force the deterministic path even when .env holds a real Builder API key. The
# suite must stay hermetic: a live Mind would bill the creator's account and
# block for MINDS_REPLY_TIMEOUT per prompt. An empty value still counts as "set"
# to load_dotenv, so it is not overridden. The adapter itself is covered offline
# in _check_minds_adapter / _check_json_extraction.
os.environ["MINDS_BUILDER_API_KEY"] = ""

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

FAILS: list[str] = []


def check(label: str, cond: bool, detail: str = "") -> None:
    mark = "ok  " if cond else "FAIL"
    print(f"  [{mark}] {label}" + (f" — {detail}" if detail and not cond else ""))
    if not cond:
        FAILS.append(label)


def _check_json_extraction() -> None:
    """A Mind answers in sentences, so JSON must survive being wrapped in prose.

    The refusal case matters as much as the parse cases: when the Mind declines
    the format outright, extraction must return None so the caller drops to its
    deterministic path instead of raising.
    """
    from app.services.minds import _extract_json

    moment = {"start": 3.0, "end": 9.5, "label": "The confession", "reason": "opens cold"}
    body = (
        '[{"start": 3.0, "end": 9.5, "label": "The confession", '
        '"reason": "opens cold"}]'
    )

    cases = [
        ("bare array parses", body, list, [moment]),
        ("fenced json parses", f"```json\n{body}\n```", list, [moment]),
        ("prose before the array", f"Sure, one stands alone:\n\n{body}\n\nCut it?", list, [moment]),
        ("array mid-sentence", f"The best beat is {body} and I would trim the tail.", list, [moment]),
        ("apostrophes in the prose", f"Here's what I'd keep (it's strongest): {body}", list, [moment]),
        (
            "bracket inside a string value",
            '[{"start": 3.0, "end": 9.5, "label": "The [real] confession", "reason": "opens cold"}]',
            list,
            [{**moment, "label": "The [real] confession"}],
        ),
        (
            "a flat refusal yields no JSON",
            "I haven't watched it. The transcript is just [0.0-10.0] Music. I won't fake it.",
            list,
            None,
        ),
        (
            "a stray tag array does not shadow the object",
            'Tags: ["#rant"]. Copy:\n{"title": "I panicked", "caption": "the exam story"}',
            dict,
            {"title": "I panicked", "caption": "the exam story"},
        ),
        ("wrong shape is rejected", '{"title": "nope"}', list, None),
        ("truncated JSON is rejected", 'here you go: [{"start": 3.0, "end":', list, None),
    ]
    for label, raw, want, expect in cases:
        got = _extract_json(raw, want=want)
        check(label, got == expect, f"got {got!r}")


def _check_minds_adapter() -> None:
    """Minds Builder API adapter, exercised without a key or a network.

    The live round trip needs MINDS_BUILDER_API_KEY, so what is provable offline
    is the wire contract itself: JWT claim extraction, reply attribution, the
    409 retry, error-envelope parsing, and the poll deadline.
    """
    import base64
    import json

    from app.services import minds_api as ma

    check(
        "minds base URL defaults to the Animoca build host",
        ma.base_url() == "https://api.build.hellominds.ai",
        ma.base_url(),
    )
    check("no key means no humanId", ma.human_id() is None)

    # The Builder API key is a JWT; humanId comes out of its payload.
    payload = base64.urlsafe_b64encode(
        json.dumps({"humanId": "human_smoke_1"}).encode()
    ).decode().rstrip("=")
    original_key = ma.MINDS_BUILDER_API_KEY
    ma.MINDS_BUILDER_API_KEY = f"hdr.{payload}.sig"
    try:
        check(
            "humanId decoded from the key's JWT payload",
            ma.human_id() == "human_smoke_1",
            str(ma.human_id()),
        )
        check("a non-JWT key yields no humanId", _human_id_of(ma, "not-a-jwt") is None)
    finally:
        ma.MINDS_BUILDER_API_KEY = original_key

    # Reply attribution: senderType 1 (and "You") is us, 0 and 2 are the Mind.
    alias = "encore-notebook"
    mind_row = {"messageText": "Cut the greeting.", "senderType": 2, "fingerprint": "b"}
    check("Mind row is a reply", ma.is_mind_reply(mind_row, alias=alias))
    check(
        "system row (senderType 0) is a reply",
        ma.is_mind_reply({"messageText": "hi", "senderType": 0}, alias=alias),
    )
    check(
        "row with only a mindId is a reply",
        ma.is_mind_reply({"messageText": "hi", "mindId": "m_1"}, alias=alias),
    )
    check(
        "our own turn is not a reply",
        not ma.is_mind_reply({"messageText": "hi", "senderType": 1}, alias=alias),
    )
    check(
        "senderName 'You' is not a reply",
        not ma.is_mind_reply({"messageText": "hi", "senderName": "You"}, alias=alias),
    )
    check(
        "empty text is not a reply",
        not ma.is_mind_reply({"messageText": "  ", "senderType": 2}, alias=alias),
    )
    check(
        "echo of what we sent is not a reply",
        not ma.is_mind_reply(mind_row, alias=alias, sent_text="Cut the greeting."),
    )
    check(
        "another alias' row is not a reply",
        not ma.is_mind_reply(
            {"messageText": "hi", "senderType": 2, "alias": "other"}, alias=alias
        ),
    )
    check(
        "row at/behind the fingerprint mark is not a reply",
        not ma.is_mind_reply(mind_row, alias=alias, after_fingerprint="b"),
    )
    check(
        "row past the fingerprint mark is a reply",
        ma.is_mind_reply(mind_row, alias=alias, after_fingerprint="a"),
    )
    check(
        "partyType is read as senderType",
        ma.is_mind_reply({"messageText": "hi", "partyType": 2}, alias=alias),
    )

    _check_minds_transport(ma)

    probe = ma.probe()
    check("probe reports the key as missing", probe.get("keyConfigured") is False)
    check("probe stays unreachable without a key", probe.get("reachable") is False)
    check("probe explains why", bool(probe.get("error")), str(probe))


def _human_id_of(ma, key: str):
    """human_id() for an arbitrary key, restoring the module global after."""
    original = ma.MINDS_BUILDER_API_KEY
    ma.MINDS_BUILDER_API_KEY = key
    try:
        return ma.human_id()
    finally:
        ma.MINDS_BUILDER_API_KEY = original


def _check_minds_transport(ma) -> None:
    """Retry, error parsing, polling and the full ask() — transport stubbed out."""
    import httpx

    # Error envelope: {"error": {"type", "subType", "message"}}.
    resp = httpx.Response(
        401,
        json={
            "method": "POST",
            "url": "/v1/messaging/message",
            "error": {
                "extraInfo": [],
                "type": "AUTH_FAILED",
                "subType": "UNKNOWN_ERROR",
                "message": "Invalid or expired access key",
            },
        },
        request=httpx.Request("POST", "https://api.build.hellominds.ai/v1/x"),
    )
    err = ma._error_from("POST", "/v1/messaging/message", resp)
    check("error envelope keeps the status", err.status == 401, str(err.status))
    check("error envelope keeps the type", err.err_type == "AUTH_FAILED", str(err.err_type))
    check("error envelope keeps the subType", err.sub_type == "UNKNOWN_ERROR")
    check("error message surfaces the API's own words", "Invalid or expired" in str(err))

    original_request = ma._request
    original_history = ma.get_history
    calls: list[tuple] = []

    def busy_twice(method, path, *, json_body=None, params=None, timeout=None):
        calls.append((method, path))
        if len(calls) <= 2:
            raise ma.MindsError("busy", status=409)
        return {"ok": True}

    ma._request = busy_twice
    try:
        sent = ma.send_message("encore-notebook", "hello")
        check("send retries through a 409 and lands", sent == {"ok": True}, str(sent))
        check("send retried exactly twice", len(calls) == 3, str(len(calls)))

        calls.clear()

        def always_busy(method, path, *, json_body=None, params=None, timeout=None):
            calls.append((method, path))
            raise ma.MindsError("busy", status=409)

        ma._request = always_busy
        try:
            ma.send_message("encore-notebook", "hello")
            check("a permanently busy send raises", False, "no MindsError")
        except ma.MindsError:
            check("a permanently busy send raises", True)
        check("send gives up after the backoff", len(calls) == 4, str(len(calls)))
    finally:
        ma._request = original_request

    # Polling: nothing in history means no reply, and the deadline is honoured.
    ma.get_history = lambda alias, limit=50, before=None: []
    try:
        check(
            "an empty history times out to None",
            ma.wait_for_reply("encore-notebook", timeout_s=0) is None,
        )
        ma.get_history = lambda alias, limit=50, before=None: [
            {"messageText": "Open on the confession.", "senderType": 2, "fingerprint": "z"}
        ]
        check(
            "the Mind's row is picked out of history",
            ma.wait_for_reply("encore-notebook", timeout_s=0)
            == "Open on the confession.",
        )

        # Full round trip: resolve → ensure conversation → send → poll.
        seen: dict = {}
        original_resolve = ma.resolve_mind_id
        original_ensure = ma.ensure_conversation
        original_latest = ma.latest_fingerprint
        original_send = ma.send_message
        ma.resolve_mind_id = lambda refresh=False: "mind_smoke_1"
        ma.ensure_conversation = lambda alias, mind_id: seen.update(
            {"alias": alias, "mindId": mind_id}
        )
        ma.latest_fingerprint = lambda alias: "y"
        ma.send_message = lambda alias, text: seen.update({"sent": text}) or {}
        try:
            reply = ma.ask("what should I cut?", timeout_s=0)
            check("ask() returns the Mind's reply", reply == "Open on the confession.", str(reply))
            check("ask() sent the prompt", seen.get("sent") == "what should I cut?")
            check("ask() bound the conversation to the Mind", seen.get("mindId") == "mind_smoke_1")
        finally:
            ma.resolve_mind_id = original_resolve
            ma.ensure_conversation = original_ensure
            ma.latest_fingerprint = original_latest
            ma.send_message = original_send
            ma._conversation_cache.discard(seen.get("alias") or "")
    finally:
        ma.get_history = original_history


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
        from app.db import SessionLocal
        from app.models.user import User
        with SessionLocal() as db:
            db.query(User).filter(User.email.in_(["creator@example.com", "google.creator@gmail.com"])).delete(synchronize_session=False)
            db.commit()

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

        # 13. real analytics & playbook tests ----------------------------------
        analytics_resp = client.get("/api/analytics")
        check("GET /api/analytics 200", analytics_resp.status_code == 200)
        a_data = analytics_resp.json()
        check("analytics has summary", "summary" in a_data)
        check("analytics has posts", "posts" in a_data and isinstance(a_data["posts"], list))
        check("analytics has playbook", "playbook" in a_data and isinstance(a_data["playbook"], list))

        playbook_resp = client.get("/api/analytics/playbook")
        check("GET /api/analytics/playbook 200", playbook_resp.status_code == 200)
        pb_list = playbook_resp.json()
        check("playbook list is non-empty", len(pb_list) > 0)

        # 14. minds persistent memory & agent tests ----------------------------
        mind_status_resp = client.get("/api/mind/status")
        check("GET /api/mind/status 200", mind_status_resp.status_code == 200)
        m_status = mind_status_resp.json()
        check("persistent memory is enabled", m_status.get("persistentMemoryEnabled") is True)

        # Store persistent tenet
        mem_create = client.post(
            "/api/mind/memories",
            json={
                "category": "tenet",
                "key": "standing_rules",
                "content": "Keep pacing energetic and hook in first 2s.",
            },
        )
        check("POST /api/mind/memories 200", mem_create.status_code == 200)
        created_mem = mem_create.json()
        check("memory has camelCase createdAt", "createdAt" in created_mem)
        mem_id = created_mem.get("id")

        # Verify memory listing
        mems_list = client.get("/api/mind/memories?category=tenet").json()
        check("memory found in list", any(m.get("id") == mem_id for m in mems_list))

        # Chat with Mind
        mind_chat = client.post(
            "/api/mind/chat",
            json={"text": "What are my standing rules?", "context": "Take editor"},
        )
        check("POST /api/mind/chat 200", mind_chat.status_code == 200)
        chat_msg = mind_chat.json()
        check("mind chat reply has role mind", chat_msg.get("role") == "mind")

        # Delete test memory
        if mem_id:
            del_mem = client.delete(f"/api/mind/memories/{mem_id}")
            check("DELETE /api/mind/memories/{id} 200", del_mem.status_code == 200)

    # 15. Minds Builder API adapter (offline — no key, no network) -------------
    _check_minds_adapter()

    # 16. JSON extraction from a conversational Mind ---------------------------
    _check_json_extraction()

    print()
    if FAILS:
        print(f"SMOKE FAILED — {len(FAILS)} check(s): {FAILS}")
        return 1
    print("SMOKE PASSED — full pipeline walked on the deterministic fallback path.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
