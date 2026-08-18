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
