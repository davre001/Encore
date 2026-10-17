import type {
  AnalyticsData,
  AnalysisStatus,
  AiSettings,
  AuthSession,
  CaptionJob,
  CaptionLanguage,
  CaptionTrack,
  Clip,
  Decision,
  Message,
  MindMemory,
  MindTransport,
  Moment,
  PlaybookRow,
  PostCheck,
  ProjectState,
  Video,
  YouTubeStatus,
} from "../types";

const API = "/api";
const CONFIGURED_BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "");
/** Direct backend origin for analytics and uploads that bypass the proxy hop. */
const BACKEND =
  CONFIGURED_BACKEND || "http://127.0.0.1:5000";
const UPLOAD_API = CONFIGURED_BACKEND?.startsWith("https://") ? `${BACKEND}/api` : API;

const TOKEN_KEY = "encore.accessToken";

function storedToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Auth header: protected API calls carry the signed session token. The backend
// verifies it and derives the user id from the token subject.
// ---------------------------------------------------------------------------
function userHeaders(): Record<string, string> {
  const token = storedToken();
  if (token) return { Authorization: `Bearer ${token}` };
  return {};
}

function authTokenParam(): string {
  const token = storedToken();
  return token ? `?access_token=${encodeURIComponent(token)}` : "";
}

function apiErrorDetail(text: string): string {
  if (!text) return "";
  try {
    const body = JSON.parse(text);
    const detail = body?.detail ?? body?.message ?? body?.error;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((item) => item?.msg || item?.message || JSON.stringify(item))
        .join("; ");
    }
    if (detail && typeof detail === "object") {
      return detail.message || JSON.stringify(detail);
    }
  } catch {
    /* Response was plain text/HTML. */
  }
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const detail = apiErrorDetail(text);
    const error = new Error(`API Error ${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`);
    Object.assign(error, { status: res.status });
    throw error;
  }
  return res.json();
}

export type RecoveryOptions = {
  onNotice?: (message: string | null) => void;
  shouldStop?: () => boolean;
};

