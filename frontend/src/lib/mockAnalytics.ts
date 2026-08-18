export type AnalyticsPost = {
  id: string;
  title: string;
  hook: string;
  views: number;
  median: number;
  verdict: "hit" | "mid" | "flop";
  day: string;
  url: string;
};

export type PlaybookRow = {
  style: string;
  sample: number;
  hitRate: number;
  note: string;
};

export type Leftover = {
  id: string;
  label: string;
  from: string;
  range: string;
};

export type DayPoint = {
  day: string;
  views: number;
};

export const ANALYTICS_MEDIAN = 4100;

export const analyticsPosts: AnalyticsPost[] = [
  {
    id: "p1",
    title: "I failed the exam on purpose.",
    hook: "Confession",
    views: 12400,
    median: ANALYTICS_MEDIAN,
    verdict: "hit",
    day: "Mon",
    url: "https://youtube.com/shorts/encore-p1",
  },
  {
    id: "p2",
    title: "Three things that fixed my study week.",
    hook: "Tutorial",
    views: 980,
    median: ANALYTICS_MEDIAN,
    verdict: "flop",
    day: "Tue",
    url: "https://youtube.com/shorts/encore-p2",
  },
  {
    id: "p3",
    title: "Desk setup nobody asked for.",
    hook: "Talking-head",
    views: 2100,
    median: ANALYTICS_MEDIAN,
    verdict: "flop",
    day: "Wed",
    url: "https://youtube.com/shorts/encore-p3",
  },
  {
    id: "p4",
    title: "Nobody talks about the 2 a.m. spiral.",
    hook: "Rant",
    views: 8700,
    median: ANALYTICS_MEDIAN,
    verdict: "hit",
    day: "Thu",
    url: "https://youtube.com/shorts/encore-p4",
  },
  {
    id: "p5",
    title: "I rewrote the recap I promised Kai.",
    hook: "Story",
    views: 4300,
    median: ANALYTICS_MEDIAN,
    verdict: "mid",
    day: "Fri",
    url: "https://youtube.com/shorts/encore-p5",
  },
  {
    id: "p6",
    title: "This is the hook I already used Monday.",
    hook: "Confession",
    views: 6200,
    median: ANALYTICS_MEDIAN,
    verdict: "mid",
    day: "Sat",
    url: "https://youtube.com/shorts/encore-p6",
  },
  {
    id: "p7",
    title: "Finals are over. The leftover rant ships.",
    hook: "Rant",
    views: 15100,
    median: ANALYTICS_MEDIAN,
    verdict: "hit",
    day: "Sun",
    url: "https://youtube.com/shorts/encore-p7",
  },
];

export const playbook: PlaybookRow[] = [
  {
    style: "Confession hook",
    sample: 8,
    hitRate: 0.75,
    note: "First two seconds as a guilty line. Keep using.",
  },
  {
    style: "Rant",
    sample: 5,
    hitRate: 0.6,
    note: "Shorts like these. Save leftovers for Sunday.",
  },
  {
    style: "Story-first",
    sample: 4,
    hitRate: 0.5,
    note: "Better than tutorials on Reels / Shorts.",
  },
  {
    style: "Talking-head tip",
    sample: 6,
    hitRate: 0.16,
    note: "You skip these. Encore will stop pushing them.",
  },
];

export const leftovers: Leftover[] = [
  {
    id: "l1",
    label: "Exam-panic rant",
    from: "study-vlog-final.mp4",
    range: "2:10–2:31",
  },
  {
    id: "l2",
    label: "Kai check-in line",
    from: "study-vlog-final.mp4",
    range: "7:05–7:22",
  },
  {
    id: "l3",
    label: "Night-shift internship aside",
    from: "week-in-review.mp4",
    range: "4:12–4:41",
  },
];

export function analyticsSummary(posts: AnalyticsPost[]) {
  const totalViews = posts.reduce((sum, post) => sum + post.views, 0);
  const hits = posts.filter((post) => post.verdict === "hit").length;
  const flops = posts.filter((post) => post.verdict === "flop").length;
  const mids = posts.filter((post) => post.verdict === "mid").length;
  return {
    posts: posts.length,
    totalViews,
    median: ANALYTICS_MEDIAN,
    hitRate: posts.length ? hits / posts.length : 0,
    hits,
    mids,
    flops,
  };
}

export function daySeries(posts: AnalyticsPost[]): DayPoint[] {
  return posts.map((post) => ({ day: post.day, views: post.views }));
}
