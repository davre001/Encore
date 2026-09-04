import type {
  AnalyticsData,
  Clip,
  Decision,
  Message,
  MindMemory,
  MindTransport,
  Moment,
  PlaybookRow,
  PostCheck,
  ProjectState,
  User,
  Video,
} from "../types";

const API = "/api";
/** Direct backend origin for large uploads — Next's proxy buffers only 10MB. */
const BACKEND =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:5000";

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `API Error ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`
    );
  }
  return res.json();
}

/** Upload a video file to kick off duration probe + background moment detection. */
export async function uploadVideo(file: File): Promise<Video> {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${BACKEND}/api/videos`, {
    method: "POST",
    body: form,
  });
  return handleResponse<Video>(res);
}

/** Retrieve video metadata by id. */
export async function getVideo(videoId: string): Promise<Video> {
  const res = await fetch(`${API}/videos/${encodeURIComponent(videoId)}`);
  return handleResponse<Video>(res);
}

/** Same-origin URL for the original take file — used to resume playback. */
export function videoFileUrl(videoId: string): string {
  return `${API}/videos/${encodeURIComponent(videoId)}/file`;
}

/** List proposed moments for a video (returns [] until background detection completes). */
export async function listMoments(videoId: string): Promise<Moment[]> {
  const res = await fetch(`${API}/moments/${encodeURIComponent(videoId)}`);
  return handleResponse<Moment[]>(res);
}

/** Accept or reject a moment. If accepted, the backend automatically generates a Clip. */
export async function decideMoment(
  momentId: string,
  decision: Decision
): Promise<Moment> {
  const res = await fetch(
    `${API}/moments/${encodeURIComponent(momentId)}/decide`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    }
  );
  return handleResponse<Moment>(res);
}

/** List generated clips for a video. */
export async function listClips(videoId: string): Promise<Clip[]> {
  const res = await fetch(`${API}/clips/${encodeURIComponent(videoId)}`);
  return handleResponse<Clip[]>(res);
}

/** Re-render a clip on disk with ffmpeg. */
export async function renderClip(clipId: string): Promise<Clip> {
  const res = await fetch(
    `${API}/clips/${encodeURIComponent(clipId)}/render`,
    { method: "POST" }
  );
  return handleResponse<Clip>(res);
}

/** Create a clip from an arbitrary range of the take (manual editing tools). */
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
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return handleResponse<Clip>(res);
}

/** Publish a clip to YouTube (simulated or real). */
export async function postClip(
  clipId: string
): Promise<{ postId: string; postUrl: string }> {
  const res = await fetch(`${API}/posts/${encodeURIComponent(clipId)}`, {
    method: "POST",
  });
  return handleResponse<{ postId: string; postUrl: string }>(res);
}

/** Check view count and verdict for a published post. */
export async function checkPost(postId: string): Promise<PostCheck> {
  const res = await fetch(
    `${API}/posts/${encodeURIComponent(postId)}/check`
  );
  return handleResponse<PostCheck>(res);
}

/** List all notebook messages for a video. */
export async function listMessages(videoId: string): Promise<Message[]> {
  const res = await fetch(`${API}/messages/${encodeURIComponent(videoId)}`);
  return handleResponse<Message[]>(res);
}
export const getMessages = listMessages;

/** Send a chat message to the Mind and receive its reply.
 *
 * A wired Mind answers asynchronously, so the response can be a `pending`
 * placeholder — follow it with `waitForMindReply` to pick up the real answer.
 */
export async function sendMessage(
  videoId: string,
  text: string
): Promise<Message> {
  const res = await fetch(`${API}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoId, text }),
  });
  return handleResponse<Message>(res);
}

/** Poll notebook history until the Mind's reply lands, or give up (null).
 *
 * `since` is the placeholder's server-side createdAt, so the comparison is free
 * of client clock skew. Transient failures keep polling until the deadline.
 */
export async function waitForMindReply(
  videoId: string,
  since: number,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<Message | null> {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const intervalMs = opts.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    try {
      const history = await listMessages(videoId);
      const replies = history.filter(
        (m) => m.role === "mind" && m.createdAt >= since
      );
      if (replies.length > 0) return replies[replies.length - 1];
    } catch {
      // Keep polling — a dropped request should not end the wait.
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
      youtube: boolean;
    };
  }>(res);
}

