"""Minds by Animoca Brands — Builder API transport.

Animoca publishes only a Node/TS client (`@animocabrands/minds-client-lib`), so
this is a hand-rolled Python port of the parts Encore needs. The contract below
was read off that package's compiled source (v0.1.4) and confirmed with live
probes:

    base      https://api.build.hellominds.ai
    auth      X-Api-Key: <Builder API key>      (X-Access-Key is deprecated)
    minds     GET  /v1/humans/{humanId}/minds   -> [{mindId, name, isEnabled}]
    conv      POST /v1/messaging/conversation   {alias, mindId}
              GET  /v1/messaging/conversations/{alias}
    send      POST /v1/messaging/message        {alias, messageText}
    history   GET  /v1/messaging/histories/{alias}?limit=&before=  (newest first)

There is no completion endpoint — a Mind answers asynchronously. The round trip
is: snapshot the newest fingerprint, send, then poll history for a newer row
authored by the Mind. `ask()` wraps that. The JS client prefers an SSE stream
(`/v1/messaging/events`) and falls back to the same poll; polling alone is what
this adapter does, since it runs inside a request-scoped background task.
"""

from __future__ import annotations

import base64
import json
import logging
import time
from typing import Any, Optional
from urllib.parse import quote

import httpx

from ..config import (
    MINDS_ALIAS,
    MINDS_BASE_URL,
    MINDS_BUILDER_API_KEY,
    MINDS_ID,
    MINDS_REPLY_TIMEOUT,
)

log = logging.getLogger("encore.minds")

DEFAULT_BASE_URL = "https://api.build.hellominds.ai"

# Sender types seen on history rows / SSE events. 1 is us; 0 and 2 are the
# Mind's side of the conversation.
SENDER_HUMAN = 1
SENDER_MIND = (0, 2)

_SEND_RETRY_DELAYS = (0.2, 0.4, 0.8)  # mirrors the JS client's 409 backoff
_POLL_INTERVAL = 2.0
_HISTORY_PAGE = 50
_REQUEST_TIMEOUT = 20.0


