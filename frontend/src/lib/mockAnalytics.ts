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

/**
 * Analytics are real: posts, playbook, and leftovers all come from the backend
 * (`GET /api/analytics`) and from the creator's own draft projects. Nothing is
 * seeded — a fresh account shows empty states until it publishes and checks cuts.
 */
export const analyticsPosts: AnalyticsPost[] = [];

export const playbook: PlaybookRow[] = [];

export const leftovers: Leftover[] = [];

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
