"""Gemini adapter for editor intelligence.

The service uses Gemini's REST generateContent API through httpx, so Encore can
use Gemini without adding a heavy SDK dependency. Callers should treat `None`
as a normal "fall back locally" result.
"""

import json
import logging
import mimetypes
import os
import re
import time
from typing import Optional

import httpx

from ..config import GEMINI_API_KEY, GEMINI_MODEL_TEXT, GEMINI_MODEL_VIDEO
from . import ffmpeg

log = logging.getLogger("encore.gemini")
_LAST_ERROR: Optional[dict] = None

LANGUAGE_LABELS = {
    "en": "English",
    "fr": "French",
    "es": "Spanish",
    "pt": "Portuguese",
    "de": "German",
    "it": "Italian",
    "ar": "Arabic",
    "hi": "Hindi",
}


def _moment_count_guidance(span: float) -> tuple[int, int, str]:
    if span < 45:
        return 1, 3, "short takes under 45 seconds usually have 1 to 3 strong moments"
    if span < 120:
        return 3, 6, "takes from 45 seconds to 2 minutes usually have 3 to 6 strong moments"
    return 5, 10, "takes over 2 minutes usually have 5 to 10 strong moments"


def available() -> bool:
    return bool(GEMINI_API_KEY)


def clear_last_error() -> None:
    global _LAST_ERROR
    _LAST_ERROR = None


def last_error() -> Optional[dict]:
    return dict(_LAST_ERROR) if _LAST_ERROR else None


def _classify_error(exc: Exception) -> dict:
    text = str(exc)
    lowered = text.lower()
    if "429" in text or "too many requests" in lowered:
        return {
            "errorType": "quota",
            "message": "The video AI hit a rate limit. Try again in a few minutes or use a higher quota key.",
        }
    if "timeout" in lowered or "timed out" in lowered:
        return {
            "errorType": "timeout",
            "message": "The video AI took too long to answer. Try again, or use a shorter clip.",
        }
    if "connect" in lowered or "network" in lowered or "disconnected" in lowered:
        return {
            "errorType": "network",
            "message": "Network error while sending the video for analysis. Check the connection and retry.",
        }
    if "500" in text or "503" in text or "server error" in lowered:
        return {
            "errorType": "api",
            "message": "The video AI service returned a server error. Try again in a moment.",
        }
    return {
        "errorType": "unknown",
        "message": "The video AI could not finish this analysis. Try again or use a shorter clip.",
    }


def _set_error(exc: Exception) -> None:
    global _LAST_ERROR
    _LAST_ERROR = _classify_error(exc)


def _extract_text(payload: dict) -> str:
    try:
      parts = payload["candidates"][0]["content"]["parts"]
    except (KeyError, IndexError, TypeError):
      return ""
    out: list[str] = []
    for part in parts:
        text = part.get("text") if isinstance(part, dict) else None
        if isinstance(text, str):
            out.append(text)
    return "\n".join(out).strip()


def _json_from_text(text: str):
    text = text.strip()
    if not text:
        return None
    if "```" in text:
        for part in text.split("```"):
            chunk = part.strip()
            if chunk.lower().startswith("json"):
                chunk = chunk[4:].strip()
            if chunk.startswith(("{", "[")):
                try:
                    return json.loads(chunk)
                except ValueError:
                    pass
    try:
        return json.loads(text)
    except ValueError:
        pass
    match = re.search(r"\{.*\}", text, re.S)
    if match:
        try:
            return json.loads(match.group(0))
        except ValueError:
            return None
    return None


def _extract_interaction_text(payload: dict) -> str:
    direct = payload.get("output_text") or payload.get("outputText")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()

    out: list[str] = []
    for step in payload.get("steps", []):
        if not isinstance(step, dict):
            continue
        content = step.get("content")
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and isinstance(part.get("text"), str):
                    out.append(part["text"])
        summary = step.get("summary")
        if isinstance(summary, list):
            for part in summary:
                if isinstance(part, dict) and isinstance(part.get("text"), str):
                    out.append(part["text"])
    return "\n".join(out).strip()


def _mime_type(path: str) -> str:
    return mimetypes.guess_type(path)[0] or "video/mp4"