class MindsError(RuntimeError):
    """A Builder API call failed. Carries the parsed error envelope."""

    def __init__(
        self,
        message: str,
        *,
        status: Optional[int] = None,
        err_type: Optional[str] = None,
        sub_type: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.err_type = err_type
        self.sub_type = sub_type


def base_url() -> str:
    return (MINDS_BASE_URL or DEFAULT_BASE_URL).rstrip("/")


def human_id() -> Optional[str]:
    """The `humanId` claim out of the Builder API key, which is a JWT."""
    key = MINDS_BUILDER_API_KEY
    if not key or key.count(".") != 2:
        return None
    payload = key.split(".")[1]
    payload += "=" * (-len(payload) % 4)  # base64url, unpadded on the wire
    try:
        claims = json.loads(base64.urlsafe_b64decode(payload))
    except (ValueError, TypeError, json.JSONDecodeError):
        return None
    value = claims.get("humanId") if isinstance(claims, dict) else None
    return str(value) if value else None


# --- Transport ---------------------------------------------------------------


def _error_from(method: str, path: str, resp: httpx.Response) -> MindsError:
    """Parse `{"error": {"type", "subType", "message"}}` off a failed call."""
    err_type = sub_type = None
    message = resp.text[:200]
    try:
        body = resp.json()
    except ValueError:
        body = None
    if isinstance(body, dict) and isinstance(body.get("error"), dict):
        err = body["error"]
        err_type = err.get("type")
        sub_type = err.get("subType")
        message = err.get("message") or message
    label = "/".join(part for part in (err_type, sub_type) if part)
    return MindsError(
        f"{method} {path} -> {resp.status_code} {label} {message}".strip(),
        status=resp.status_code,
        err_type=err_type,
        sub_type=sub_type,
    )


def _request(
    method: str,
    path: str,
    *,
    json_body: Optional[dict] = None,
    params: Optional[dict] = None,
    timeout: float = _REQUEST_TIMEOUT,
) -> Any:
    if not MINDS_BUILDER_API_KEY:
        raise MindsError("MINDS_BUILDER_API_KEY is not set")
    try:
        resp = httpx.request(
            method,
            f"{base_url()}{path}",
            json=json_body,
            params=params,
            timeout=timeout,
            headers={
                "X-Api-Key": MINDS_BUILDER_API_KEY,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
    except httpx.HTTPError as exc:
        raise MindsError(f"{method} {path} failed: {exc}") from exc
    if resp.status_code >= 400:
        raise _error_from(method, path, resp)
    if not resp.content:
        return None
    try:
        return resp.json()
    except ValueError as exc:
        raise MindsError(f"{method} {path} returned a non-JSON body") from exc


def _rows(data: Any) -> list[dict]:
    """Builder API list endpoints answer with a bare array."""
    return [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []


# --- Minds and conversations -------------------------------------------------

_mind_id_cache: Optional[str] = None
_conversation_cache: set[str] = set()


def list_minds() -> list[dict]:
    """Every Mind on the account behind the Builder API key."""
    hid = human_id()
    if not hid:
        raise MindsError(
            "could not read humanId from MINDS_BUILDER_API_KEY — expected a JWT"
        )
    return _rows(_request("GET", f"/v1/humans/{quote(hid)}/minds"))


def resolve_mind_id(refresh: bool = False) -> str:
    """MINDS_ID when pinned, else the account's first enabled Mind (cached)."""
    global _mind_id_cache
    if MINDS_ID:
        return MINDS_ID
    if _mind_id_cache and not refresh:
        return _mind_id_cache
    found = list_minds()
    enabled = [m for m in found if m.get("isEnabled", True)]
    for mind in enabled or found:
        mind_id = mind.get("mindId")
        if mind_id:
            _mind_id_cache = str(mind_id)
            return _mind_id_cache
    raise MindsError("no Mind on this account — create one at build.hellominds.ai")


def ensure_conversation(alias: str, mind_id: str) -> dict:
    """Create the alias' conversation, or adopt the existing one.

    A duplicate alias comes back as 409 (sometimes 400); in that case the
    conversation already exists and is reused, unless it is bound to a
    different Mind — which is unrecoverable and worth saying out loud.
    """
    try:
        conv = _request(
            "POST",
            "/v1/messaging/conversation",
            json_body={"alias": alias, "mindId": mind_id},
        )
    except MindsError as exc:
        if exc.status not in (400, 409):
            raise
        conv = _request("GET", f"/v1/messaging/conversations/{quote(alias)}")
        bound = (conv or {}).get("mindId")
        if bound and str(bound) != str(mind_id):
            raise MindsError(
                f"alias_mind_mismatch: '{alias}' is bound to Mind {bound}, not {mind_id}"
            ) from exc
    _conversation_cache.add(alias)
    return conv or {}


# --- History and replies -----------------------------------------------------


def get_history(
    alias: str, limit: int = _HISTORY_PAGE, before: Optional[str] = None
) -> list[dict]:
    """One page of conversation history, newest row first.

    `before` is an exclusive cursor and takes a row's `fingerprint`.
    """
    params: dict[str, Any] = {"limit": max(1, min(int(limit), 200))}
    if before:
        params["before"] = before
    return _rows(
        _request("GET", f"/v1/messaging/histories/{quote(alias)}", params=params)
    )


def latest_fingerprint(alias: str) -> Optional[str]:
    """Fingerprint of the newest row, used as the 'everything after this' mark."""
    rows = get_history(alias, limit=1)
    fingerprint = rows[0].get("fingerprint") if rows else None
    return str(fingerprint) if fingerprint else None


def is_mind_reply(
    row: dict,
    *,
    alias: str,
    sent_text: Optional[str] = None,
    after_fingerprint: Optional[str] = None,
) -> bool:
    """Port of the JS client's `isReplyEvent` — is this row the Mind answering us?"""
    text = str(row.get("messageText") or "").strip()
    if not text:
        return False
    row_alias = row.get("alias")
    if row_alias and str(row_alias) != alias:
        return False
    if sent_text and text == sent_text.strip():
        return False
    # The wire sometimes calls it partyType instead of senderType.
    sender_type = row.get("senderType", row.get("partyType"))
    sender_name = row.get("senderName")
    if sender_type == SENDER_HUMAN or sender_name == "You":
        return False
    if after_fingerprint:
        fingerprint = row.get("fingerprint")
        if not fingerprint or str(fingerprint) <= after_fingerprint:
            return False
    return (
        sender_type in SENDER_MIND
        or bool(row.get("mindId"))
        or bool(sender_name and sender_name != "You")
    )


def send_message(alias: str, text: str) -> dict:
    """Post one message. A 409 here means 'busy' and is retried briefly."""
    for delay in (*_SEND_RETRY_DELAYS, None):
        try:
            sent = _request(
                "POST",
                "/v1/messaging/message",
                json_body={"alias": alias, "messageText": text},
            )
            return sent or {}
        except MindsError as exc:
            if exc.status != 409 or delay is None:
                raise
            time.sleep(delay)
    raise MindsError("send_message exhausted its retries")  # pragma: no cover


def _clean_text(html_or_text: str) -> str:
    import re
    text = (
        html_or_text.replace("</p><p>", "\n\n")
        .replace("<p>", "")
        .replace("</p>", "\n")
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
    )
    clean = re.sub(r"<[^>]+>", "", text).strip()
    return clean


def wait_for_reply(
    alias: str,
    *,
    sent_text: Optional[str] = None,
    after_fingerprint: Optional[str] = None,
    timeout_s: Optional[float] = None,
) -> Optional[str]:
    """Poll history until the Mind answers, or the deadline passes (None)."""
    budget = MINDS_REPLY_TIMEOUT if timeout_s is None else timeout_s
    deadline = time.monotonic() + max(0.0, budget)
    while True:
        for row in get_history(alias, limit=_HISTORY_PAGE):  # newest first
            if is_mind_reply(
                row,
                alias=alias,
                sent_text=sent_text,
                after_fingerprint=after_fingerprint,
            ):
                return _clean_text(str(row.get("messageText") or ""))
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return None
        time.sleep(min(_POLL_INTERVAL, remaining))


def ask(
    text: str, *, alias: Optional[str] = None, timeout_s: Optional[float] = None
) -> Optional[str]:
    """One full round trip: send `text` to the Mind and return its reply.

    None means the Mind stayed quiet inside the timeout. Raises MindsError if
    the account, key, or conversation is misconfigured.
    """
    convo = alias or MINDS_ALIAS
    mind_id = resolve_mind_id()
    if convo not in _conversation_cache:
        ensure_conversation(convo, mind_id)
    after = latest_fingerprint(convo)
    send_message(convo, text)
    return wait_for_reply(
        convo, sent_text=text, after_fingerprint=after, timeout_s=timeout_s
    )


def probe() -> dict:
    """Cheap health read for /api/mind/status — never raises."""
    state: dict[str, Any] = {
        "baseUrl": base_url(),
        "keyConfigured": bool(MINDS_BUILDER_API_KEY),
        "humanId": bool(human_id()),
        "alias": MINDS_ALIAS,
        "mindId": MINDS_ID or None,
        "reachable": False,
        "mindsCount": 0,
        "error": None,
    }
    if not MINDS_BUILDER_API_KEY:
        state["error"] = "MINDS_BUILDER_API_KEY is not set"
        return state
    try:
        found = list_minds()
    except MindsError as exc:
        state["error"] = str(exc)
        return state
    except Exception as exc:  # defensive: status must never 500
        state["error"] = f"{type(exc).__name__}: {exc}"
        return state
    state["reachable"] = True
    state["mindsCount"] = len(found)
    if not state["mindId"]:
        try:
            state["mindId"] = resolve_mind_id()
        except MindsError as exc:
            state["error"] = str(exc)
    return state
