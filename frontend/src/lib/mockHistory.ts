import {
  ANALYTICS_MEDIAN,
  analyticsPosts,
  leftovers,
  playbook,
} from "./mockAnalytics";
import { loadProjects, type Project } from "./mockProjects";

export type HistoryCategory = "posted" | "draft" | "leftover";

export type HistoryItem = {
  id: string;
  title: string;
  source: string;
  category: HistoryCategory;
  /** Human-readable state shown in the pill. */
  status: string;
  updatedAt: number;
  median: number;
  views?: number;
  verdict?: "hit" | "mid" | "flop";
  hook?: string;
  url?: string;
  clips?: number;
  range?: string;
};

const OVERRIDES_KEY = "encore.historyOverrides";

/**
 * Renames and deletions for items that have no store of their own.
 *
 * Drafts and posted cuts are real `Project` records, so those edits go through
 * `saveProjects` and stay in sync with Home. Anything History surfaces without
 * a backing record keeps its edits here instead of losing them on reload.
 */
export type HistoryOverrides = {
  hidden: string[];
  renamed: Record<string, string>;
};

export const emptyOverrides: HistoryOverrides = { hidden: [], renamed: {} };

export function loadOverrides(): HistoryOverrides {
  if (typeof window === "undefined") return emptyOverrides;
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY);
    if (!raw) return emptyOverrides;
    const parsed = JSON.parse(raw) as Partial<HistoryOverrides>;
    return { hidden: parsed.hidden ?? [], renamed: parsed.renamed ?? {} };
  } catch {
    return emptyOverrides;
  }
}

export function saveOverrides(next: HistoryOverrides) {
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(next));
}

/**
 * One list spanning everything a creator has made: published clips and tapes
 * still in draft.
 *
 * Built entirely from the creator's own `Project` records — the same source Home
 * and Analytics read — so the three views can never disagree, and a fresh
 * account gets an empty list rather than someone else's demo tapes.
 */
export function buildHistory(
  projects: Project[] = loadProjects(),
  overrides: HistoryOverrides = emptyOverrides,
): HistoryItem[] {
  const rows: HistoryItem[] = projects.map((project) => {
    const isVerifiedPosted =
      Boolean(project.url) ||
      project.verdict !== undefined ||
      project.status === "checked" ||
      (project.status === "posted" && project.views !== undefined);

    if (isVerifiedPosted) {
      return {
        id: project.id,
        title: project.name,
        source: `${project.clips} clips cut`,
        category: "posted",
        status: project.verdict ?? "posted",
        updatedAt: project.updatedAt,
        median: ANALYTICS_MEDIAN,
        views: project.views,
        verdict: project.verdict,
        url: project.url,
        clips: project.clips,
      };
    }

    return {
      id: project.id,
      title: project.name,
      source: `${project.clips} clips cut`,
      category: "draft",
      status: "draft",
      updatedAt: project.updatedAt,
      median: ANALYTICS_MEDIAN,
      clips: project.clips,
    };
  });

  return rows
    .filter((item) => !overrides.hidden.includes(item.id))
    .map((item) =>
      overrides.renamed[item.id]
        ? { ...item, title: overrides.renamed[item.id] }
        : item,
    );
}

export type Diagnosis = {
  reasons: string[];
  suggestions: string[];
};

/**
 * Why a clip flopped, and what to try instead.
 *
 * Every line is derived from data the app already holds — the views/median
 * ratio, the hook's hit rate in the playbook, repeated hooks in the same week,
 * and the unused leftovers — so nothing here is invented.
 */
export function diagnoseFlop(
  item: HistoryItem,
  all: HistoryItem[],
): Diagnosis | null {
  if (item.verdict !== "flop" || item.views === undefined) return null;

  const reasons: string[] = [];
  const suggestions: string[] = [];

  const share = Math.round((item.views / item.median) * 100);
  reasons.push(
    share < 40
      ? `Landed at ${share}% of your ${item.median.toLocaleString()} median — below the 40% flop line.`
      : `Landed at ${share}% of your ${item.median.toLocaleString()} median — short of the pack.`,
  );

  const style = playbook.find((row) => row.style.toLowerCase().startsWith(
    (item.hook ?? "").toLowerCase(),
  ));
  if (style && style.hitRate < 0.4) {
    reasons.push(
      `“${style.style}” converts ${Math.round(style.hitRate * 100)}% across ${style.sample} posts — your weakest style.`,
    );
  } else if (!style && item.hook) {
    reasons.push(
      `“${item.hook}” is not in your playbook yet — no evidence this style lands for you.`,
    );
  }

  const repeat = all.find(
    (other) =>
      other.id !== item.id &&
      other.category === "posted" &&
      other.hook === item.hook &&
      other.updatedAt < item.updatedAt,
  );
  if (repeat) {
    reasons.push(
      `You already ran a ${item.hook?.toLowerCase()} hook on “${repeat.title}” — the second one split the same audience.`,
    );
  }

  if (playbook.length > 0) {
    const best = playbook.reduce((top, row) => (row.hitRate > top.hitRate ? row : top));
    suggestions.push(
      `Recut with a ${best.style.toLowerCase()} open — ${Math.round(best.hitRate * 100)}% hit rate for you.`,
    );
  }

  const spare = leftovers[0];
  if (spare) {
    suggestions.push(
      `Ship “${spare.label}” (${spare.range}) instead of re-cropping this beat.`,
    );
  }

  if (analyticsPosts.length > 0) {
    const strongest = analyticsPosts.reduce((top, post) =>
      post.views > top.views ? post : top,
    );
    suggestions.push(
      `Your strongest slot this week was ${strongest.day} at ${strongest.views.toLocaleString()} views.`,
    );
  }

  return { reasons, suggestions };
}

export const CATEGORY_LABEL: Record<HistoryCategory | "all" | "flop", string> = {
  all: "Everything",
  posted: "Posted",
  draft: "Drafts",
  leftover: "Leftovers",
  flop: "Flops",
};

export type SortKey = "recent" | "views" | "worst";

export const SORT_LABEL: Record<SortKey, string> = {
  recent: "Most recent",
  views: "Most views",
  worst: "Worst first",
};

export function sortHistory(items: HistoryItem[], key: SortKey): HistoryItem[] {
  const sorted = [...items];
  if (key === "recent") {
    return sorted.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  if (key === "views") {
    return sorted.sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
  }
  // Worst first: lowest views lead, un-posted items sink to the bottom.
  return sorted.sort(
    (a, b) => (a.views ?? Number.MAX_SAFE_INTEGER) - (b.views ?? Number.MAX_SAFE_INTEGER),
  );
}