def _gemini_file_record(payload: dict) -> dict:
    file_record = payload.get("file") if isinstance(payload, dict) else None
    return file_record if isinstance(file_record, dict) else payload


def _sleep_before_retry(attempt: int) -> None:
    time.sleep(2 + attempt * 3)


def _upload_video_file(path: str, timeout_s: float = 180.0) -> Optional[dict]:
    if not available() or not os.path.isfile(path):
        return None

    mime_type = _mime_type(path)
    size = os.path.getsize(path)
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            start = httpx.post(
                "https://generativelanguage.googleapis.com/upload/v1beta/files",
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": GEMINI_API_KEY,
                    "X-Goog-Upload-Protocol": "resumable",
                    "X-Goog-Upload-Command": "start",
                    "X-Goog-Upload-Header-Content-Length": str(size),
                    "X-Goog-Upload-Header-Content-Type": mime_type,
                },
                json={"file": {"display_name": os.path.basename(path)}},
                timeout=45.0,
            )
            start.raise_for_status()
            upload_url = start.headers.get("x-goog-upload-url")
            if not upload_url:
                log.warning("Gemini video upload did not return an upload URL")
                return None

            with open(path, "rb") as handle:
                uploaded = httpx.post(
                    upload_url,
                    headers={
                        "Content-Length": str(size),
                        "X-Goog-Upload-Offset": "0",
                        "X-Goog-Upload-Command": "upload, finalize",
                    },
                    content=handle,
                    timeout=timeout_s,
                )
            uploaded.raise_for_status()
            record = _gemini_file_record(uploaded.json())
            record.setdefault("mime_type", mime_type)
            record.setdefault("mimeType", mime_type)
            return record
        except Exception as exc:
            _set_error(exc)
            last_error = exc
            log.warning(
                "Gemini video upload attempt %s failed: %s",
                attempt + 1,
                exc,
            )
            if attempt < 2:
                _sleep_before_retry(attempt)
    log.warning("Gemini video upload unavailable after retries: %s", last_error)
    return None


def _wait_file_active(file_record: dict, timeout_s: float = 120.0) -> Optional[dict]:
    name = file_record.get("name")
    if not name:
        return file_record

    deadline = time.monotonic() + timeout_s
    current = file_record
    while time.monotonic() < deadline:
        state = str(current.get("state") or "").upper()
        if state in {"ACTIVE", "SUCCEEDED"}:
            return current
        if state == "FAILED":
            log.warning("Gemini video processing failed for %s", name)
            return None
        try:
            response = httpx.get(
                f"https://generativelanguage.googleapis.com/v1beta/{name}",
                headers={"x-goog-api-key": GEMINI_API_KEY},
                timeout=30.0,
            )
            response.raise_for_status()
            current = _gemini_file_record(response.json())
        except Exception as exc:
            log.warning("Gemini video processing status unavailable: %s", exc)
            return None
        time.sleep(3)
    log.warning("Gemini video processing timed out for %s", name)
    return None


def _interaction_json_from_video(
    *,
    file_record: dict,
    prompt: str,
    timeout_s: float = 45.0,
) -> Optional[dict]:
    uri = file_record.get("uri")
    mime_type = file_record.get("mime_type") or file_record.get("mimeType") or "video/mp4"
    if not uri:
        return None
    body = {
        "model": GEMINI_MODEL_VIDEO,
        "input": [
            {
                "type": "video",
                "uri": uri,
                "mime_type": mime_type,
                "processing": "agentic",
            },
            {"type": "text", "text": prompt},
        ],
    }
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            response = httpx.post(
                "https://generativelanguage.googleapis.com/v1beta/interactions",
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": GEMINI_API_KEY,
                },
                json=body,
                timeout=timeout_s,
            )
            response.raise_for_status()
            return _json_from_text(_extract_interaction_text(response.json()))
        except Exception as exc:
            _set_error(exc)
            last_error = exc
            log.warning(
                "Gemini video moment detection attempt %s failed: %s",
                attempt + 1,
                exc,
            )
            if attempt < 1:
                _sleep_before_retry(attempt)
    log.warning("Gemini video moment detection unavailable after retries: %s", last_error)
    return None


