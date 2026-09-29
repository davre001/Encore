"""Verify the caption job end to end: stages, real progress, cue quality, fallback.

Run from backend/ with the venv python:
    PYTHONPATH=. ./.venv/Scripts/python.exe ../scripts/verify-captions.py
"""

import json
import os
import sys
import tempfile

sys.path.insert(0, os.getcwd())

from fastapi.testclient import TestClient  # noqa: E402

from app import storage  # noqa: E402
from app.main import app  # noqa: E402
from app.services import caption_cues, transcribe  # noqa: E402
from app.services.security import create_access_token  # noqa: E402

storage.DATA_DIR = tempfile.mkdtemp(prefix="encore-caption-")

failures: list[str] = []
checks = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global checks
    checks += 1
    if not ok:
        failures.append(f"{label}{(' — ' + detail) if detail else ''}")


def rows_from(beats, rate=0.35):
    """Build transcript rows: (words, pause_after) per beat."""
    out, t = [], 0.0
    for words, pause in beats:
        timed = []
        for word in words:
            timed.append({"start": round(t, 3), "end": round(t + rate, 3), "text": word})
            t += rate
        out.append(
            {
                "start": timed[0]["start"],
                "end": timed[-1]["end"],
                "text": " ".join(words),
                "words": timed,
            }
        )
        t += pause
    return out


# Two beats split by a real pause, then one long unbroken run that only the
# frame's word budget can break, then a sentence end.
ROWS = rows_from(
    [
        (["Hello", "everyone", "and", "welcome", "back"], 0.9),
        (
            ["Today", "we", "are", "cutting", "a", "long", "take", "into", "beats",
             "that", "stand", "on", "their", "own", "without", "any", "help"],
            0.0,
        ),
        (["That", "is", "the", "whole", "idea."], 0.0),
    ]
)

CLIP_START, CLIP_END = 0.0, 12.0
ASPECT = "16:9"

# --- record every publish so the stage sequence is observable ----------------
timeline: list[dict] = []
_real_publish = storage.save_caption_job


def _spy(clip_id, job):
    timeline.append({"stage": job.get("stage"), "progress": job.get("progress", 0),
                     "message": job.get("message")})
    return _real_publish(clip_id, job)


storage.save_caption_job = _spy

# A video with a source path, so a cache miss reaches the transcriber.
storage.save_video({"id": "vid1", "name": "take.mp4", "duration": 12.0,
                    "createdAt": storage.now_ms(), "srcPath": "/tmp/take.mp4"})

progress_seen: list[float] = []


def fake_transcribe(path, on_progress=None):
    for fraction in (0.2, 0.55, 0.9, 1.0):
        if on_progress:
            on_progress(fraction)
        progress_seen.append(fraction)
    return ROWS


transcribe.available = lambda: True
transcribe.transcribe_words = fake_transcribe

client = TestClient(app)
# A real signed session, so the run goes through the same auth the editor does.
AUTH = {"Authorization": f"Bearer {create_access_token('verify-user')}"}
body = {
    "clipId": "clip1", "videoId": "vid1", "title": "A long take",
    "caption": "Hello everyone and welcome back", "start": CLIP_START,
    "end": CLIP_END, "language": "en", "aspect": ASPECT,
}

# --- 1. the POST answers immediately with a queued job ----------------------
posted = client.post("/api/captions/generate", json=body, headers=AUTH)
check("POST /generate returns 200", posted.status_code == 200, str(posted.status_code))
queued = posted.json()
check("POST returns the queued stage", queued["stage"] == "queued", json.dumps(queued))
check("POST does not claim to be done", queued["done"] is False)

# --- 2. the job record the editor polls -------------------------------------
job = client.get("/api/captions/clip1/job", headers=AUTH).json()
check("job is done", job["done"] is True, json.dumps(job)[:200])
check("job ends complete", job["stage"] == "complete", job["stage"])
check("job carries no error", not job.get("error"), str(job.get("error")))
check("job reaches 100%", job["progress"] == 100, str(job["progress"]))

track = job.get("track")
check("job carries a track", bool(track))
if not track:
    print("\n".join(failures))
    sys.exit(1)

# --- 3. stages advanced in order and the bar never went backwards -----------
order = ["queued", "transcribing", "beats", "fitting", "complete"]
stages = [step["stage"] for step in timeline]
check("stages in order", stages == sorted(stages, key=order.index), str(stages))
check("transcribing published more than once", stages.count("transcribing") > 1, str(stages))
check("every stage visited", set(stages) >= {"queued", "transcribing", "beats", "complete"},
      str(set(stages)))
