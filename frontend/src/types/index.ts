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


