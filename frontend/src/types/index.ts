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

export type MomentStatus = "pending" | "accepted" | "rejected";

export type Moment = {
  id: string;
  videoId: string;
  start: number;
  end: number;
  label: string;
  reason: string;
  status: MomentStatus;
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
  verdict: "hit" | "mid" | "flop";
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

export type ProjectEffects = {
  rotate: number;
  flip: boolean;
  aspect: string;
  aiOn?: boolean;
  compareOn?: boolean;
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


