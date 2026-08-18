import type { Clip, Message, Moment, PostCheck, Video } from "@/types";

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function buildVideo(file: File): Video {
  return {
    id: id("vid"),
    name: file.name,
    duration: 184,
    createdAt: Date.now(),
  };
}

export function buildMoments(videoId: string): Moment[] {
  return [
    {
      id: id("mom"),
      videoId,
      start: 18,
      end: 41,
      label: "Confession hook",
      reason: "Strong open. Your last two confession hooks beat tutorials.",
      status: "pending",
    },
    {
      id: id("mom"),
      videoId,
      start: 62,
      end: 88,
      label: "Talking-head tip",
      reason: "You rejected two of these last week. Skip unless you want it.",
      status: "pending",
    },
    {
      id: id("mom"),
      videoId,
      start: 130,
      end: 151,
      label: "Exam-panic rant",
      reason: "Good leftover energy. Saved well for Shorts.",
      status: "pending",
    },
  ];
}

export function buildClipFromMoment(moment: Moment, videoId: string): Clip {
  const hooks: Record<string, string> = {
    "Confession hook": "I failed the exam on purpose.",
    "Talking-head tip": "Three things that fixed my study week.",
    "Exam-panic rant": "Nobody talks about the 2 a.m. spiral.",
  };
  const title = hooks[moment.label] ?? moment.label;
  return {
    id: id("clip"),
    momentId: moment.id,
    videoId,
    title,
    caption: `${title}\n\nLong video → short cut. Encore kept the beat.`,
    hashtags: ["#studyvlog", "#encore", "#creator", "#shorts"],
    tags: ["study", "creator"],
    start: moment.start,
    end: moment.end,
    posted: false,
  };
}

export function mindMessage(text: string): Message {
  return {
    id: id("msg"),
    role: "mind",
    text,
    createdAt: Date.now(),
  };
}

export function youMessage(text: string): Message {
  return {
    id: id("msg"),
    role: "you",
    text,
    createdAt: Date.now(),
  };
}

export function buildPostCheck(clip: Clip): PostCheck {
  const views = clip.title.toLowerCase().includes("failed") ? 12400 : 410;
  const median = 4100;
  const verdict: PostCheck["verdict"] =
    views >= median * 2 ? "hit" : views < median * 0.4 ? "flop" : "mid";

  return {
    postId: clip.postId ?? id("post"),
    clipId: clip.id,
    views,
    median,
    verdict,
    note:
      verdict === "hit"
        ? "3× your median. Keep this hook style."
        : verdict === "flop"
          ? "Buried. New hook ready from the same moment."
          : "Mid pack. Leave it and ship a leftover tomorrow.",
    recutHook:
      verdict === "flop"
        ? "Story-first open: “Nobody talks about the 2 a.m. spiral.”"
        : undefined,
  };
}
