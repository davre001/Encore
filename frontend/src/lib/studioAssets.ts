import type { Clip, Moment, PostCheck, Video } from "@/types";

export type MediaFilter =
  | "all"
  | "images"
  | "videos"
  | "characters"
  | "scenes"
  | "favorites"
  | "tools"
  | "trash";

export type AssetKind = "video" | "image" | "scene" | "character";

export type AssetRole = "library" | "source" | "moment" | "clip" | "empty";

export type StudioAsset = {
  id: string;
  kind: AssetKind;
  role: AssetRole;
  title: string;
  kicker: string;
  skin: number;
  favorite: boolean;
  trashed: boolean;
  momentId?: string;
  clipId?: string;
  videoId?: string;
  momentStatus?: Moment["status"];
  posted?: boolean;
  verdict?: PostCheck["verdict"];
};

export const LIBRARY_ASSETS: StudioAsset[] = [
  {
    id: "lib-chart",
    kind: "video",
    role: "library",
    title: "Archive star chart",
    kicker: "Tape · 2:18",
    skin: 0,
    favorite: false,
    trashed: false,
  },
  {
    id: "lib-chart-2",
    kind: "video",
    role: "library",
    title: "Catalogued division",
    kicker: "Tape · 1:44",
    skin: 1,
    favorite: true,
    trashed: false,
  },
  {
    id: "lib-count-a",
    kind: "image",
    role: "library",
    title: "Counting system",
    kicker: "Still · observed data",
    skin: 2,
    favorite: false,
    trashed: false,
  },
  {
    id: "lib-12a",
    kind: "video",
    role: "library",
    title: "Item no. 12",
    kicker: "Cut · archive",
    skin: 3,
    favorite: false,
    trashed: false,
  },
  {
    id: "lib-count-b",
    kind: "image",
    role: "library",
    title: "Counting system — notes",
    kicker: "Still · 1948",
    skin: 4,
    favorite: false,
    trashed: false,
  },
  {
    id: "lib-count-c",
    kind: "scene",
    role: "library",
    title: "Desk setup cutdown",
    kicker: "Scene · 0:22",
    skin: 5,
    favorite: false,
    trashed: false,
  },
  {
    id: "lib-count-d",
    kind: "image",
    role: "library",
    title: "Receipt C. 1948",
    kicker: "Still",
    skin: 2,
    favorite: false,
    trashed: false,
  },
  {
    id: "lib-count-tag",
    kind: "scene",
    role: "library",
    title: "Counting system tag",
    kicker: "Scene · leftover",
    skin: 6,
    favorite: false,
    trashed: false,
  },
  {
    id: "lib-12b",
    kind: "video",
    role: "library",
    title: "Item no. 12 — recut",
    kicker: "Cut · posted",
    skin: 3,
    favorite: false,
    trashed: false,
    posted: true,
    verdict: "hit",
  },
  {
    id: "lib-13",
    kind: "video",
    role: "library",
    title: "Incident no. 13",
    kicker: "Cut · draft",
    skin: 7,
    favorite: false,
    trashed: false,
  },
  {
    id: "lib-tigris",
    kind: "scene",
    role: "library",
    title: "Tigris bank",
    kicker: "Scene · 0:41",
    skin: 8,
    favorite: true,
    trashed: false,
  },
  {
    id: "lib-days",
    kind: "image",
    role: "library",
    title: "5.24 days",
    kicker: "Still · calendar",
    skin: 9,
    favorite: false,
    trashed: false,
  },
  {
    id: "lib-stack",
    kind: "character",
    role: "library",
    title: "Mira — study booth",
    kicker: "Character board",
    skin: 10,
    favorite: false,
    trashed: false,
  },
];

export const WORKFLOW_STEPS = [
  { id: "drop", label: "Drop", hint: "Long take" },
  { id: "watch", label: "Watch", hint: "Finding beats" },
  { id: "moments", label: "Moments", hint: "Beats found" },
  { id: "cuts", label: "Cuts", hint: "Caption & ship" },
] as const;

export type WorkflowIndex = 0 | 1 | 2 | 3;

export function workflowIndex(input: {
  video: Video | null;
  busy: boolean;
  moments: Moment[];
  clips: Clip[];
}): WorkflowIndex {
  if (input.clips.length > 0) return 3;
  if (input.moments.length > 0) return 2;
  if (input.busy || input.video) return 1;
  return 0;
}

export function sessionAssets(input: {
  video: Video | null;
  busy: boolean;
  moments: Moment[];
  clips: Clip[];
  checks: PostCheck[];
}): StudioAsset[] {
  const out: StudioAsset[] = [];

  if (input.video) {
    out.push({
      id: `src-${input.video.id}`,
      kind: "video",
      role: "source",
      title: input.video.name,
      kicker: input.busy ? "Watching…" : "Source tape",
      skin: 0,
      favorite: false,
      trashed: false,
      videoId: input.video.id,
    });
  }

  for (const moment of input.moments) {
    out.push({
      id: moment.id,
      kind: "scene",
      role: "moment",
      title: moment.label,
      kicker: moment.reason,
      skin: moment.label.includes("Confession")
        ? 3
        : moment.label.includes("rant")
          ? 7
          : 5,
      favorite: false,
      trashed: moment.status === "rejected",
      momentId: moment.id,
      videoId: moment.videoId,
      momentStatus: moment.status,
    });
  }

  for (const clip of input.clips) {
    const check = input.checks.find((item) => item.clipId === clip.id);
    out.push({
      id: clip.id,
      kind: "video",
      role: "clip",
      title: clip.title,
      kicker: clip.posted
        ? check
          ? `${check.verdict} · ${check.views.toLocaleString()} views`
          : "Posted · checking"
        : "Cut ready",
      skin: 9,
      favorite: false,
      trashed: false,
      clipId: clip.id,
      momentId: clip.momentId,
      videoId: clip.videoId,
      posted: clip.posted,
      verdict: check?.verdict,
    });
  }

  return out;
}

export function filterAssets(
  assets: StudioAsset[],
  filter: MediaFilter,
  query: string,
): StudioAsset[] {
  const q = query.trim().toLowerCase();
  return assets.filter((asset) => {
    if (filter === "trash") {
      if (!asset.trashed) return false;
    } else if (filter === "favorites") {
      if (asset.trashed || !asset.favorite) return false;
    } else if (filter === "images") {
      if (asset.trashed || asset.kind !== "image") return false;
    } else if (filter === "videos") {
      if (asset.trashed || asset.kind !== "video") return false;
    } else if (filter === "characters") {
      if (asset.trashed || asset.kind !== "character") return false;
    } else if (filter === "scenes") {
      if (asset.trashed || asset.kind !== "scene") return false;
    } else if (filter === "tools") {
      return false;
    } else if (asset.trashed) {
      return false;
    }

    if (!q) return true;
    return (
      asset.title.toLowerCase().includes(q) ||
      asset.kicker.toLowerCase().includes(q)
    );
  });
}