def _generate_json_from_video_file(
    *,
    file_record: dict,
    prompt: str,
    schema: dict,
    timeout_s: float = 60.0,
) -> Optional[dict]:
    uri = file_record.get("uri")
    mime_type = file_record.get("mime_type") or file_record.get("mimeType") or "video/mp4"
    if not uri:
        return None
    url = (
        "https://generativelanguage.googleapis.com/v1beta/"
        f"models/{GEMINI_MODEL_VIDEO}:generateContent"
    )
    body = {
        "contents": [
            {
                "parts": [
                    {
                        "file_data": {
                            "file_uri": uri,
                            "mime_type": mime_type,
                        },
                        "media_processing": "AGENTIC",
                    },
                    {"text": prompt},
                ]
            }
        ],
        "generationConfig": {
            "response_mime_type": "application/json",
            "response_schema": schema,
        },
    }
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            response = httpx.post(
                url,
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": GEMINI_API_KEY,
                },
                json=body,
                timeout=timeout_s,
            )
            response.raise_for_status()
            return _json_from_text(_extract_text(response.json()))
        except Exception as exc:
            _set_error(exc)
            last_error = exc
            log.warning(
                "Gemini generateContent video attempt %s failed: %s",
                attempt + 1,
                exc,
            )
            if attempt < 1:
                _sleep_before_retry(attempt)
    log.warning("Gemini generateContent video unavailable after retries: %s", last_error)
    return None


def _generate_json(prompt: str, schema: dict, timeout_s: float = 45.0):
    if not available():
        return None
    url = (
        "https://generativelanguage.googleapis.com/v1beta/"
        f"models/{GEMINI_MODEL_TEXT}:generateContent"
    )
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "response_mime_type": "application/json",
            "response_schema": schema,
        },
    }
    try:
        response = httpx.post(
            url,
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": GEMINI_API_KEY,
            },
            json=body,
            timeout=timeout_s,
        )
        response.raise_for_status()
    except Exception as exc:
        log.warning("Gemini caption generation unavailable: %s", exc)
        return None
    return _json_from_text(_extract_text(response.json()))


def generate_text(prompt: str, timeout_s: float = 45.0) -> Optional[str]:
    if not available():
        return None
    url = (
        "https://generativelanguage.googleapis.com/v1beta/"
        f"models/{GEMINI_MODEL_TEXT}:generateContent"
    )
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": 600,
        },
    }
    try:
        response = httpx.post(
            url,
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": GEMINI_API_KEY,
            },
            json=body,
            timeout=timeout_s,
        )
        response.raise_for_status()
    except Exception as exc:
        _set_error(exc)
        log.warning("Gemini text generation unavailable: %s", exc)
        return None
    text = _extract_text(response.json()).strip()
    return text or None


def chat_reply(
    *,
    text: str,
    context: str = "",
    memories: Optional[list[dict]] = None,
    history: Optional[list[dict]] = None,
) -> Optional[str]:
    memory_lines = "\n".join(
        f"- {item.get('content')}"
        for item in (memories or [])[-6:]
        if str(item.get("content", "")).strip()
    )
    history_lines = "\n".join(
        f"{'Creator' if item.get('role') == 'you' else 'Encore'}: {item.get('text')}"
        for item in (history or [])[-8:]
        if str(item.get("text", "")).strip()
    )
    prompt = (
        "You are Encore, a concise AI video editing partner inside a creator's editor.\n"
        "Answer the creator's exact message. Use the project context and memory when useful.\n"
        "Do not claim you performed an action unless the context says it is already done.\n"
        "Keep replies practical, specific, and short.\n\n"
        f"Project context:\n{context or 'No extra project context.'}\n\n"
        f"Persistent memory:\n{memory_lines or 'No saved preferences yet.'}\n\n"
        f"Recent chat:\n{history_lines or 'No recent chat.'}\n\n"
        f"Creator message:\n{text}"
    )
    return generate_text(prompt)


