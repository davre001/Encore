# Encore

**The second take that lands.** Upload a long video, review the standout moments Encore proposes, accept or reject each one — and it cuts the clip, writes the caption, tags, and hashtags, and posts it. Later it checks the live post, tells you what actually worked, and offers a better recut. It remembers your taste and which hooks flop, so every suggestion gets sharper.

Long take in, standalone Shorts out.

---

## The loop

```
 upload  ─▶  transcribe  ─▶  detect moments  ─▶  you accept / reject
                                                        │
                        ┌───────────────────────────────┘
                        ▼
            cut the clip + write title / caption / hashtags
                        ▼
                 publish to YouTube Shorts
                        ▼
        check the live post ──▶ hit / mid / flop + a note
                        ▼
     remember your taste (playbook) ──▶ smarter next suggestions
```

Every step is a real endpoint. When the tools and keys for a step are present it runs for real; when they aren't, it falls back to a deterministic stand-in so the whole loop still works end-to-end.

---

## What's in the box

Encore is a monorepo with two independent halves:

```
Encore/
├── frontend/     Next.js 15 app — the full creator UI (App Router)
├── backend/      FastAPI service — the full pipeline, capability-gated
├── data/         runtime JSON store        (gitignored)
├── uploads/      uploads + rendered clips   (gitignored)
├── LICENSE
└── README.md
```

- **Frontend** — a complete, multi-page dark UI: landing, auth, dashboard, a cut-room editor, analytics, history, profile, and settings. It runs today on client-side mock data.
- **Backend** — the real pipeline: transcription, transcript-driven moment detection, ffmpeg clip rendering, an AI agent for captions/chat/review, YouTube publish + stats, and a persistent "playbook" memory. Verified end-to-end.