/** Only use for reads or operations the server can safely deduplicate. */
export async function withNetworkRecovery<T>(
  operation: () => Promise<T>, options: RecoveryOptions = {},
): Promise<T> {
  const started = Date.now();
  let failedAt: number | null = null;
  let lastNotice: string | null = null;
  const monitor = window.setInterval(() => {
    const elapsed = Date.now() - (failedAt ?? started);
    const notice = failedAt !== null && elapsed >= 120_000
      ? "Connection error, check your network."
      : elapsed >= 60_000 ? "This is taking longer than usual." : null;
    if (notice !== lastNotice) {
      lastNotice = notice;
      options.onNotice?.(notice);
    }
  }, 1000);
  try {
    for (;;) {
      if (options.shouldStop?.()) throw new DOMException("Stopped by user.", "AbortError");
      try {
        const result = await operation();
        return result;
      } catch (error) {
        const status = (error as { status?: number })?.status;
        const retryable = error instanceof TypeError ||
          (error instanceof Error && /timed out|timeout|networkerror|failed to fetch/i.test(error.message)) ||
          status === 502 || status === 503 || status === 504 || status === 408;
        if (!retryable) throw error;
        if (failedAt === null) failedAt = Date.now();
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
      }
    }
  } finally {
    window.clearInterval(monitor);
    if (lastNotice !== null) options.onNotice?.(null);
  }
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Upload timed out. Check your connection and try again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

/** Upload a video file to kick off duration probe + background moment detection. */
export async function uploadVideo(
  file: File,
  onProgress?: (progress: number, message: string) => void,
  recovery: RecoveryOptions = {},
): Promise<Video> {
  const filename = file.name || "take.mp4";
  const connection = (navigator as Navigator & { connection?: { downlink?: number } }).connection;
  const slowConnection = (connection?.downlink ?? 10) < 2;
  const chunkSize = (slowConnection ? 512 : (connection?.downlink ?? 3) >= 5 ? 4096 : 1024) * 1024;
  const qs = new URLSearchParams({ filename });
  const startQs = new URLSearchParams({ filename, size: String(file.size), chunk_size: String(chunkSize) });
  onProgress?.(9, "Starting upload.");
  const { uploadId, parallelChunks } = await withNetworkRecovery(async () => {
    const start = await fetchWithTimeout(
    `${UPLOAD_API}/videos/chunked/start?${startQs.toString()}`,
    {
      method: "POST",
      headers: userHeaders(),
    },
    30_000,
    );
    return handleResponse<{ uploadId: string; parallelChunks?: boolean }>(start);
  }, recovery);

  let nextIndex = 0;
  let uploaded = 0;
  let failed = false;
  const chunkNotices = new Map<number, string>();
  const chunkCount = Math.ceil(file.size / chunkSize);
  async function sendChunk(index: number) {
    const offset = index * chunkSize;
    const chunk = file.slice(offset, Math.min(offset + chunkSize, file.size));
    for (let attempt = 0; ; attempt += 1) {
      try {
        const res = await fetchWithTimeout(
          `${UPLOAD_API}/videos/chunked/${encodeURIComponent(uploadId)}/chunk?index=${index}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/octet-stream",
              ...userHeaders(),
            },
            body: chunk,
          },
          120_000,
        );
        if (!res.ok) {
          if (parallelChunks && attempt < 2 && (res.status === 429 || res.status >= 500)) {
            await new Promise((resolve) => window.setTimeout(resolve, 500 * (attempt + 1)));
            continue;
          }
          await handleResponse(res);
        }
        break;
      } catch (error) {
        // Indexed chunks are safe to retry; legacy append-only uploads are not.
        if (!parallelChunks || attempt >= 2 || !(error instanceof TypeError || (error instanceof Error && error.message.startsWith("Upload timed out")))) {
          throw error;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    uploaded += chunk.size;
    const percent = file.size > 0 ? uploaded / file.size : 1;
    onProgress?.(
      Math.round(10 + percent * 8),
      `Uploading video (${Math.round(percent * 100)}%).`,
    );
  }
  async function worker() {
    while (!failed && nextIndex < chunkCount) {
      const index = nextIndex++;
      try {
        if (parallelChunks) await withNetworkRecovery(() => sendChunk(index), {
          ...recovery,
          onNotice: (notice) => {
            if (notice) chunkNotices.set(index, notice);
            else chunkNotices.delete(index);
            const notices = [...chunkNotices.values()];
            recovery.onNotice?.(notices.find((message) => message.startsWith("Connection error")) ?? notices[0] ?? null);
          },
        });
        else await sendChunk(index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(parallelChunks ? (slowConnection ? 2 : 3) : 1, chunkCount) }, () => worker()),
  );
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
  }

  onProgress?.(19, "Finishing upload.");
  return withNetworkRecovery(async () => {
    const finish = await fetchWithTimeout(
      `${UPLOAD_API}/videos/chunked/${encodeURIComponent(uploadId)}/finish?${qs.toString()}`,
      { method: "POST", headers: userHeaders() },
      120_000,
    );
    return handleResponse<Video>(finish);
  }, recovery);
}

/** Retrieve video metadata by id. */
export async function getVideo(videoId: string, recovery?: RecoveryOptions): Promise<Video> {
  const read = async () => {
    const res = await fetchWithTimeout(`${API}/videos/${encodeURIComponent(videoId)}`, {
      headers: userHeaders(),
    }, 30_000);
    return handleResponse<Video>(res);
  };
  return recovery ? withNetworkRecovery(read, recovery) : read();
}

/** Same-origin URL for the original take file — used to resume playback. */
export function videoFileUrl(videoId: string): string {
  return `${API}/videos/${encodeURIComponent(videoId)}/file${authTokenParam()}`;
}

/** Download URL for a rendered clip file. */
export function clipFileUrl(clipId: string): string {
  return `${API}/clips/${encodeURIComponent(clipId)}/file${authTokenParam()}`;
}

/** List proposed moments for a video. */
export async function listMoments(videoId: string, recovery?: RecoveryOptions): Promise<Moment[]> {
  const read = async () => {
    const res = await fetchWithTimeout(`${API}/moments/${encodeURIComponent(videoId)}`, {
      headers: userHeaders(),
    }, 30_000);
    return handleResponse<Moment[]>(res);
  };
  return recovery ? withNetworkRecovery(read, recovery) : read();
}

/** Current AI analysis stage for a video's moment detection job. */
export async function getAnalysisStatus(videoId: string, recovery?: RecoveryOptions): Promise<AnalysisStatus> {
  const read = async () => {
    const res = await fetchWithTimeout(`${API}/videos/${encodeURIComponent(videoId)}/analysis`, {
      headers: userHeaders(),
    }, 30_000);
    return handleResponse<AnalysisStatus>(res);
  };
  return recovery ? withNetworkRecovery(read, recovery) : read();
}

/** Persisted creator-level AI permission mode. */
export async function getAiSettings(): Promise<AiSettings> {
  const res = await fetch(`${API}/settings/ai`, {
    headers: userHeaders(),
  });
  return handleResponse<AiSettings>(res);
}

export async function updateAiSettings(
  aiPermissionMode: AiSettings["aiPermissionMode"]
): Promise<AiSettings> {
  const res = await fetch(`${API}/settings/ai`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...userHeaders() },
    body: JSON.stringify({ aiPermissionMode }),
  });
  return handleResponse<AiSettings>(res);
}

/** Clear proposed moments and rerun AI analysis for an existing upload. */
export async function retryAnalysis(videoId: string): Promise<AnalysisStatus> {
  const res = await fetch(
    `${API}/videos/${encodeURIComponent(videoId)}/analysis/retry`,
    {
      method: "POST",
      headers: userHeaders(),
    }
  );
  return handleResponse<AnalysisStatus>(res);
}

/** Accept or reject a moment. */
export async function decideMoment(
  momentId: string,
  decision: Decision
): Promise<Moment> {
  const res = await fetch(
    `${API}/moments/${encodeURIComponent(momentId)}/decide`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...userHeaders() },
      body: JSON.stringify({ decision }),
    }
  );
  return handleResponse<Moment>(res);
}

/** List generated clips for a video. */
export async function listClips(videoId: string, recovery?: RecoveryOptions): Promise<Clip[]> {
  const read = async () => {
    const res = await fetchWithTimeout(`${API}/clips/${encodeURIComponent(videoId)}`, {
      headers: userHeaders(),
    }, 30_000);
    return handleResponse<Clip[]>(res);
  };
  return recovery ? withNetworkRecovery(read, recovery) : read();
}

/** Regenerate one cut's title, description, hashtags, and tags. */
export async function rewriteClip(
  clipId: string,
  source?: { label?: string; reason?: string }
): Promise<Clip> {
  const res = await fetch(`${API}/clips/${encodeURIComponent(clipId)}/rewrite`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...userHeaders() },
    body: JSON.stringify(source ?? {}),
  });
  return handleResponse<Clip>(res);
}

/** Re-render a clip on disk with ffmpeg. */
export async function renderClip(
  clipId: string,
  captionTrack?: CaptionTrack | null
): Promise<Clip> {
  const res = await fetch(
    `${API}/clips/${encodeURIComponent(clipId)}/render`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...userHeaders() },
      body: JSON.stringify({ captionTrack: captionTrack ?? null }),
    }
  );
  return handleResponse<Clip>(res);
}

/** Create a clip from an arbitrary range of the take. */
export async function createClip(input: {
  videoId: string;
  start: number;
  end: number;
  title?: string;
  caption?: string;
  hashtags?: string[];
  tags?: string[];
  momentId?: string;
  label?: string;
}): Promise<Clip> {
  const res = await fetch(`${API}/clips`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...userHeaders() },
    body: JSON.stringify(input),
  });
  return handleResponse<Clip>(res);
}

/** Persist edits (caption/title/tags/trim) to an unposted clip. */
export async function updateClip(
  clipId: string,
  patch: Partial<
    Pick<Clip, "title" | "caption" | "hashtags" | "tags" | "start" | "end">
  >
): Promise<Clip> {
  const res = await fetch(`${API}/clips/${encodeURIComponent(clipId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...userHeaders() },
    body: JSON.stringify(patch),
  });
  return handleResponse<Clip>(res);
}

/** Remove one hashtag from a draft clip and persist the choice. */
export async function removeClipHashtag(
  clipId: string,
  hashtag: string
): Promise<Clip> {
  const res = await fetch(
    `${API}/clips/${encodeURIComponent(clipId)}/hashtags/${encodeURIComponent(hashtag)}`,
    { method: "DELETE", headers: userHeaders() }
  );
  return handleResponse<Clip>(res);
}

/** Start generating timed on-video captions for a clip.
 *
 * Returns the job, not the captions: reading the take through whisper is far
 * too slow to hold a request open for with nothing on screen, so the caller
 * polls `getCaptionJob` and shows the progress it reports. */
export async function generateCaptionTrack(input: {
  clipId: string;
  videoId?: string;
  title: string;
  caption: string;
  start: number;
  end: number;
  language: CaptionLanguage;
  /** The frame the captions are drawn into, so cues are budgeted to fit it. */
  aspect: string;
}): Promise<CaptionJob> {
  const res = await fetch(`${API}/captions/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...userHeaders() },
    body: JSON.stringify(input),
  });
  return handleResponse<CaptionJob>(res);
}

/** Where a clip's caption run has got to. */
export async function getCaptionJob(clipId: string): Promise<CaptionJob> {
  const res = await fetch(
    `${API}/captions/${encodeURIComponent(clipId)}/job`,
    { headers: userHeaders() }
  );
  return handleResponse<CaptionJob>(res);
}

/** Publish a clip to YouTube. */
export async function postClip(
  clipId: string,
  recovery: RecoveryOptions = {},
  onProgress?: (job: { message: string; progress?: number }) => void,
): Promise<{ postId: string; postUrl: string }> {
  type PublishJob = { done: boolean; stage: string; message: string; progress?: number; postId?: string; postUrl?: string };
  const url = `${API}/posts/${encodeURIComponent(clipId)}/job`;
  const read = async (method: string) => handleResponse<PublishJob>(await fetchWithTimeout(url, {
    method, headers: userHeaders(),
  }, 30_000));
  let job = await withNetworkRecovery(() => read("POST"), recovery);
  const started = Date.now();
  while (!job.done) {
    onProgress?.(job);
    if (job.stage === "reconnecting") recovery.onNotice?.(job.message);
    else if (Date.now() - started >= 60_000) recovery.onNotice?.("This is taking longer than usual.");
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
    job = await withNetworkRecovery(() => read("GET"), recovery);
  }
  recovery.onNotice?.(null);
  if (job.stage !== "complete" || !job.postId || !job.postUrl) throw new Error(job.message || "YouTube publishing failed.");
  return { postId: job.postId, postUrl: job.postUrl };
}

export async function waitForMedia(url: string, recovery: RecoveryOptions): Promise<void> {
  return withNetworkRecovery(async () => {
    const response = await fetchWithTimeout(url, { headers: { Range: "bytes=0-0" } }, 30_000);
    if (!response.ok) {
      if (response.status === 404 || response.status === 410) throw new Error("The source video is no longer available. Upload it again.");
      await handleResponse(response);
    }
    await response.body?.cancel();
  }, recovery);
}

export async function stopPublishJob(clipId: string, recovery: RecoveryOptions) {
  type Job = {
    stage: string; done: boolean; postId?: string; postUrl?: string;
  };
  const url = `${API}/posts/${encodeURIComponent(clipId)}/job`;
  let job = await withNetworkRecovery(async () => handleResponse<Job>(await fetchWithTimeout(`${url}/cancel`, {
    method: "POST", headers: userHeaders(),
  }, 30_000)), recovery);
  while (!job.done) {
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
    job = await withNetworkRecovery(async () => handleResponse<Job>(await fetchWithTimeout(url, {
      headers: userHeaders(),
    }, 30_000)), recovery);
  }
  return job;
}

/** Check view count and verdict for a published post. */
export async function checkPost(postId: string): Promise<PostCheck> {
  const res = await fetchWithTimeout(
    `${BACKEND}/api/posts/${encodeURIComponent(postId)}/check`,
    { headers: userHeaders() }, 30_000,
  );
  return handleResponse<PostCheck>(res);
}

export async function getYouTubeStatus(): Promise<YouTubeStatus> {
  const res = await fetch(`${API}/youtube/status`, {
    headers: userHeaders(),
  });
  return handleResponse<YouTubeStatus>(res);
}

export async function connectYouTube(): Promise<{ authUrl: string }> {
  const res = await fetch(`${API}/youtube/connect`, {
    method: "POST",
    headers: userHeaders(),
  });
  return handleResponse<{ authUrl: string }>(res);
}

export async function disconnectYouTube(): Promise<YouTubeStatus> {
  const res = await fetch(`${API}/youtube/disconnect`, {
    method: "DELETE",
    headers: userHeaders(),
  });
  return handleResponse<YouTubeStatus>(res);
}

/** List one project's chat thread. */
export async function listMessages(threadId: string): Promise<Message[]> {
  const res = await fetch(`${API}/messages/${encodeURIComponent(threadId)}`, {
    headers: userHeaders(),
  });
  return handleResponse<Message[]>(res);
}
export const getMessages = listMessages;

/** Send a chat message through the same-origin API rewrite.
 *
 * This keeps production chat requests out of the browser's CORS path. Both the
 * Next development proxy and Vercel rewrite forward /api to the backend, and
 * the development proxy timeout is raised in next.config.ts for slow replies.
 */
export async function sendMessage(
  threadId: string,
  text: string
): Promise<Message> {
  const res = await fetch(`${API}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...userHeaders() },
    body: JSON.stringify({ threadId, text }),
  });
  return handleResponse<Message>(res);
}

/** Persist an editor event into the project's chat/memory thread. */
export async function saveEditorEvent(
  threadId: string,
  text: string,
  role: "mind" | "you" = "mind"
): Promise<Message> {
  const res = await fetch(`${API}/messages/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...userHeaders() },
    body: JSON.stringify({ threadId, text, role }),
  });
  return handleResponse<Message>(res);
}

/** Poll a project thread until the Mind's reply lands, or give up (null). */
export async function waitForMindReply(
  threadId: string,
  since: number,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<Message | null> {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const intervalMs = opts.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    try {
      const history = await listMessages(threadId);
      const replies = history.filter(
        (m) => m.role === "mind" && m.createdAt >= since
      );
      if (replies.length > 0) return replies[replies.length - 1];
    } catch {
      // Keep polling
    }
  }
  return null;
}

/** Check backend health and capabilities. */
export async function getHealth(): Promise<{
  status: string;
  capabilities: {
    ffmpeg: boolean;
    ffprobe: boolean;
    whisper: boolean;
    minds: boolean;
    gemini: boolean;
    youtube: boolean;
  };
}> {
  const res = await fetch(`${API}/health`);
  return handleResponse<{
    status: string;
    capabilities: {
      ffmpeg: boolean;
      ffprobe: boolean;
      whisper: boolean;
      minds: boolean;
      gemini: boolean;
      youtube: boolean;
    };
  }>(res);
}

/** Register a new user with email and password. */
export async function signUp(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<AuthSession> {
  const res = await fetch(`${API}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<AuthSession>(res);
}

/** Authenticate with email and password. */
export async function signInWithCredentials(input: {
  email: string;
  password: string;
}): Promise<AuthSession> {
  const res = await fetch(`${API}/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<AuthSession>(res);
}

/** Sync Google OAuth profile with backend database. */
export async function syncGoogleUser(input: {
  email: string;
  name?: string;
  picture?: string;
  sub?: string;
}): Promise<AuthSession> {
  const res = await fetch(`${API}/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<AuthSession>(res);
}

/** Request a 6-digit password reset verification code. */
export async function forgotPassword(input: {
  email: string;
  confirmEmail: string;
}): Promise<{ message: string; status: string }> {
  const res = await fetch(`${API}/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<{ message: string; status: string }>(res);
}

/** Reset password using the 6-digit verification code. */
export async function resetPassword(input: {
  email: string;
  code: string;
  newPassword: string;
}): Promise<{ message: string; status: string }> {
  const res = await fetch(`${API}/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<{ message: string; status: string }>(res);
}

/* =========================================================================
   PROJECTS
   ========================================================================= */

export async function saveProject(
  input: Partial<ProjectState> & { name: string }
): Promise<ProjectState> {
  const res = await fetch(`${API}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...userHeaders() },
    body: JSON.stringify(input),
  });
  return handleResponse<ProjectState>(res);
}

export async function updateProject(
  projectId: string,
  input: Partial<ProjectState>
): Promise<ProjectState> {
  const res = await fetch(`${API}/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...userHeaders() },
    body: JSON.stringify(input),
  });
  return handleResponse<ProjectState>(res);
}

export async function listProjects(): Promise<ProjectState[]> {
  const res = await fetch(`${API}/projects`, { headers: userHeaders() });
  return handleResponse<ProjectState[]>(res);
}

export async function getProject(projectId: string, recovery?: RecoveryOptions): Promise<ProjectState> {
  const read = async () => {
    const res = await fetchWithTimeout(`${API}/projects/${encodeURIComponent(projectId)}`, {
      headers: userHeaders(),
    }, 30_000);
    return handleResponse<ProjectState>(res);
  };
  return recovery ? withNetworkRecovery(read, recovery) : read();
}

export async function deleteProject(
  projectId: string
): Promise<{ message: string; status: string }> {
  const res = await fetch(`${API}/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
    headers: userHeaders(),
  });
  return handleResponse<{ message: string; status: string }>(res);
}

/* =========================================================================
   ANALYTICS & PLAYBOOK
   ========================================================================= */

export async function getAnalytics(): Promise<AnalyticsData> {
  const res = await fetch(`${API}/analytics`, { headers: userHeaders() });
  return handleResponse<AnalyticsData>(res);
}

export async function getPlaybook(): Promise<PlaybookRow[]> {
  const res = await fetch(`${API}/analytics/playbook`, {
    headers: userHeaders(),
  });
  return handleResponse<PlaybookRow[]>(res);
}

export async function updatePlaybookRule(rule: PlaybookRow): Promise<PlaybookRow> {
  const res = await fetch(`${API}/analytics/playbook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...userHeaders() },
    body: JSON.stringify(rule),
  });
  return handleResponse<PlaybookRow>(res);
}

/* =========================================================================
   MINDS & PERSISTENT MEMORY
   ========================================================================= */

export async function getMindMemories(category?: string): Promise<MindMemory[]> {
  const qs = category ? `?category=${encodeURIComponent(category)}` : "";
  const res = await fetch(`${API}/mind/memories${qs}`, {
    headers: userHeaders(),
  });
  return handleResponse<MindMemory[]>(res);
}

export async function addMindMemory(input: {
  category: string;
  content: string;
  key?: string;
  metadataJson?: string;
}): Promise<MindMemory> {
  const res = await fetch(`${API}/mind/memories`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...userHeaders() },
    body: JSON.stringify(input),
  });
  return handleResponse<MindMemory>(res);
}

export async function deleteMindMemory(id: string): Promise<{ status: string }> {
  const res = await fetch(`${API}/mind/memories/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: userHeaders(),
  });
  return handleResponse<{ status: string }>(res);
}

export async function getMindStatus(): Promise<{
  status: string;
  mindsAvailable: boolean;
  persistentMemoryEnabled: boolean;
  memoriesCount: number;
  transport: MindTransport | null;
}> {
  const res = await fetch(`${API}/mind/status`, { headers: userHeaders() });
  return handleResponse<any>(res);
}
