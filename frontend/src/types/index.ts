export type Decision = "accept" | "reject";

export type User = {
  id: string;
  name: string;
  email: string;
  picture?: string;
  handle?: string;
  niche?: string;
  bio?: string;
};

export type AuthSession = {
  user: User;
  accessToken: string;
  tokenType: "bearer";
};

export type MomentStatus = "pending" | "accepted" | "rejected";

export type Moment = {
  id: string;
  videoId: string;
  start: number;
  end: number;
  label: string;
  reason: string;
  status: MomentStatus;
  /** Standalone strength 0-100 from the detector; moments arrive best-first. */
  score: number;
};

export type AnalysisStatus = {
  videoId: string;
  stage:
    | "queued"
    | "uploaded"
    | "thinking"
    | "transcribing"
    | "watching"
    | "generating"
    | "complete"
    | "empty"
    | "error";
  message: string;
  updatedAt: number;
  errorType?: "network" | "timeout" | "quota" | "api" | "unknown" | null;
  done: boolean;
};

export type AiSettings = {
  userId?: string | null;
  aiPermissionMode: "auto" | "ask";
  updatedAt: number;
};

export type YouTubeStatus = {
  connected: boolean;
  oauthReady: boolean;
  channelId?: string | null;
  channelTitle?: string | null;
  channelUrl?: string | null;
  updatedAt?: number | null;
};

export type Clip = {
  id: string;
  momentId: string;
  videoId: string;
  title: string;
  caption: string;
  hashtags: string[];
  tags: string[];
  start: number;
  end: number;
  posted: boolean;
  postUrl?: string;
  postId?: string;
  /** Held on its last frame — a freeze from the clip context menu. */
  frozen?: boolean;
};

export type PostCheck = {
  postId: string;
  clipId: string;
  views: number;
  median: number;
  /**
   * "pending" means the post is too young to grade — YouTube needs hours before
   * a view count means anything. It is a check state, never a stored verdict.
   */
  verdict: "hit" | "mid" | "flop" | "pending";
  note: string;
  recutHook?: string;
};

export type Message = {
  id: string;
  role: "mind" | "you";
  text: string;
  createdAt: number;
  /**
   * Placeholder returned while a live Mind composes its answer. Minds by
   * Animoca Brands replies asynchronously, so the real reply arrives in history
   * later — poll `waitForMindReply` and swap this row out.
   */
  pending?: boolean;
};

/** Live wiring state of the Minds (Animoca Builder API) transport. */
export type MindTransport = {
  baseUrl: string;
  keyConfigured: boolean;
  humanId: boolean;
  alias: string;
  mindId: string | null;
  reachable: boolean;
  mindsCount: number;
  error: string | null;
};

export type Video = {
  id: string;
  name: string;
  duration: number;
  createdAt: number;
};

export type TakeSegment = {
  id: string;
  title: string;
  start: number;
  end: number;
  sourceStart?: number;
  sourceEnd?: number;
};

export type CaptionLanguage =
  | "en"
  | "fr"
  | "es"
  | "pt"
  | "de"
  | "it"
  | "ar"
  | "hi";

export type CaptionSegment = {
  id: string;
  start: number;
  end: number;
  text: string;
};

export type CaptionTrack = {
  id: string;
  clipId: string;
  language: CaptionLanguage;
  fontFamily: string;
  fontSource?: string;
  segments: CaptionSegment[];
};

export type ProjectEffects = {
  rotate: number;
  flip: boolean;
  aspect: string;
  aiOn?: boolean;
  aiPermissionMode?: "auto" | "ask";
  compareOn?: boolean;
  captionTracks?: CaptionTrack[];
};

export type ProjectState = {
  id: string;
  name: string;
  videoId?: string | null;
  mediaUrl?: string | null;
  status: "draft" | "posted" | "checked";
  /** Post outcome, persisted once a cut is published & checked. */
  verdict?: "hit" | "mid" | "flop";
  views?: number;
  postUrl?: string;
  postId?: string;
  /** Timeline seconds the playhead was on when the project last saved. */
  playhead?: number;
  takeIn: number;
  takeOut: number;
  takeSegments: TakeSegment[];
  clips: Clip[];
  effects: ProjectEffects;
  createdAt: number;
  updatedAt: number;
};

export type MindMemory = {
  id: string;
  userId?: string | null;
  category: string;
  key?: string | null;
  content: string;
  metadataJson?: string;
  createdAt: number;
  updatedAt: number;
};

export type PlaybookRow = {
  id?: string;
  style: string;
  sample: number;
  hitRate: number;
  note: string;
  locked?: boolean;
};

export type AnalyticsPostItem = {
  id: string;
  day: string;
  title: string;
  hook: string;
  views: number;
  verdict: "hit" | "mid" | "flop";
  url?: string | null;
};

export type AnalyticsSummary = {
  posts: number;
  totalViews: number;
  median: number;
  hitRate: number;
  hits: number;
  flops: number;
  mids: number;
};

export type AnalyticsData = {
  posts: AnalyticsPostItem[];
  summary: AnalyticsSummary;
  playbook: PlaybookRow[];
};