> **Current wiring status:** both halves are built and work on their own. The frontend still reads from its mock library and the API client (`frontend/src/api/client.ts`) is intentionally left as stubs — connecting the UI to the live backend is the next pass. The shapes already match (see [The contract](#the-contract)), so it's a drop-in.

---

## Frontend

A Next.js 15 (App Router) + React 19 + TypeScript app, styled with Tailwind CSS v4 in a shadcn-style dark theme. Type — **Inter** for body, **Geist Mono** for data, **Bricolage Grotesque** for the display headline. Motion via **GSAP** (ScrollTrigger) and **Motion / Framer Motion**, with a reduced-motion-safe wrapper.

**Pages**

| Route | What it is |
|---|---|
| `/` | Landing — animated orbital canvas hero fading into a pinned, GSAP-driven story-scroll |
| `/signin`, `/signup` | Auth screens with a Google sign-in button (`AuthContext` + `RequireAuth` guard) |
| `/home` | Dashboard / project home |
| `/editor` | The **cut room** — timeline, transport bar, moment review, clip context menu, tool panels, upload canvas |
| `/analytics` | Performance charts — verdict donut, views area + bar charts, animated count-ups |
| `/history` | Past clips and posts |
| `/profile`, `/settings` | Creator profile and preferences |

**Highlights**

- **Cut-room editor** with a filmstrip/waveform timeline, a bottom transport toolbar, an empty-state upload canvas, and a right-click clip menu.
- **Moment review** — each proposed beat shows its label, reason, and span; accept turns it into a clip.
- **Analytics** dashboard with hit/mid/flop verdicts and view trends.
- A reusable **motion system** (`Reveal`, `Stagger`, `CountUp`) that respects `prefers-reduced-motion`.

**Run it**

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
# npm run build && npm start   # production
```

---

## Backend

A FastAPI + Pydantic v2 service that implements the entire pipeline. It boots with nothing but the core dependencies and lights up real integrations as their tools/keys appear.

### Architecture — capability-gated adapters with a deterministic fallback

Every external integration (ffmpeg/ffprobe, faster-whisper, the Minds agent SDK, the YouTube Data API) lives behind one clean service function. The heavy imports are lazy and wrapped in `try/except`, and a pure runtime probe — `config.capabilities()` — decides real-vs-simulated **without importing anything heavy**. With nothing installed, the server still boots and every endpoint returns a deterministic result ported byte-for-byte from the frontend's mock library, so behavior is identical whether a step is real or simulated.

- **Storage** — JSON files under `DATA_DIR`, uploads and rendered clips under `UPLOAD_DIR`, guarded by a single `threading.RLock` with atomic `os.replace`. No database. Records are stored in camelCase so they round-trip straight into the Pydantic models.
- **Async** — upload returns the `Video` immediately, then transcription + moment proposal run in a FastAPI `BackgroundTask`. `GET /api/moments/{videoId}` returns `[]` until they're ready (poll it).
- **Honest** — `GET /api/health` reports exactly which integrations are real right now.
- **Swagger** — FastAPI generates the OpenAPI schema automatically; interactive **Swagger UI** is at `/docs` (the root `/` redirects there), ReDoc at `/redoc`, raw schema at `/openapi.json`.

### Moment detection

Three tiers, best first, each falling through to the next so there's always an answer:

1. **Minds agent** proposes beats from the transcript (real AI).
2. **Transcript keyword scan** — times the known beats (*Confession hook*, *Talking-head tip*, *Exam-panic rant*) to the actual speech segments Whisper heard.
3. **Positional beats** — fractions of the take, identical to the frontend's `buildMoments`, so with no transcript the API returns exactly what the mock UI shows.

### Post grading

A live (or simulated) view count is graded against your rolling median (`4100` by default): **hit** ≥ 2× median, **flop** < 0.4× median, otherwise **mid** — each with a note, and a fresh recut hook when a clip flops. The verdict folds back into the playbook so the agent learns which hooks land.

### Endpoints

| Method | Path | Returns |
|---|---|---|
| `GET`  | `/` | → redirect to Swagger UI (`/docs`) |
| `GET`  | `/api/health` | `{ status, capabilities }` |
| `POST` | `/api/videos` | `Video` (background: transcribe → propose moments) |
| `GET`  | `/api/videos/{id}` | `Video` |
| `GET`  | `/api/moments/{videoId}` | `Moment[]` (`[]` until the background task finishes) |
| `POST` | `/api/moments/{momentId}/decide` | `Moment` (accept → auto-build + render clip, update playbook) |
| `GET`  | `/api/clips/{videoId}` | `Clip[]` |
| `POST` | `/api/clips/{clipId}/render` | `Clip` (re-render the cut) |
| `POST` | `/api/posts/{clipId}` | `{ postId, postUrl }` (publish; marks the clip posted) |
| `GET`  | `/api/posts/{postId}/check` | `PostCheck` (grades it, records the outcome) |
| `GET`  | `/api/messages/{videoId}` | `Message[]` |
| `POST` | `/api/messages` | `Message` (agent reply; saves both sides of the chat) |

### Run it

```bash
cd backend
python -m venv .venv
# Windows PowerShell:  .\.venv\Scripts\Activate.ps1
# macOS/Linux:         source .venv/bin/activate
pip install -r requirements.txt

python -m app          # binds 127.0.0.1:5000  → open http://127.0.0.1:5000/docs
```

Core deps are just `fastapi`, `uvicorn[standard]`, `python-multipart`, `python-dotenv`, `pydantic>=2`, and `httpx` — that's all it takes to boot and pass the smoke test on the fallback path.

### Turning on the real pipeline

Each real integration is optional and independent. Install what you want and it flips on automatically (watch `GET /api/health`):

```bash
# Real transcription, Minds agent, and YouTube publish/stats:
pip install -r requirements-optional.txt

# ffmpeg + ffprobe must be on PATH for real duration probing, clip cutting,
# and Whisper audio decoding — install the binaries separately, e.g.:
winget install Gyan.FFmpeg        # Windows
# brew install ffmpeg             # macOS
```

| Capability | Real when… | Otherwise |
|---|---|---|
| `ffmpeg` / `ffprobe` | the binaries are on `PATH` | duration → `184s` fallback; render keeps the source |
| `whisper` | `faster-whisper` installed **and** ffmpeg present | no transcript → positional beats |
| `minds` | `minds-sdk` installed **and** `MINDS_BUILDER_API_KEY` set | ported deterministic captions/chat/review |
| `youtube` | `google-api-python-client` installed **and** OAuth env set | simulated `postUrl` + simulated stats |

### Configuration

Copy `backend/.env.example` to `backend/.env` (gitignored) and fill in only what you need:

| Variable | Purpose | Default |
|---|---|---|
| `MINDS_BUILDER_API_KEY` | Minds (MindsDB) agent key — get it at [mdb.ai](https://mdb.ai) | — |
| `MINDS_ID` | Minds agent/mind id to use | — |
| `MINDS_BASE_URL` | Custom Minds server | Minds Cloud |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` / `YOUTUBE_REFRESH_TOKEN` | YouTube Data API OAuth | — |
| `WHISPER_MODEL` | faster-whisper model size | `base` |
| `UPLOAD_DIR` / `DATA_DIR` | Storage locations | `../uploads`, `../data` |
| `HOST` / `PORT` | Bind address for `python -m app` | `127.0.0.1` / `5000` |
| `CORS_ORIGINS` | Allowed front-end origins (comma-separated) | `http://localhost:3000,http://localhost:3001` |

No secrets are committed — only `.env.example`.

### The contract

Responses are **camelCase** and match `frontend/src/types/index.ts` exactly, so wiring the UI to the backend is a drop-in:

```ts
Video     { id, name, duration, createdAt }
Moment    { id, videoId, start, end, label, reason, status: "pending"|"accepted"|"rejected" }
Clip      { id, momentId, videoId, title, caption, hashtags[], tags[], start, end,
            posted, postUrl?, postId?, frozen? }
PostCheck { postId, clipId, views, median, verdict: "hit"|"mid"|"flop", note, recutHook? }
Message   { id, role: "mind"|"you", text, createdAt }
```

### Testing

```bash
cd backend
python -m app.scripts.smoke     # in-process walk of the whole pipeline
```

The smoke test drives upload → moments → decide → clips → publish → check → chat against an isolated temp dir, asserting the camelCase contract at every hop — **39/39** on the deterministic fallback path (no ffmpeg, no keys).

The real path is verified too: a genuine H.264+AAC upload runs through real `ffprobe` duration, real `faster-whisper` transcription, transcript-driven moments timed to actual speech, and a real `ffmpeg` clip cut on disk (ffprobe-confirmed length) — with only publish/check simulated when YouTube is off.

---

## Tech stack

**Frontend** — Next.js 15 · React 19 · TypeScript 5 · Tailwind CSS v4 · GSAP · Motion/Framer Motion · lucide-react · Radix Slot + CVA (shadcn-style)

**Backend** — Python · FastAPI · Pydantic v2 · Uvicorn · faster-whisper (CTranslate2) · ffmpeg/ffprobe · Minds (MindsDB) SDK · YouTube Data API

---

## Status & roadmap

- [x] Full frontend UI (landing, auth, cut-room editor, analytics, history, profile, settings) on mock data
- [x] Full backend pipeline, capability-gated with a deterministic fallback
- [x] Verified: 39/39 smoke test + real ffmpeg/Whisper end-to-end run
- [x] Wire `frontend/src/api/client.ts` to the live backend (shapes already match)
- [ ] Supply Minds + YouTube credentials to light up the agent and real publishing

---

## License

See [LICENSE](LICENSE).
