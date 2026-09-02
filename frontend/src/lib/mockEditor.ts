import type { Clip, Message, Moment, PostCheck, Video } from "@/types";

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

// When a picked file can't report its real length (or before it's probed), the
// timeline still needs a sane span — the verify harness uploads a stand-in that
// never decodes, so this is the floor it falls back to.
export const FALLBACK_DURATION = 184;

export function buildVideo(file: File, duration = FALLBACK_DURATION): Video {
  return {
    id: id("vid"),
    name: file.name,
    duration: duration > 0 && Number.isFinite(duration) ? duration : FALLBACK_DURATION,
    createdAt: Date.now(),
  };
}

// The three demo beats, expressed as fractions of the take so they land in the
// right place whatever the real duration is — a 30 s clip gets three short cuts,
// a 12 min take gets three long ones. Filtered so a very short take never yields
// an inverted or out-of-bounds cut.
const BEATS: { at: [number, number]; label: string; reason: string }[] = [
  {
    at: [0.1, 0.24],
    label: "Confession hook",
    reason: "Strong open. Your last two confession hooks beat tutorials.",
  },
  {
    at: [0.34, 0.5],
    label: "Talking-head tip",
    reason: "You rejected two of these last week. Skip unless you want it.",
  },
  {
    at: [0.7, 0.84],
    label: "Exam-panic rant",
    reason: "Good leftover energy. Saved well for Shorts.",
  },
];

export function buildMoments(
  videoId: string,
  duration = FALLBACK_DURATION,
): Moment[] {
  const span = duration > 0 && Number.isFinite(duration) ? duration : FALLBACK_DURATION;
  const round = (n: number) => Math.round(n * 10) / 10;
  return BEATS.map((beat) => {
    const start = round(beat.at[0] * span);
    const end = round(beat.at[1] * span);
    return {
      id: id("mom"),
      videoId,
      start,
      end,
      label: beat.label,
      reason: beat.reason,
      status: "pending" as const,
    };
  }).filter((moment) => moment.end > moment.start + 0.4 && moment.end <= span);
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