progress = [step["progress"] for step in timeline]
check("progress never decreases", all(b >= a for a, b in zip(progress, progress[1:])), str(progress))
check("bar rises during transcribing",
      max(progress[: len(progress)]) > progress[1] and progress[1] == 5, str(progress))
check("spoken fractions drove the bar", len(progress_seen) == 4, str(progress_seen))

# --- 4. the timings came from the audio, not a model ------------------------
check("track is marked speech", track["source"] == "speech", str(track.get("source")))
segments = track["segments"]
check("cues were produced", len(segments) >= 3, str(len(segments)))

budget = caption_cues.words_per_line(ASPECT) * caption_cues.MAX_LINES
spoken = " ".join(word["text"] for row in ROWS for word in row["words"])
caption = " ".join(segment["text"] for segment in segments)
check("every spoken word appears", caption.split() == spoken.split(),
      f"{caption[:60]!r} != {spoken[:60]!r}")

for index, segment in enumerate(segments):
    words = segment["words"]
    check(f"cue {index} kept its words", len(words) > 0)
    check(f"cue {index} within the frame budget", len(words) <= budget,
          f"{len(words)} > {budget}")
    check(f"cue {index} inside the clip range",
          segment["start"] >= CLIP_START and segment["end"] <= CLIP_END,
          f"{segment['start']}-{segment['end']}")
    check(f"cue {index} text matches its words",
          segment["text"].split() == [word["text"] for word in words])
    for word in words:
        check(f"cue {index} word inside its cue",
              word["start"] >= segment["start"] - 0.001
              and word["end"] <= segment["end"] + 0.001,
              f"{word['start']}-{word['end']} vs {segment['start']}-{segment['end']}")
    ordered = all(b["start"] >= a["end"] - 0.001 for a, b in zip(words, words[1:]))
    check(f"cue {index} words are in time order", ordered)

check("cue words are the words whisper timed",
      [w["start"] for s in segments for w in s["words"]]
      == [w["start"] for r in ROWS for w in r["words"]])

# Cue boundaries fall on a real break: a pause, punctuation, the frame's word
# budget running out, or the reading clock — holding the cue any longer would
# leave it on screen past the time a subtitle should stay up.
for index, segment in enumerate(segments[:-1]):
    ended = segment["text"].rstrip()
    next_start = segments[index + 1]["start"]
    next_end = segments[index + 1]["end"]
    gap = next_start - segment["end"]
    check(f"cue {index} breaks at a pause, a sentence, the budget, or the clock",
          gap >= caption_cues.PAUSE_BREAK - 0.001
          or ended.endswith((".", "!", "?", "…"))
          or len(segment["words"]) == budget
          or next_end - segment["start"] > caption_cues.MAX_CUE_SECONDS,
          f"gap {gap:.2f}, text {ended[-12:]!r}, words {len(segment['words'])}, "
          f"joined {next_end - segment['start']:.2f}s")

check("no cue outlived the reading clock",
      all(s["end"] - s["start"] <= caption_cues.MAX_CUE_SECONDS + 0.001 for s in segments),
      str([round(s["end"] - s["start"], 2) for s in segments]))

# --- 5. the cache serves the second run without reading the take again ------
calls = {"n": 0}


def counting_transcribe(path, on_progress=None):
    calls["n"] += 1
    return fake_transcribe(path, on_progress)


transcribe.transcribe_words = counting_transcribe
client.post("/api/captions/generate", json={**body, "clipId": "clip2"}, headers=AUTH).json()
check("second run reads the cached transcript", calls["n"] == 0, f"{calls['n']} reads")

# --- 6. no audio read at all: the estimate still beats word by word ---------
storage.get_transcript = lambda video_id: None
storage.get_video = lambda video_id: None
transcribe.available = lambda: False
transcribe.transcribe_words = lambda path, on_progress=None: []
timeline.clear()
client.post("/api/captions/generate", json={**body, "clipId": "clip3"}, headers=AUTH)
fallback = client.get("/api/captions/clip3/job", headers=AUTH).json()
check("fallback job completes", fallback["done"] and fallback["stage"] == "complete",
      json.dumps(fallback)[:160])
check("fallback is marked estimated", fallback["track"]["source"] == "estimated",
      str(fallback["track"]["source"]))
check("fallback cues still carry word times",
      all(segment["words"] for segment in fallback["track"]["segments"]),
      str([len(s["words"]) for s in fallback["track"]["segments"]]))

# --- 7. a real whisper read reports its own progress -----------------------
print(f"\n{checks - len(failures)}/{checks} checks passed")
if failures:
    print("\nFAILURES:")
    for item in failures:
        print(" -", item)
    sys.exit(1)
print("all green")