/** Register a new user with email and password. */
export async function signUp(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<User> {
  const res = await fetch(`${API}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<User>(res);
}

/** Authenticate with email and password. */
export async function signInWithCredentials(input: {
  email: string;
  password: string;
}): Promise<User> {
  const res = await fetch(`${API}/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<User>(res);
}

/** Sync Google OAuth profile with backend database. */
export async function syncGoogleUser(input: {
  email: string;
  name?: string;
  picture?: string;
  sub?: string;
}): Promise<User> {
  const res = await fetch(`${API}/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<User>(res);
}

/** Request a 6-digit password reset verification code by providing and confirming email. */
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
   PROJECTS (Auto-save, Edits, Options, and History)
   ========================================================================= */

/** Create or save a project with all take segments, clips, and effect options. */
export async function saveProject(
  input: Partial<ProjectState> & { name: string }
): Promise<ProjectState> {
  const res = await fetch(`${API}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<ProjectState>(res);
}

/** Update / auto-save an existing project. */
export async function updateProject(
  projectId: string,
  input: Partial<ProjectState>
): Promise<ProjectState> {
  const res = await fetch(`${API}/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<ProjectState>(res);
}

/** List all user projects for History, sorted by updatedAt descending. */
export async function listProjects(): Promise<ProjectState[]> {
  const res = await fetch(`${API}/projects`);
  return handleResponse<ProjectState[]>(res);
}

/** Get a single project by ID with its saved takeSegments, clips, and effects. */
export async function getProject(projectId: string): Promise<ProjectState> {
  const res = await fetch(`${API}/projects/${encodeURIComponent(projectId)}`);
  return handleResponse<ProjectState>(res);
}

/** Delete a project from history. */
export async function deleteProject(
  projectId: string
): Promise<{ message: string; status: string }> {
  const res = await fetch(`${API}/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
  });
  return handleResponse<{ message: string; status: string }>(res);
}

/* =========================================================================
   ANALYTICS & PLAYBOOK (Real creator data)
   ========================================================================= */

/** Get real creator analytics, summary, and playbook rules. */
export async function getAnalytics(): Promise<AnalyticsData> {
  const res = await fetch(`${API}/analytics`);
  return handleResponse<AnalyticsData>(res);
}

/** Get creator playbook rules. */
export async function getPlaybook(): Promise<PlaybookRow[]> {
  const res = await fetch(`${API}/analytics/playbook`);
  return handleResponse<PlaybookRow[]>(res);
}

/** Update or add a creator playbook rule. */
export async function updatePlaybookRule(rule: PlaybookRow): Promise<PlaybookRow> {
  const res = await fetch(`${API}/analytics/playbook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rule),
  });
  return handleResponse<PlaybookRow>(res);
}

/* =========================================================================
   MINDS & PERSISTENT MEMORY
   ========================================================================= */

/** Get persistent memories for creator tenets, rules, and learned preferences. */
export async function getMindMemories(category?: string): Promise<MindMemory[]> {
  const qs = category ? `?category=${encodeURIComponent(category)}` : "";
  const res = await fetch(`${API}/mind/memories${qs}`);
  return handleResponse<MindMemory[]>(res);
}

/** Add or update a standing tenet or preference in persistent memory. */
export async function addMindMemory(input: {
  category: string;
  content: string;
  key?: string;
  metadataJson?: string;
}): Promise<MindMemory> {
  const res = await fetch(`${API}/mind/memories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<MindMemory>(res);
}

/** Delete a memory from persistent storage. */
export async function deleteMindMemory(id: string): Promise<{ status: string }> {
  const res = await fetch(`${API}/mind/memories/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return handleResponse<{ status: string }>(res);
}

/** Get status of MindsDB integration and persistent memory. */
export async function getMindStatus(): Promise<{
  status: string;
  mindsAvailable: boolean;
  persistentMemoryEnabled: boolean;
  memoriesCount: number;
  /** Live Builder API diagnostics; null when no key is configured. */
  transport: MindTransport | null;
}> {
  const res = await fetch(`${API}/mind/status`);
  return handleResponse<any>(res);
}