def propose_post_copy(moment: dict, transcript_hint: str = "") -> Optional[dict]:
    label = str(moment.get("label") or "Moment").strip()
    reason = str(moment.get("reason") or "").strip()
    start = float(moment.get("start") or 0)
    end = float(moment.get("end") or 0)
    schema = {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "caption": {"type": "string"},
            "hashtags": {
                "type": "array",
                "items": {"type": "string"},
            },
            "tags": {
                "type": "array",
                "items": {"type": "string"},
            },
        },
        "required": ["title", "caption", "hashtags", "tags"],
    }
    prompt = (
        "Write platform-ready short-form post copy for a creator's video cut.\n"
        "Do not use generic filler like 'Long video to short cut' or mention the editor app.\n"
        "Make the title specific to the moment, curiosity-driven, and under 70 characters.\n"
        "Make the caption sound human, specific, and shareable. Use 1-2 short paragraphs.\n"
        "Return 5-8 relevant hashtags and 4-8 plain search tags.\n\n"
        f"Moment label: {label}\n"
        f"Timestamp: {start:.1f}-{end:.1f}s\n"
        f"Why it hits: {reason or 'Strong standalone beat.'}\n"
        f"{transcript_hint or ''}"
    )
    data = _generate_json(prompt, schema, timeout_s=45.0)
    if not isinstance(data, dict):
        return None
    title = str(data.get("title") or label).strip()
    caption = str(data.get("caption") or "").strip()
    hashtags = data.get("hashtags")
    tags = data.get("tags")
    if not title or not caption:
        return None
    clean_hashtags = []
    if isinstance(hashtags, list):
        for tag in hashtags[:10]:
            value = str(tag).strip()
            if not value:
                continue
            clean_hashtags.append(value if value.startswith("#") else f"#{value}")
    clean_tags = [str(tag).strip() for tag in tags[:10] if str(tag).strip()] if isinstance(tags, list) else []
    return {
        "title": title[:90],
        "caption": caption,
        "hashtags": clean_hashtags,
        "tags": clean_tags,
    }


def propose_caption_segments(
    *,
    title: str,
    caption: str,
    start: float,
    end: float,
    language: str,
    transcript: Optional[list[dict]] = None,
) -> Optional[list[dict]]:
    label = LANGUAGE_LABELS.get(language, "English")
    schema = {
        "type": "object",
        "properties": {
            "segments": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "start": {"type": "number"},
                        "end": {"type": "number"},
                        "text": {"type": "string"},
                    },
                    "required": ["start", "end", "text"],
                },
            }
        },
        "required": ["segments"],
    }
    transcript_lines = ""
    if transcript:
        transcript_lines = "\n".join(
            f"[{float(seg.get('start', 0)):.2f}-{float(seg.get('end', 0)):.2f}] {seg.get('text', '')}"
            for seg in transcript[:120]
            if str(seg.get("text", "")).strip()
        )
    source = (
        f"Speech transcript:\n{transcript_lines}\n\n"
        if transcript_lines
        else f"Reference copy: {caption}\n\n"
    )
    prompt = (
        f"Create accurate on-video subtitles in {label} for a social video clip.\n"
        f"The clip timeline starts at {start:.2f}s and ends at {end:.2f}s.\n"
        f"Title/context: {title}\n"
        f"{source}"
        "Return caption segments that follow the spoken speech beat by beat. "
        "Each segment must stay within the clip start/end, use absolute timeline "
        "seconds, and keep each line short enough for a video subtitle."
    )
    data = _generate_json(prompt, schema)
    if not isinstance(data, dict) or not isinstance(data.get("segments"), list):
        return None
    out: list[dict] = []
    for item in data["segments"]:
        if not isinstance(item, dict):
            continue
        try:
            a = float(item["start"])
            b = float(item["end"])
        except (KeyError, TypeError, ValueError):
            continue
        text = str(item.get("text", "")).strip()
        if not text:
            continue
        a = max(start, min(end, a))
        b = max(a + 0.2, min(end, b))
        if b <= end and b > a:
            out.append({"start": a, "end": b, "text": text})
    return out or None


def _normalize_moment_rows(rows: object, span: float) -> Optional[list[dict]]:
    if not isinstance(rows, list):
        return None
    out: list[dict] = []
    seen: set[tuple[int, int]] = set()
    for item in rows:
        if not isinstance(item, dict):
            continue
        try:
            start = max(0.0, float(item["start"]))
            end = min(span, float(item["end"]))
        except (KeyError, TypeError, ValueError):
            continue
        if end <= start + 0.8:
            continue
        if end - start > min(90.0, max(12.0, span * 0.6)):
            continue
        key = (round(start), round(end))
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "start": start,
                "end": end,
                "label": str(item.get("label") or "Moment").strip()[:80] or "Moment",
                "reason": str(
                    item.get("reason") or "Detected by watching the uploaded video."
                ).strip()[:240],
            }
        )
    return out or None


