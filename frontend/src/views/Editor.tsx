"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Plus } from "lucide-react";
import EditorActions, {
  type ExportTarget,
} from "@/components/editor/EditorActions";
import Timeline from "@/components/editor/Timeline";
import ToolPanel from "@/components/editor/ToolPanel";
import ToolRail, { type ToolId } from "@/components/editor/ToolRail";
import TransportBar, {
  type TransportEdit,
} from "@/components/editor/TransportBar";
import ClipContextMenu, {
  type ClipMenuAction,
} from "@/components/editor/ClipContextMenu";
import type { Clip, Message, Moment, PostCheck, Video } from "@/types";
import { WORKFLOW_STEPS, workflowIndex } from "@/lib/studioAssets";
import {
  buildClipFromMoment,
  buildMoments,
  buildPostCheck,
  buildVideo,
  mindMessage,
  youMessage,
} from "@/lib/mockEditor";
import { extractFrames, extractPeaks, type Frame } from "@/lib/mediaGraphics";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Local id source — mockEditor keeps its own id() private, and the clip ops
// here (split / duplicate / paste) all need fresh, collision-free ids.
let idSeq = 0;
function uid(prefix: string) {
  idSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${idSeq}`;
}

function stampNow() {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());
}

/** A safe download filename off a cut title. */
function fileSlug(text: string) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "encore-cut"
  );
}

// Hooks the caption regenerate / re-run-analysis actions rotate through, so
// those menu items visibly do something in the mock pipeline.
const CAPTION_VARIANTS: {
  title: string;
  caption: string;
  hashtags: string[];
}[] = [
  {
    title: "The part nobody films.",
    caption: "The part nobody films.\n\nRaw, uncut, real.",
    hashtags: ["#bts", "#raw", "#encore", "#shorts"],
  },
  {
    title: "Watch till the end.",
    caption: "Watch till the end — it flips.",
    hashtags: ["#watchtillend", "#plottwist", "#encore", "#fyp"],
  },
  {
    title: "I almost cut this.",
    caption: "I almost cut this. Glad I didn’t.",
    hashtags: ["#storytime", "#keep", "#encore", "#shorts"],
  },
  {
    title: "This is the one.",
    caption: "This is the one. Save it for later.",
    hashtags: ["#save", "#thisone", "#encore", "#fyp"],
  },
];

const ASPECTS: { id: string; label: string; ratio: string; n: number }[] = [
  { id: "16:9", label: "16:9", ratio: "16 / 9", n: 16 / 9 },
  { id: "9:16", label: "9:16", ratio: "9 / 16", n: 9 / 16 },
  { id: "4:3", label: "4:3", ratio: "4 / 3", n: 4 / 3 },
  { id: "1:1", label: "1:1", ratio: "1 / 1", n: 1 },
  { id: "4:5", label: "4:5", ratio: "4 / 5", n: 4 / 5 },
  { id: "21:9", label: "21:9", ratio: "21 / 9", n: 21 / 9 },
];

function stem(name: string) {
  return name.replace(/\.[^/.]+$/, "") || name;
}

/**
 * Read a file's real duration off a throwaway <video>, so the timeline can lay
 * the take and its cuts out at true time. Resolves 0 (→ the caller falls back
 * to a stored guess) when the file has no readable metadata, and never hangs —
 * a 6s guard resolves 0.
 */
function probeDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(0);
      return;
    }
    const video = document.createElement("video");
    let done = false;
    const finish = (value: number) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      video.removeAttribute("src");
      resolve(Number.isFinite(value) && value > 0 ? value : 0);
    };
    const timer = window.setTimeout(() => finish(0), 6000);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => finish(video.duration);
    video.onerror = () => finish(0);
    video.src = url;
  });
}

type MenuState = {
  kind: "clip" | "take";
  clipId: string | null;
  x: number;
  y: number;
};

export default function Editor() {
  const [video, setVideo] = useState<Video | null>(null);
  const [busy, setBusy] = useState(false);
  const [moments, setMoments] = useState<Moment[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [checks, setChecks] = useState<PostCheck[]>([]);
  const [messages, setMessages] = useState<Message[]>([
    mindMessage(
      "Drop a long take. I’ll find the beats that stand alone and cut each one for you — captioned and ready to ship.",
    ),
  ]);

  const [tool, setTool] = useState<ToolId>("take");
  const [panelOpen, setPanelOpen] = useState(true);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [stamp, setStamp] = useState("");

  // Clip editing: a one-slot clipboard for copy/cut/paste and a linear
  // undo/redo history over the structural clip operations.
  const [clipboard, setClipboard] = useState<Clip | null>(null);
  const [past, setPast] = useState<Clip[][]>([]);
  const [future, setFuture] = useState<Clip[][]>([]);
  const [menu, setMenu] = useState<MenuState | null>(null);

  // Take-level edit state: the main clip's trimmed in/out plus a one-shot pulse
  // that flags the trim handles when the user picks Trim from a menu.
  const [takeIn, setTakeIn] = useState(0);
  const [takeOut, setTakeOut] = useState(0);
  const [trimPulse, setTrimPulse] = useState(false);

  // View toggles that live on the transport bar.
  const [aiOn, setAiOn] = useState(false);
  const [compareOn, setCompareOn] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [previewRotate, setPreviewRotate] = useState(0);
  const [previewFlip, setPreviewFlip] = useState(false);

  // Playback: a real object URL off the picked file, so the monitor actually
  // plays the take and the playhead tracks real time.
  const mediaRef = useRef<HTMLVideoElement>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);

  // Real filmstrip + waveform pulled off the uploaded blob for the timeline.
  const [frames, setFrames] = useState<Frame[]>([]);
  const [peaks, setPeaks] = useState<number[] | null>(null);

  const [exporting, setExporting] = useState<ExportTarget | null>(null);
  const [projectName, setProjectName] = useState("Untitled");
  const [renaming, setRenaming] = useState(false);
  const [aspect, setAspect] = useState("16:9");
  const [pxPerSecond, setPxPerSecond] = useState(12);
  const [timelineH, setTimelineH] = useState(12);

  const stageRef = useRef<HTMLElement>(null);
  const monitorRef = useRef<HTMLDivElement>(null);
  const stageFileRef = useRef<HTMLInputElement>(null);
  const [stageDrag, setStageDrag] = useState(false);

  useEffect(() => {
    setStamp(stampNow());
    const tick = window.setInterval(() => setStamp(stampNow()), 30_000);
    return () => window.clearInterval(tick);
  }, []);

  // Release the blob when it is swapped out or the editor unmounts.
  useEffect(() => {
    if (!mediaUrl) return;
    return () => URL.revokeObjectURL(mediaUrl);
  }, [mediaUrl]);

  // Track real fullscreen so the toolbar button reflects the actual state.
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Pull a real filmstrip and audio-peak envelope off the uploaded blob once we
  // know its true duration. Gated on a real media clock so the mock/stand-in
  // uploads (which never report a duration) stay silent — no decode, no noise.
  useEffect(() => {
    let cancelled = false;
    setFrames([]);
    setPeaks(null);
    if (!mediaUrl || mediaDuration <= 0) return;
    (async () => {
      const nextFrames = await extractFrames(mediaUrl, mediaDuration, 48);
      if (!cancelled) setFrames(nextFrames);
      const nextPeaks = await extractPeaks(mediaUrl, 600);
      if (!cancelled) setPeaks(nextPeaks);
    })();
    return () => {
      cancelled = true;
    };
  }, [mediaUrl, mediaDuration]);

  const pushMind = useCallback((text: string) => {
    setMessages((prev) => [...prev, mindMessage(text)]);
  }, []);

  /* ---- Take ---- */

  async function handleUpload(file: File) {
    setBusy(true);
    setMoments([]);
    setClips([]);
    setChecks([]);
    setSelectedClipId(null);
    setMenu(null);
    setClipboard(null);
    setPast([]);
    setFuture([]);
    setPreviewRotate(0);
    setPreviewFlip(false);
    setTime(0);
    setPlaying(false);
    setMediaDuration(0);
    setFrames([]);
    setPeaks(null);
    const url = URL.createObjectURL(file);
    setMediaUrl(url);

    // Probe the real duration first, so the take block and every cut land at
    // their true time on the timeline instead of a fixed guess.
    const probed = await probeDuration(url);
    const nextVideo = buildVideo(file, probed);
    setVideo(nextVideo);
    setTakeIn(0);
    setTakeOut(nextVideo.duration);
    setProjectName(stem(file.name));
    setMessages((prev) => [
      ...prev,
      youMessage(`Uploaded ${file.name}`),
      mindMessage("Watching the tape and cutting the beats that stand alone…"),
    ]);
    setTool("cuts");

    await sleep(1400);
    // Detect the beats, then cut every one automatically — no manual keep/skip.
    // Cuts exist the moment the tape is read, so Share/Export are live at once.
    const nextMoments = buildMoments(nextVideo.id, nextVideo.duration).map((moment) => ({
      ...moment,
      status: "accepted" as const,
    }));
    const nextClips = nextMoments.map((moment) =>
      buildClipFromMoment(moment, nextVideo.id),
    );
    setMoments(nextMoments);
    setClips(nextClips);
    setSelectedClipId(nextClips[0]?.id ?? null);
    setBusy(false);
    pushMind(
      `Cut ${nextClips.length} clips from the tape. Titles and hashtags are on each — tweak a caption, then Share or Export.`,
    );
  }

  function handleReset() {
    setVideo(null);
    setMoments([]);
    setClips([]);
    setChecks([]);
    setBusy(false);
    setSelectedClipId(null);
    setMenu(null);
    setClipboard(null);
    setPast([]);
    setFuture([]);
    setPreviewRotate(0);
    setPreviewFlip(false);
    setMediaUrl(null);
    setMediaDuration(0);
    setTakeIn(0);
    setTakeOut(0);
    setTrimPulse(false);
    setFrames([]);
    setPeaks(null);
    setTime(0);
    setPlaying(false);
    setTool("take");
    setProjectName("Untitled");
    setMessages([
      mindMessage("Fresh tape. Drop another long take when you’re ready."),
    ]);
  }

  function takeStageFile(file: File | undefined) {
    if (!file || !file.type.startsWith("video/")) return;
    void handleUpload(file);
  }

  /* ---- Cuts: editing ---- */

  function handleClipChange(next: Clip) {
    setClips((prev) => prev.map((c) => (c.id === next.id ? next : c)));
  }

  // Snapshot the current clips before a structural change, so undo/redo can
  // step through the timeline edits. Caption typing is intentionally left out.
  function commit(next: Clip[]) {
    setPast((p) => [...p.slice(-49), clips]);
    setFuture([]);
    setClips(next);
  }

  function undo() {
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    setFuture((f) => [clips, ...f].slice(0, 50));
    setClips(prev);
    setPast((p) => p.slice(0, -1));
  }

  function redo() {
    if (future.length === 0) return;
    const next = future[0];
    setPast((p) => [...p, clips].slice(-50));
    setClips(next);
    setFuture((f) => f.slice(1));
  }

  function splitClip(id: string) {
    const clip = clips.find((c) => c.id === id);
    if (!clip) return;
    const at = time;
    if (at <= clip.start + 0.05 || at >= clip.end - 0.05) {
      pushMind("Put the playhead inside the clip to split it.");
      return;
    }
    const left: Clip = { ...clip, end: at };
    const right: Clip = {
      ...clip,
      id: uid("clip"),
      start: at,
      posted: false,
      postId: undefined,
      postUrl: undefined,
      frozen: false,
    };
    commit(clips.flatMap((c) => (c.id === id ? [left, right] : [c])));
    setSelectedClipId(left.id);
    pushMind(`Split “${clip.title}” at ${Math.round(at)}s.`);
  }

  function duplicateClip(id: string) {
    const clip = clips.find((c) => c.id === id);
    if (!clip) return;
    const copy: Clip = {
      ...clip,
      id: uid("clip"),
      title: `${clip.title} copy`,
      posted: false,
      postId: undefined,
      postUrl: undefined,
    };
    const idx = clips.findIndex((c) => c.id === id);
    commit([...clips.slice(0, idx + 1), copy, ...clips.slice(idx + 1)]);
    setSelectedClipId(copy.id);
  }

  function deleteClip(id: string) {
    const idx = clips.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const next = clips.filter((c) => c.id !== id);
    commit(next);
    if (selectedClipId === id) {
      const fallback = next[idx] ?? next[idx - 1] ?? null;
      setSelectedClipId(fallback ? fallback.id : null);
    }
    if (menu?.clipId === id) setMenu(null);
  }

  function copyClip(id: string) {
    const clip = clips.find((c) => c.id === id);
    if (!clip) return;
    setClipboard({ ...clip });
    pushMind(`Copied “${clip.title}”.`);
  }

  function cutClip(id: string) {
    const clip = clips.find((c) => c.id === id);
    if (!clip) return;
    setClipboard({ ...clip });
    deleteClip(id);
  }

  function pasteAfter(targetId: string | null) {
    if (!clipboard) return;
    const dup: Clip = {
      ...clipboard,
      id: uid("clip"),
      title: `${clipboard.title} copy`,
      posted: false,
      postId: undefined,
      postUrl: undefined,
    };
    const idx = targetId
      ? clips.findIndex((c) => c.id === targetId)
      : clips.length - 1;
    const at = idx < 0 ? clips.length : idx + 1;
    commit([...clips.slice(0, at), dup, ...clips.slice(at)]);
    setSelectedClipId(dup.id);
  }

  function freezeClip(id: string) {
    const clip = clips.find((c) => c.id === id);
    if (!clip) return;
    commit(clips.map((c) => (c.id === id ? { ...c, frozen: !c.frozen } : c)));
    pushMind(
      clip.frozen
        ? `Unfroze “${clip.title}”.`
        : `Froze “${clip.title}” on its last frame.`,
    );
  }

  function regenCaption(id: string) {
    const clip = clips.find((c) => c.id === id);
    if (!clip) return;
    if (clip.posted) {
      pushMind("That cut is live — recut it to change the hook.");
      return;
    }
    const v = CAPTION_VARIANTS[Math.floor(Math.random() * CAPTION_VARIANTS.length)];
    commit(
      clips.map((c) =>
        c.id === id
          ? { ...c, title: v.title, caption: v.caption, hashtags: v.hashtags }
          : c,
      ),
    );
    pushMind("Regenerated the caption with a fresh hook.");
  }

  function rerunAnalysis(id: string) {
    const clip = clips.find((c) => c.id === id);
    if (!clip) return;
    const v = CAPTION_VARIANTS[Math.floor(Math.random() * CAPTION_VARIANTS.length)];
    commit(
      clips.map((c) =>
        c.id === id
          ? {
              ...c,
              title: v.title,
              hashtags: v.hashtags,
              tags: v.hashtags.map((t) => t.replace("#", "")),
            }
          : c,
      ),
    );
    pushMind("Re-ran analysis on this beat — new title and tags.");
  }

  function downloadClip(id: string) {
    const clip = clips.find((c) => c.id === id);
    if (!clip || !mediaUrl || typeof document === "undefined") return;
    const link = document.createElement("a");
    link.href = mediaUrl;
    link.download = `${fileSlug(clip.title)}.mp4`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    pushMind(`Downloaded “${clip.title}”.`);
  }

  function handleRecut(clipId: string) {
    const clip = clips.find((c) => c.id === clipId);
    if (!clip) return;
    const recut: Clip = {
      ...clip,
      id: uid("clip"),
      title: "Nobody talks about the 2 a.m. spiral.",
      caption:
        "Nobody talks about the 2 a.m. spiral.\n\nSame moment. New open. Story-first.",
      hashtags: ["#studyvlog", "#recut", "#encore", "#shorts"],
      posted: false,
      postId: undefined,
      postUrl: undefined,
    };
    commit([recut, ...clips]);
    setSelectedClipId(recut.id);
    pushMind("Recut queued with a story-first open. Export when it feels right.");
  }

  /* ---- Take: edit the main clip (the take), not a cut ---- */

  // Build a valid Clip for a slice of the take by routing through the same
  // moment→clip builder the auto-cut uses, so nothing downstream can tell a
  // hand-made cut from an auto one.
  function makeTakeClip(start: number, end: number, label: string): Clip {
    const moment: Moment = {
      id: uid("mom"),
      videoId: video?.id ?? "take",
      start,
      end,
      label,
      reason: "Cut from the take.",
      status: "accepted",
    };
    return {
      ...buildClipFromMoment(moment, video?.id ?? "take"),
      id: uid("clip"),
    };
  }

  const takeHi = () => (takeOut > 0 ? takeOut : duration);

  function splitTake() {
    if (!video) return;
    const lo = takeIn;
    const hi = takeHi();
    const at = time;
    if (at <= lo + 0.1 || at >= hi - 0.1) {
      pushMind("Move the playhead inside the take, then split.");
      return;
    }
    const left = makeTakeClip(lo, at, "Take · part 1");
    const right = makeTakeClip(at, hi, "Take · part 2");
    commit([...clips, left, right]);
    setSelectedClipId(left.id);
    setTool("cuts");
    pushMind(`Split the take at ${Math.round(at)}s into two cuts.`);
  }

  function duplicateTake() {
    if (!video) return;
    const clip = makeTakeClip(takeIn, takeHi(), `${projectName} (full take)`);
    commit([clip, ...clips]);
    setSelectedClipId(clip.id);
    setTool("cuts");
    pushMind("Duplicated the whole take as a cut.");
  }

  function cutTakeAtPlayhead() {
    if (!video) return;
    const hi = takeHi();
    const start = Math.min(Math.max(time, takeIn), Math.max(takeIn, hi - 1));
    const end = Math.min(start + 15, hi);
    if (end <= start + 0.1) {
      pushMind("Not enough tape left here to cut a clip.");
      return;
    }
    const clip = makeTakeClip(start, end, "New cut");
    commit([...clips, clip]);
    setSelectedClipId(clip.id);
    setTool("cuts");
    pushMind(`Cut a ${Math.round(end - start)}s clip from ${Math.round(start)}s.`);
  }

  function deleteTake() {
    if (!video) return;
    handleReset();
  }

  function trimTake() {
    if (!video) return;
    setTrimPulse(true);
    window.setTimeout(() => setTrimPulse(false), 1600);
    pushMind(
      "Drag the highlighted edges of the take on the timeline to trim its in and out points.",
    );
  }

  function downloadTake() {
    if (!video || !mediaUrl || typeof document === "undefined") return;
    const link = document.createElement("a");
    link.href = mediaUrl;
    link.download = `${fileSlug(projectName)}.mp4`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    pushMind("Downloaded the full take.");
  }

  function onTakeAction(action: ClipMenuAction) {
    switch (action) {
      case "split":
        splitTake();
        break;
      case "trim":
        trimTake();
        break;
      case "duplicate":
        duplicateTake();
        break;
      case "delete":
        deleteTake();
        break;
      case "download":
        downloadTake();
        break;
      default:
        break;
    }
  }

  /* ---- Context menu + transport edit dispatch ---- */

  function openMenu(clipId: string, x: number, y: number) {
    setSelectedClipId(clipId);
    setMenu({ kind: "clip", clipId, x, y });
  }

  function openTakeMenu(x: number, y: number) {
    setMenu({ kind: "take", clipId: null, x, y });
  }

  function onMenuAction(action: ClipMenuAction) {
    const current = menu;
    setMenu(null);
    if (!current) return;
    if (current.kind === "take") {
      onTakeAction(action);
      return;
    }
    const id = current.clipId;
    if (!id) return;
    switch (action) {
      case "split":
        splitClip(id);
        break;
      case "copy":
        copyClip(id);
        break;
      case "cut":
        cutClip(id);
        break;
      case "paste":
        pasteAfter(id);
        break;
      case "duplicate":
        duplicateClip(id);
        break;
      case "delete":
        deleteClip(id);
        break;
      case "download":
        downloadClip(id);
        break;
      case "freeze":
        freezeClip(id);
        break;
      case "regen-caption":
        regenCaption(id);
        break;
      case "rerun-analysis":
        rerunAnalysis(id);
        break;
      default:
        // replace / transcript / separate-audio / split-scene: disabled for now
        break;
    }
  }

  function onTransportEdit(edit: TransportEdit) {
    if (edit === "rotate") {
      setPreviewRotate((r) => (r + 90) % 360);
      return;
    }
    if (edit === "flip") {
      setPreviewFlip((f) => !f);
      return;
    }
    if (!video) return;
    switch (edit) {
      case "split":
        splitTake();
        break;
      case "delete":
        deleteTake();
        break;
      case "duplicate":
        duplicateTake();
        break;
      case "cut":
        cutTakeAtPlayhead();
        break;
      case "download":
        downloadTake();
        break;
    }
  }

  /* ---- Export ---- */

  const exportClip =
    clips.find((clip) => clip.id === selectedClipId) ??
    clips.find((clip) => !clip.posted) ??
    clips[0] ??
    null;

  /** Publishes a cut and comes back with the verdict — the YouTube path. */
  async function shipToYouTube(clip: Clip) {
    const postId = `post_${clip.id}`;
    const postUrl = `https://youtube.com/shorts/encore-${clip.id.slice(-5)}`;
    setClips((prev) =>
      prev.map((c) =>
        c.id === clip.id ? { ...c, posted: true, postId, postUrl } : c,
      ),
    );
    pushMind(
      `Posted “${clip.title}” to YouTube. I’ll check views against your median after a beat — no need to ask.`,
    );

    await sleep(2200);
    const check = buildPostCheck({ ...clip, posted: true, postId, postUrl });
    setChecks((prev) => [check, ...prev]);
    pushMind(
      check.verdict === "hit"
        ? `${check.views.toLocaleString()} views. Hit. That hook style goes up in the playbook.`
        : check.verdict === "flop"
          ? `${check.views.toLocaleString()} views. Flop. ${check.recutHook}`
          : `${check.views.toLocaleString()} views. Mid. Leave it and ship a leftover tomorrow.`,
    );
  }

  async function handleExport(target: ExportTarget) {
    const clip = exportClip;
    if (!clip || exporting) return;
    setSelectedClipId(clip.id);
    setExporting(target);

    if (target === "device") {
      setMessages((prev) => [
        ...prev,
        youMessage(`Export “${clip.title}” to device`),
      ]);
      // A real save: hand the loaded take back through a temporary download
      // link so the button actually produces a file on disk.
      if (mediaUrl && typeof document !== "undefined") {
        const link = document.createElement("a");
        link.href = mediaUrl;
        link.download = `${fileSlug(clip.title)}.mp4`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      await sleep(700);
      pushMind(`Saved “${clip.title}” to your device.`);
    } else if (clip.posted) {
      pushMind(`“${clip.title}” is already live. Recut it to ship a new open.`);
    } else {
      setMessages((prev) => [
        ...prev,
        youMessage(`Share “${clip.title}” to YouTube`),
      ]);
      await shipToYouTube(clip);
    }

    setExporting(null);
  }

  /* ---- Mind ---- */

  function handleSend(text: string) {
    setPrompt("");
    setMessages((prev) => [...prev, youMessage(text)]);
    const lower = text.toLowerCase();
    window.setTimeout(() => {
      if (lower.includes("leftover") || lower.includes("left over")) {
        pushMind(
          "You still have the exam-panic rant unused. Shorts liked rants last month — want me to ship it?",
        );
      } else if (lower.includes("flop") || lower.includes("check")) {
        pushMind(
          checks[0]
            ? `Latest: ${checks[0].verdict} at ${checks[0].views.toLocaleString()} views.`
            : "Nothing live yet. Export a cut to YouTube and I’ll check it on my own.",
        );
      } else {
        pushMind(
          "I’m on the notebook. Keep or skip the moments, edit captions, export — I’ll handle the live check.",
        );
      }
    }, 500);
  }

  /* ---- Transport ---- */

  // On-timeline length equals the real media time: once the file's metadata is
  // in we trust the media clock; before that we fall back to the take's own
  // stored duration so the beats still lay out.
  const duration = mediaDuration > 0 ? mediaDuration : video?.duration ?? 0;

  const seek = useCallback(
    (seconds: number) => {
      const el = mediaRef.current;
      const bounded = Math.max(0, seconds);
      if (el && mediaDuration > 0) {
        el.currentTime = Math.min(bounded, mediaDuration);
      }
      setTime(bounded);
    },
    [mediaDuration],
  );

  const togglePlay = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }, []);

  function toggleFullscreen() {
    if (typeof document === "undefined") return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void monitorRef.current?.requestFullscreen?.();
  }

  // Keyboard shortcuts — kept in a ref so the single mount-time listener always
  // sees the latest state without re-binding on every render. Text fields and
  // native controls keep their own key behaviour.
  const kbRef = useRef({
    split: () => {},
    del: () => {},
    dup: () => {},
    copy: () => {},
    cut: () => {},
    paste: () => {},
    undo: () => {},
    redo: () => {},
    play: () => {},
  });
  kbRef.current = {
    split: () => {
      if (selectedClipId) splitClip(selectedClipId);
    },
    del: () => {
      if (selectedClipId) deleteClip(selectedClipId);
    },
    dup: () => {
      if (selectedClipId) duplicateClip(selectedClipId);
    },
    copy: () => {
      if (selectedClipId) copyClip(selectedClipId);
    },
    cut: () => {
      if (selectedClipId) cutClip(selectedClipId);
    },
    paste: () => pasteAfter(selectedClipId),
    undo,
    redo,
    play: togglePlay,
  };

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const el = event.target as HTMLElement | null;
      const typing =
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable);
      const onControl =
        !!el &&
        (el.tagName === "BUTTON" ||
          el.tagName === "A" ||
          el.tagName === "SELECT" ||
          el.getAttribute("role") === "slider");
      const mod = event.ctrlKey || event.metaKey;
      const k = event.key.toLowerCase();

      if (mod) {
        if (k === "b") {
          event.preventDefault();
          kbRef.current.split();
        } else if (k === "d") {
          event.preventDefault();
          kbRef.current.dup();
        } else if (k === "c" && !typing) {
          kbRef.current.copy();
        } else if (k === "x" && !typing) {
          kbRef.current.cut();
        } else if (k === "v" && !typing) {
          kbRef.current.paste();
        } else if (k === "z" && !event.shiftKey && !typing) {
          event.preventDefault();
          kbRef.current.undo();
        } else if (((k === "z" && event.shiftKey) || k === "y") && !typing) {
          event.preventDefault();
          kbRef.current.redo();
        }
        return;
      }

      if (typing) return;
      if (event.key === " " || event.code === "Space") {
        if (onControl) return;
        event.preventDefault();
        kbRef.current.play();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        if (onControl) return;
        event.preventDefault();
        kbRef.current.del();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const stage = workflowIndex({ video, busy, moments, clips });
  const menuClip = menu ? clips.find((c) => c.id === menu.clipId) : null;

  return (
    <main className={panelOpen ? "cutroom" : "cutroom is-panel-closed"}>
      <header className="cut__top">
        <div className="cut__slate">
          {renaming ? (
            <input
              className="cut__project-input"
              value={projectName}
              autoFocus
              aria-label="Project name"
              onChange={(event) => setProjectName(event.target.value)}
              onBlur={() => {
                setProjectName((name) => name.trim() || "Untitled");
                setRenaming(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                  setRenaming(false);
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="cut__project"
              title="Rename project"
              onClick={() => setRenaming(true)}
            >
              {projectName}
            </button>
          )}
          <span>{stamp}</span>
        </div>

        <label className="cut__aspect">
          <span>Ratio</span>
          <select
            value={aspect}
            aria-label="Aspect ratio"
            onChange={(event) => setAspect(event.target.value)}
          >
            {ASPECTS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <span className="cut__top-fill" aria-hidden="true" />

        <span className="cut__stagechip">
          <i aria-hidden="true" />
          {WORKFLOW_STEPS[stage].label}
        </span>

        <EditorActions
          disabled={!exportClip}
          pending={exporting}
          shared={!!exportClip?.posted}
          onExport={() => handleExport("device")}
          onShare={() => handleExport("youtube")}
        />
      </header>

      <ToolRail tool={tool} counts={{ cuts: clips.length }} onTool={setTool} />

      <ToolPanel
        tool={tool}
        video={video}
        busy={busy}
        clips={clips}
        messages={messages}
        selectedClipId={selectedClipId}
        prompt={prompt}
        onPrompt={setPrompt}
        onSend={handleSend}
        onUpload={handleUpload}
        onReset={handleReset}
        onPickClip={setSelectedClipId}
        onClipChange={handleClipChange}
        onClipContext={openMenu}
        onSeek={seek}
        onRecut={handleRecut}
      />

      <section className="cut__stage" aria-label="Preview and timeline" ref={stageRef}>
        <div
          className="cut__monitor"
          ref={monitorRef}
          onContextMenu={(event) => {
            if (!video) return;
            event.preventDefault();
            openTakeMenu(event.clientX, event.clientY);
          }}
        >
          {mediaUrl ? (
            <div
              className="cut__frame"
              style={
                {
                  "--ar":
                    ASPECTS.find((item) => item.id === aspect)?.n ?? 16 / 9,
                } as CSSProperties
              }
            >
              <video
                ref={mediaRef}
                src={mediaUrl}
                playsInline
                style={{
                  transform: `rotate(${previewRotate}deg) scaleX(${
                    previewFlip ? -1 : 1
                  })`,
                }}
                onLoadedMetadata={(event) =>
                  setMediaDuration(event.currentTarget.duration || 0)
                }
                onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
              />
              {compareOn ? <span className="cut__compare" aria-hidden="true" /> : null}
            </div>
          ) : (
            <div
              className={stageDrag ? "cut__empty is-drag" : "cut__empty"}
              onDragOver={(event) => {
                event.preventDefault();
                setStageDrag(true);
              }}
              onDragLeave={() => setStageDrag(false)}
              onDrop={(event) => {
                event.preventDefault();
                setStageDrag(false);
                takeStageFile(event.dataTransfer.files?.[0]);
              }}
            >
              <button
                type="button"
                className="cut__empty-hit"
                onClick={() => stageFileRef.current?.click()}
              >
                <span className="cut__empty-orb" aria-hidden="true">
                  <Plus />
                </span>
                <strong>Click to upload</strong>
                <span className="cut__empty-sub">
                  or drag and drop a long take here
                </span>
              </button>
              <input
                ref={stageFileRef}
                className="cut__empty-file"
                type="file"
                accept="video/*"
                hidden
                onChange={(event) => takeStageFile(event.target.files?.[0])}
              />
            </div>
          )}

          {aiOn ? (
            <span className="cut__aibadge" aria-hidden="true">
              AI tools
            </span>
          ) : null}

          {busy ? (
            <p className="cut__scanning">
              <i aria-hidden="true" />
              Reading the tape for standalone beats…
            </p>
          ) : null}
        </div>

        <TransportBar
          time={time}
          duration={duration}
          playing={playing}
          canEdit={!!video}
          aiOn={aiOn}
          compareOn={compareOn}
          fullscreen={fullscreen}
          panelOpen={panelOpen}
          pxPerSecond={pxPerSecond}
          onEdit={onTransportEdit}
          onRewind={() => seek(Math.max(0, time - 5))}
          onTogglePlay={togglePlay}
          onForward={() => seek(Math.min(duration, time + 5))}
          onToggleAi={() => setAiOn((v) => !v)}
          onToggleCompare={() => setCompareOn((v) => !v)}
          onPxPerSecond={setPxPerSecond}
          onToggleFullscreen={toggleFullscreen}
          onTogglePanel={() => setPanelOpen((open) => !open)}
        />

        <Timeline
          duration={duration}
          time={time}
          takeName={mediaUrl ? projectName : null}
          takeIn={takeIn}
          takeOut={takeOut > 0 ? takeOut : duration}
          clips={clips}
          selectedClipId={selectedClipId}
          pxPerSecond={pxPerSecond}
          heightRem={timelineH}
          frames={frames}
          peaks={peaks}
          trimPulse={trimPulse}
          onSeek={seek}
          onPickClip={(id) => {
            setSelectedClipId(id);
            setTool("caption");
          }}
          onClipContextMenu={openMenu}
          onTakeContextMenu={openTakeMenu}
          onTakeTrim={(nextIn, nextOut) => {
            setTakeIn(nextIn);
            setTakeOut(nextOut);
          }}
          onPxPerSecond={setPxPerSecond}
          onHeightRem={setTimelineH}
        />
      </section>

      {menu ? (
        <ClipContextMenu
          x={menu.x}
          y={menu.y}
          mode={menu.kind}
          frozen={menuClip?.frozen}
          canPaste={!!clipboard}
          hasAudio={false}
          onAction={onMenuAction}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </main>
  );
}