def propose_video_moments(
    src_path: str,
    transcript: Optional[list[dict]],
    span: float,
) -> Optional[list[dict]]:
    clear_last_error()
    review_path = ffmpeg.analysis_proxy(src_path)
    uploaded = _upload_video_file(review_path)
    if not uploaded:
        return None
    active_file = _wait_file_active(uploaded)
    if not active_file:
        return None

    transcript_lines = ""
    if transcript:
        transcript_lines = "\n".join(
            f"[{float(seg.get('start', 0)):.1f}-{float(seg.get('end', 0)):.1f}] {seg.get('text', '')}"
            for seg in transcript[:500]
            if str(seg.get("text", "")).strip()
        )
    transcript_context = (
        f"\nOptional speech transcript for timestamp cross-checking:\n{transcript_lines}\n"
        if transcript_lines
        else ""
    )
    min_moments, max_moments, count_note = _moment_count_guidance(span)
    prompt = (
        f"Watch this full {span:.1f}s video and find the parts that hit as standalone short clips.\n"
        "Judge the actual video: visuals, reactions, audio energy, pacing, emotional turns, "
        "surprise, punchlines, clear claims, and satisfying clip boundaries.\n"
        "Do not split the video evenly. Do not create a moment just to fill a quota. "
        "Reject filler, silent setup, repeated wording, and weak sections.\n"
        f"Find every distinct usable beat: {count_note}. Aim for {min_moments} to "
        f"{max_moments} moments when the content supports it, but return fewer if only "
        "fewer sections are genuinely strong. Use exact timestamps from the video and "
        "keep moments tight enough for a short-form edit.\n"
        f"{transcript_context}\n"
        "Return only JSON in this shape: "
        '{"moments":[{"start":0.0,"end":0.0,"label":"short label","reason":"why this exact section hits"}]}'
    )
    schema = {
        "type": "object",
        "properties": {
            "moments": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "start": {"type": "number"},
                        "end": {"type": "number"},
                        "label": {"type": "string"},
                        "reason": {"type": "string"},
                    },
                    "required": ["start", "end", "label", "reason"],
                },
            }
        },
        "required": ["moments"],
    }
    data = _interaction_json_from_video(file_record=active_file, prompt=prompt)
    if not isinstance(data, dict):
        data = _generate_json_from_video_file(
            file_record=active_file,
            prompt=prompt,
            schema=schema,
        )
    rows = data.get("moments") if isinstance(data, dict) else None
    return _normalize_moment_rows(rows, span)


def propose_moments(transcript: list[dict], span: float) -> Optional[list[dict]]:
    lines = "\n".join(
        f"[{float(seg.get('start', 0)):.1f}-{float(seg.get('end', 0)):.1f}] {seg.get('text', '')}"
        for seg in transcript[:400]
        if str(seg.get("text", "")).strip()
    )
    if not lines:
        return None
    schema = {
        "type": "object",
        "properties": {
            "moments": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "start": {"type": "number"},
                        "end": {"type": "number"},
                        "label": {"type": "string"},
                        "reason": {"type": "string"},
                    },
                    "required": ["start", "end", "label", "reason"],
                },
            }
        },
        "required": ["moments"],
    }
    min_moments, max_moments, count_note = _moment_count_guidance(span)
    prompt = (
        f"Find every real standalone highlight moment from this {span:.0f}s video transcript.\n"
        f"Count guidance: {count_note}. Aim for {min_moments} to {max_moments} moments "
        "when the transcript supports it, but return fewer if only fewer sections are strong.\n"
        f"{lines}\n\n"
        "Use only the transcript timing. Do not invent topics. Pick moments that "
        "can stand alone as short clips, with a clear label and concrete reason."
    )
    data = _generate_json(prompt, schema, timeout_s=60.0)
    rows = data.get("moments") if isinstance(data, dict) else None
    return _normalize_moment_rows(rows, span)
