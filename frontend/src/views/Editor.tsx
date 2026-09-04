"use client";

import {
  useCallback,
  useEffect,
  useMemo,
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
import type { Clip, Message, Moment, PostCheck, TakeSegment, Video } from "@/types";
import { WORKFLOW_STEPS, workflowIndex } from "@/lib/studioAssets";
import * as api from "@/api/client";
import { extractFrames, extractPeaks, type Frame } from "@/lib/mediaGraphics";
import { formatTime } from "@/lib/timecode";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Local id source — generates fresh, collision-free ids.
let idSeq = 0;
function uid(prefix: string) {
  idSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${idSeq}`;
}

function mindMessage(text: string): Message {
  return { id: uid("msg"), role: "mind", text, createdAt: Date.now() };
}

function youMessage(text: string): Message {
  return { id: uid("msg"), role: "you", text, createdAt: Date.now() };
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

function persistableMediaUrl(videoId: string | null | undefined, mediaUrl: string | null) {
  if (videoId) return api.videoFileUrl(videoId);
  if (mediaUrl && !mediaUrl.startsWith("blob:")) return mediaUrl;
  return null;
}

function initialProjectName() {
  if (typeof window === "undefined") return "Untitled";
  return new URLSearchParams(window.location.search).get("project")
    ? "Opening…"
    : "Untitled";
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
  // Ids the backend knows about (from decide→listClips, or created at publish).
  // Anything not in here is a local-only cut that must be created before it can
  // be posted; anything in here gets its edits PATCHed at publish time.
  const serverClipIds = useRef<Set<string>>(new Set<string>());
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

  // Take-level edit state: multiple take segments (from splitting the main clip),
  // trimmed in/out, plus a pulse that flags trim handles.
  const [takeSegments, setTakeSegments] = useState<TakeSegment[]>([]);
  const [selectedTakeId, setSelectedTakeId] = useState<string | null>(null);
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
  const [projectName, setProjectName] = useState(initialProjectName);
  const [renaming, setRenaming] = useState(false);
  const [aspect, setAspect] = useState("16:9");
  const [pxPerSecond, setPxPerSecond] = useState(12);
  const [timelineH, setTimelineH] = useState(12);

  const stageRef = useRef<HTMLElement>(null);
  const monitorRef = useRef<HTMLDivElement>(null);
  const stageFileRef = useRef<HTMLInputElement>(null);
  const [stageDrag, setStageDrag] = useState(false);

  // Project persistence and auto-save
  const [projectId, setProjectId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const isInitialLoad = useRef(true);
  const resumePlayhead = useRef<number | null>(null);
  // Posted/verdict state persisted onto the project so History can tell a draft
  // apart from a posted hit / mid / flop and resume the right one.
  const [projectStatus, setProjectStatus] =
    useState<"draft" | "posted" | "checked">("draft");
  const [projectVerdict, setProjectVerdict] =
    useState<"hit" | "mid" | "flop" | null>(null);
  const [projectViews, setProjectViews] = useState<number | null>(null);
  const [projectPostUrl, setProjectPostUrl] = useState<string | null>(null);
  const [projectPostId, setProjectPostId] = useState<string | null>(null);

  // Load project from backend if project ID in URL query param
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const qProject = params.get("project");
    if (!qProject) {
      isInitialLoad.current = false;
      return;
    }

    let mounted = true;
    api
      .getProject(qProject)
      .then((proj) => {
        if (!mounted || !proj) return;
        setProjectId(proj.id);
        setProjectName(proj.name || "Untitled");
        if (proj.takeIn !== undefined) setTakeIn(proj.takeIn);
        if (proj.takeOut !== undefined) setTakeOut(proj.takeOut);
        if (proj.takeSegments && proj.takeSegments.length > 0) {
          setTakeSegments(proj.takeSegments);
          setSelectedTakeId(proj.takeSegments[0].id);
        }
        if (proj.clips && proj.clips.length > 0) {
          setClips(proj.clips);
          setSelectedClipId(proj.clips[0].id);
        }
        if (proj.effects) {
          if (proj.effects.rotate !== undefined) setPreviewRotate(proj.effects.rotate);
          if (proj.effects.flip !== undefined) setPreviewFlip(proj.effects.flip);
          if (proj.effects.aspect) setAspect(proj.effects.aspect);
          if (proj.effects.aiOn !== undefined) setAiOn(proj.effects.aiOn);
          if (proj.effects.compareOn !== undefined) setCompareOn(proj.effects.compareOn);
        }
        // Restore posted/verdict state so a resumed posted project stays posted.
        if (proj.status) setProjectStatus(proj.status);
        if (proj.verdict) setProjectVerdict(proj.verdict);
        if (proj.views !== undefined && proj.views !== null) setProjectViews(proj.views);
        if (proj.postUrl) setProjectPostUrl(proj.postUrl);
        if (proj.postId) setProjectPostId(proj.postId);
        if (typeof proj.playhead === "number" && proj.playhead > 0) {
          resumePlayhead.current = proj.playhead;
          setTime(proj.playhead);
        }
        if (proj.videoId) {
          setMediaUrl(api.videoFileUrl(proj.videoId));
          setVideo({
            id: proj.videoId,
            name: proj.name || "take",
            duration: proj.takeOut || 0,
            createdAt: proj.createdAt,
          });
          api
            .getVideo(proj.videoId)
            .then((v) => {
              if (mounted && v) setVideo(v);
            })
            .catch(() => {});
          api
            .listMoments(proj.videoId)
            .then((found) => {
              if (mounted && found) setMoments(found);
            })
            .catch(() => {});
        }
        setSaveStatus("saved");
      })
      .catch((err) => {
        console.warn("Could not load project:", err);
        setProjectName("Untitled");
      })
      .finally(() => {
        if (mounted) {
          window.setTimeout(() => {
            isInitialLoad.current = false;
          }, 600);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  // Auto-save project whenever take segments, clips, or effect options change
  useEffect(() => {
    if (isInitialLoad.current) return;
    // Don't auto-save an empty, untouched canvas before any upload or clips exist
    if (!video && clips.length === 0 && takeSegments.length === 0 && !mediaUrl) {
      return;
    }

    setSaveStatus("saving");
    const timer = window.setTimeout(async () => {
      try {
        const payload = {
          id: projectId || undefined,
          name: projectName || "Untitled Take",
          videoId: video?.id || null,
          mediaUrl: persistableMediaUrl(video?.id, mediaUrl),
          playhead: time,
          status: projectStatus,
          verdict: projectVerdict ?? undefined,
          views: projectViews ?? undefined,
          postUrl: projectPostUrl ?? undefined,
          postId: projectPostId ?? undefined,
          takeIn,
          takeOut,
          takeSegments,
          clips,
          effects: {
            rotate: previewRotate,
            flip: previewFlip,
            aspect,
            aiOn,
            compareOn,
          },
        };

        const res = await api.saveProject(payload);
        if (res && res.id && res.id !== projectId) {
          setProjectId(res.id);
          // Update URL without full reload so refresh preserves the project
          if (typeof window !== "undefined") {
            const url = new URL(window.location.href);
            url.searchParams.set("project", res.id);
            window.history.replaceState({}, "", url.toString());
          }
        }
        setSaveStatus("saved");
      } catch (err) {
        console.warn("Auto-save failed:", err);
        setSaveStatus("idle");
      }
    }, 900);

    return () => window.clearTimeout(timer);
  }, [
    projectId,
    projectName,
    takeIn,
    takeOut,
    takeSegments,
    clips,
    previewRotate,
    previewFlip,
    aspect,
    aiOn,
    compareOn,
    video,
    mediaUrl,
    projectStatus,
    projectVerdict,
    projectViews,
    projectPostUrl,
    projectPostId,
  ]);

  useEffect(() => {
    setStamp(stampNow());
    const tick = window.setInterval(() => setStamp(stampNow()), 30_000);
    return () => window.clearInterval(tick);
  }, []);

  // Release the blob when it is swapped out or the editor unmounts.
  useEffect(() => {
    if (!mediaUrl || !mediaUrl.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(mediaUrl);
  }, [mediaUrl]);

  // Persist the playhead on pause so Continue restores the last watched spot.
  // Do not key the main auto-save on `time` — that would write on every frame.
  useEffect(() => {
    if (isInitialLoad.current || playing || !projectId) return;
    const at = time;
    const timer = window.setTimeout(() => {
      void api.updateProject(projectId, { playhead: at }).catch(() => {});
    }, 400);
    return () => window.clearTimeout(timer);
  }, [playing, time, projectId]);

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
    serverClipIds.current.clear();
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
    // A new take is a draft. Recutting a posted hit/mid/flop starts a fresh
    // project so the posted History row (and its Re-cut action) stays put.
    if (projectStatus === "posted" || projectStatus === "checked") {
      setProjectId(null);
      if (typeof window !== "undefined") {
        const next = new URL(window.location.href);
        next.searchParams.delete("project");
        window.history.replaceState({}, "", next.toString());
      }
    }
    setProjectStatus("draft");
    setProjectVerdict(null);
    setProjectViews(null);
    setProjectPostUrl(null);
    setProjectPostId(null);
    resumePlayhead.current = null;
    const url = URL.createObjectURL(file);
    setMediaUrl(url);

    const probed = await probeDuration(url);
    const initialTake: TakeSegment = {
      id: uid("take"),
      title: stem(file.name) || "Main take",
      start: 0,
      end: probed,
      sourceStart: 0,
      sourceEnd: probed,
    };
    setTakeSegments([initialTake]);
    setSelectedTakeId(initialTake.id);
    setTakeIn(0);
    setTakeOut(probed);
    setProjectName(stem(file.name));
    setMessages((prev) => [
      ...prev,
      youMessage(`Uploaded ${file.name}`),
      mindMessage("Uploading video and detecting standout moments…"),
    ]);
    setTool("moments");

    try {
      // 1. Upload to backend
      const nextVideo = await api.uploadVideo(file);
      setVideo(nextVideo);
      if (nextVideo.duration > 0) {
        setTakeOut(nextVideo.duration);
      }

      // 2. Poll for moments (propose_moments runs in a FastAPI background task).
      // Real Whisper on a genuinely long take can run well past a minute, so
      // give it room before declaring the tape momentless.
      let foundMoments: Moment[] = [];
      const startTime = Date.now();
      const timeoutMs = 180_000;
      while (Date.now() - startTime < timeoutMs) {
        await sleep(1000);
        foundMoments = await api.listMoments(nextVideo.id);
        if (foundMoments && foundMoments.length > 0) {
          break;
        }
      }

      setMoments(foundMoments);
      setBusy(false);

      if (foundMoments.length > 0) {
        pushMind(
          `Found ${foundMoments.length} standout moments. Review each beat: click Keep to turn it into a clip, or Skip.`,
        );
      } else {
        pushMind(
          "Processed the tape, but no standout moments surfaced yet. Longer takes can take a minute — you can also cut clips manually from the take.",
        );
      }
    } catch (err: any) {
      setBusy(false);
      pushMind(`Upload failed: ${err.message || err}`);
    }
  }

  async function handleDecideMoment(
    momentId: string,
    decision: "accept" | "reject",
  ) {
    try {
      const updated = await api.decideMoment(momentId, decision);
      setMoments((prev) => prev.map((m) => (m.id === momentId ? updated : m)));

      if (decision === "accept") {
        const vidId = updated.videoId || video?.id;
        if (vidId) {
          const nextClips = await api.listClips(vidId);
          setClips(nextClips);
          serverClipIds.current = new Set(nextClips.map((c) => c.id));
          const newClip = nextClips.find((c) => c.momentId === momentId);
          if (newClip) {
            setSelectedClipId(newClip.id);
          }
        }
        pushMind(`Kept “${updated.label}”. Cut created in Cuts.`);
      } else {
        pushMind(`Skipped “${updated.label}”.`);
      }
    } catch (err: any) {
      pushMind(`Failed to ${decision} moment: ${err.message || err}`);
    }
  }

  function handleReset() {
    setVideo(null);
    setMoments([]);
    setClips([]);
    serverClipIds.current.clear();
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
    setTakeSegments([]);
    setSelectedTakeId(null);
    setProjectId(null);
    setSaveStatus("idle");
    setProjectStatus("draft");
    setProjectVerdict(null);
    setProjectViews(null);
    setProjectPostUrl(null);
    setProjectPostId(null);
    resumePlayhead.current = null;
    setTime(0);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("project");
      window.history.replaceState({}, "", url.toString());
    }
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

  function handleClipMove(clipId: string, nextStart: number, nextEnd: number) {
    setClips((prev) =>
      prev.map((c) =>
        c.id === clipId ? { ...c, start: nextStart, end: nextEnd } : c
      )
    );
  }

  function handleClipMoveCommit(clipId: string, nextStart: number, nextEnd: number) {
    const next = clips.map((c) =>
      c.id === clipId ? { ...c, start: nextStart, end: nextEnd } : c
    );
    commit(next);
    const movedClip = next.find((c) => c.id === clipId);
    if (movedClip) {
      pushMind(`Moved “${movedClip.title}” to ${formatTime(nextStart)}.`);
      void api.updateClip(clipId, { start: nextStart, end: nextEnd }).catch(() => {});
    }
  }

  function splitClip(id: string) {
    const clip = clips.find((c) => c.id === id);
    if (!clip) return;
    const at = time;
    if (at <= clip.start + 0.05 || at >= clip.end - 0.05) {
      pushMind("Put the playhead inside the clip to split it.");
      return;
    }
    const baseTitle = clip.title.replace(/ · part \d+$/i, "");
    const left: Clip = {
      ...clip,
      end: at,
      title: `${baseTitle} · part 1`,
    };
    const right: Clip = {
      ...clip,
      id: uid("clip"),
      title: `${baseTitle} · part 2`,
      start: at,
      end: clip.end,
      posted: false,
      postId: undefined,
      postUrl: undefined,
      frozen: false,
    };
    commit(clips.flatMap((c) => (c.id === id ? [left, right] : [c])));
    setSelectedClipId(right.id);
    pushMind(`Split “${clip.title}” into two parts at ${formatTime(at)}.`);
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

  function makeTakeClip(start: number, end: number, label: string): Clip {
    const momentId = uid("mom");
    return {
      id: uid("clip"),
      momentId,
      videoId: video?.id ?? "take",
      title: label,
      caption: `${label}\n\nCut from the take.`,
      hashtags: ["#encore", "#shorts", "#bts"],
      tags: ["take", "encore"],
      start,
      end,
      posted: false,
    };
  }

  const takeHi = () => (takeOut > 0 ? takeOut : duration);

  function clamp(val: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, val));
  }

  function alignSegmentsToLeft(segments: TakeSegment[]): TakeSegment[] {
    if (segments.length === 0) return [];
    let currentStart = 0;
    return segments.map((seg) => {
      const srcStart = seg.sourceStart !== undefined ? seg.sourceStart : seg.start;
      const srcEnd = seg.sourceEnd !== undefined ? seg.sourceEnd : seg.end;
      const dur = Math.max(srcEnd - srcStart, 0.1);
      const updated: TakeSegment = {
        ...seg,
        start: currentStart,
        end: currentStart + dur,
        sourceStart: srcStart,
        sourceEnd: srcEnd,
      };
      currentStart += dur;
      return updated;
    });
  }

  function timelineToSourceTime(
    t: number,
    segments: TakeSegment[],
    fallbackTakeIn: number,
    fallbackTakeOut: number,
    mediaDur: number
  ): number {
    if (segments && segments.length > 0) {
      const seg =
        segments.find((s) => t >= s.start - 0.001 && t <= s.end + 0.001) ||
        (t < segments[0].start ? segments[0] : segments[segments.length - 1]);
      if (seg) {
        const srcStart = seg.sourceStart !== undefined ? seg.sourceStart : seg.start;
        const offset = Math.max(0, t - seg.start);
        return srcStart + offset;
      }
    }
    return fallbackTakeIn + t;
  }

  function sourceToTimelineTime(
    srcTime: number,
    segments: TakeSegment[],
    fallbackTakeIn: number
  ): number {
    if (segments && segments.length > 0) {
      const seg = segments.find((s) => {
        const srcStart = s.sourceStart !== undefined ? s.sourceStart : s.start;
        const srcEnd = s.sourceEnd !== undefined ? s.sourceEnd : s.end;
        return srcTime >= srcStart - 0.05 && srcTime <= srcEnd + 0.05;
      });
      if (seg) {
        const srcStart = seg.sourceStart !== undefined ? seg.sourceStart : seg.start;
        return seg.start + Math.max(0, srcTime - srcStart);
      }
    }
    return Math.max(0, srcTime - fallbackTakeIn);
  }

  function splitTake() {
    if (!video && duration <= 0 && (!takeSegments || takeSegments.length === 0)) return;
    const atTimeline = time;
    const segments =
      takeSegments.length > 0
        ? takeSegments
        : [
            {
              id: uid("take"),
              title: projectName || "Main take",
              start: 0,
              end: duration,
              sourceStart: takeIn,
              sourceEnd: takeOut > 0 ? takeOut : duration,
            },
          ];

    // Find the take segment under the playhead
    const targetSeg =
      segments.find((s) => atTimeline > s.start + 0.05 && atTimeline < s.end - 0.05) ||
      (selectedTakeId ? segments.find((s) => s.id === selectedTakeId) : segments[0]);

    if (!targetSeg || atTimeline <= targetSeg.start + 0.05 || atTimeline >= targetSeg.end - 0.05) {
      pushMind("Move the playhead inside the main take to split it.");
      return;
    }

    const srcStart = targetSeg.sourceStart !== undefined ? targetSeg.sourceStart : targetSeg.start;
    const srcEnd = targetSeg.sourceEnd !== undefined ? targetSeg.sourceEnd : targetSeg.end;
    const offsetInSeg = atTimeline - targetSeg.start;
    const srcSplit = srcStart + offsetInSeg;

    const baseTitle = targetSeg.title.replace(/ · part \d+$/i, "");
    const left: TakeSegment = {
      ...targetSeg,
      title: `${baseTitle} · part 1`,
      sourceStart: srcStart,
      sourceEnd: srcSplit,
    };
    const right: TakeSegment = {
      id: uid("take"),
      title: `${baseTitle} · part 2`,
      start: atTimeline,
      end: targetSeg.end,
      sourceStart: srcSplit,
      sourceEnd: srcEnd,
    };

    const nextSegments = segments.flatMap((s) =>
      s.id === targetSeg.id ? [left, right] : [s]
    );

    // Automatically move to the left side, aligning with the start of the timeline
    const aligned = alignSegmentsToLeft(nextSegments);
    setTakeSegments(aligned);

    const rightSegInAligned = aligned.find((s) => s.id === right.id);
    if (rightSegInAligned) {
      setSelectedTakeId(rightSegInAligned.id);
    }
    pushMind(`Split main clip at ${formatTime(atTimeline)} and aligned with timeline.`);
  }

  function handleSplit() {
    splitTake();
  }

  function handleTakeSegmentMove(takeId: string, nextStart: number, nextEnd: number) {
    setTakeSegments((prev) =>
      prev.map((s) =>
        s.id === takeId ? { ...s, start: nextStart, end: nextEnd } : s
      )
    );
  }

  function handleTakeSegmentMoveCommit(
    takeId: string,
    nextStart: number,
    nextEnd: number,
    mode?: "move" | "trim-l" | "trim-r"
  ) {
    setTakeSegments((prev) => {
      const segIndex = prev.findIndex((s) => s.id === takeId);
      if (segIndex === -1) return prev;

      const target = prev[segIndex];
      const origSourceStart =
        target.sourceStart !== undefined ? target.sourceStart : target.start;
      const origSourceEnd =
        target.sourceEnd !== undefined ? target.sourceEnd : target.end;

      let updatedTarget: TakeSegment = { ...target };

      if (mode === "trim-l") {
        const dt = nextStart - target.start;
        const newSrcStart = clamp(origSourceStart + dt, 0, origSourceEnd - 0.2);
        updatedTarget = {
          ...target,
          sourceStart: newSrcStart,
          sourceEnd: origSourceEnd,
        };
      } else if (mode === "trim-r") {
        const dt = nextEnd - target.end;
        const rawDur = mediaDuration > 0 ? mediaDuration : 999999;
        const newSrcEnd = clamp(origSourceEnd + dt, origSourceStart + 0.2, rawDur);
        updatedTarget = {
          ...target,
          sourceStart: origSourceStart,
          sourceEnd: newSrcEnd,
        };
      } else {
        // "move": horizontal repositioning
        updatedTarget = {
          ...target,
          start: nextStart,
          end: nextEnd,
        };
        return prev.map((s) => (s.id === takeId ? updatedTarget : s));
      }

      // Automatically move to the left side, aligning with the start of the timeline
      const updatedList = prev.map((s) => (s.id === takeId ? updatedTarget : s));
      const aligned = alignSegmentsToLeft(updatedList);

      const first = aligned[0];
      if (first && first.sourceStart !== undefined) {
        setTakeIn(first.sourceStart);
      }
      const last = aligned[aligned.length - 1];
      if (last && last.sourceEnd !== undefined) {
        setTakeOut(last.sourceEnd);
      }

      pushMind(`Trimmed “${updatedTarget.title}” and aligned with timeline.`);
      return aligned;
    });
  }

  function handleTakeTrim(nextIn: number, nextOut: number) {
    setTakeIn(nextIn);
    setTakeOut(nextOut);
    const dur = Math.max(nextOut - nextIn, 0.2);
    setTakeSegments((prev) => {
      if (prev.length <= 1) {
        const title = prev[0]?.title || projectName || "Main take";
        return [
          {
            id: prev[0]?.id || uid("take"),
            title,
            start: 0,
            end: dur,
            sourceStart: nextIn,
            sourceEnd: nextOut,
          },
        ];
      }
      const targetId = selectedTakeId || prev[0].id;
      const nextList = prev.map((s) =>
        s.id === targetId
          ? {
              ...s,
              sourceStart: nextIn,
              sourceEnd: nextOut,
            }
          : s
      );
      return alignSegmentsToLeft(nextList);
    });
    setTime(0);
    seek(0);
  }

  function getActivePlaybackBounds(currentTime: number): { inPoint: number; outPoint: number } {
    if (takeSegments && takeSegments.length > 0) {
      const currentSeg = takeSegments.find(
        (s) => currentTime >= s.start - 0.05 && currentTime <= s.end + 0.05
      );
      if (currentSeg) {
        return { inPoint: currentSeg.start, outPoint: currentSeg.end };
      }
      if (selectedTakeId) {
        const sel = takeSegments.find((s) => s.id === selectedTakeId);
        if (sel) return { inPoint: sel.start, outPoint: sel.end };
      }
      const minIn = Math.min(...takeSegments.map((s) => s.start));
      const maxOut = Math.max(...takeSegments.map((s) => s.end));
      return { inPoint: minIn, outPoint: maxOut };
    }

    const inPoint = takeIn;
    const outPoint = takeOut > 0 ? takeOut : duration;
    return { inPoint, outPoint };
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

  function deleteTake(takeId?: string | null) {
    if (!video && duration <= 0) return;
    const targetId = takeId || selectedTakeId;
    if (takeSegments.length > 1 && targetId) {
      setTakeSegments((prev) => {
        const next = prev.filter((s) => s.id !== targetId);
        const aligned = alignSegmentsToLeft(next);
        if (aligned.length > 0) setSelectedTakeId(aligned[0].id);
        setTime(0);
        seek(0);
        return aligned;
      });
      pushMind("Deleted take segment. Remaining clips aligned to timeline start.");
      return;
    }
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
        handleSplit();
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

  function openTakeMenu(takeId: string | null, x: number, y: number) {
    if (takeId) setSelectedTakeId(takeId);
    setMenu({ kind: "take", clipId: takeId, x, y });
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
        handleSplit();
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

  /** Publishes a cut and comes back with the verdict — the real YouTube / API path. */
  /**
   * Guarantee the clip exists on the backend with its current copy before we
   * post it. Clips the server already knows are PATCHed first, so caption/title
   * and trim edits actually ship (instead of the stale server copy); local cuts
   * from the editing tools are created from their range, so they stop 404-ing on
   * publish. Returns the server clip whose id the post endpoint will accept.
   */
  async function ensureServerClip(clip: Clip): Promise<Clip> {
    if (!video) throw new Error("Upload a take before publishing.");
    if (serverClipIds.current.has(clip.id)) {
      const patched = await api.updateClip(clip.id, {
        title: clip.title,
        caption: clip.caption,
        hashtags: clip.hashtags,
        tags: clip.tags,
        start: clip.start,
        end: clip.end,
      });
      serverClipIds.current.add(patched.id);
      return patched;
    }
    const created = await api.createClip({
      videoId: video.id,
      start: clip.start,
      end: clip.end,
      title: clip.title,
      caption: clip.caption,
      hashtags: clip.hashtags,
      tags: clip.tags,
      momentId: clip.momentId,
      label: clip.title,
    });
    serverClipIds.current.add(created.id);
    return created;
  }

  async function shipToYouTube(clip: Clip) {
    try {
      pushMind(`Posting “${clip.title}” to YouTube…`);
      const ready = await ensureServerClip(clip);
      const { postId, postUrl } = await api.postClip(ready.id);
      setClips((prev) =>
        prev.map((c) =>
          c.id === clip.id ? { ...ready, posted: true, postId, postUrl } : c,
        ),
      );
      if (selectedClipId === clip.id) setSelectedClipId(ready.id);
      setProjectStatus("posted");
      setProjectPostUrl(postUrl);
      setProjectPostId(postId);
      pushMind(
        `Posted “${clip.title}” to YouTube (${postUrl}). Checking views against your median…`,
      );

      await sleep(1800);
      const check = await api.checkPost(postId);
      setChecks((prev) => [check, ...prev]);
      setProjectStatus("checked");
      setProjectVerdict(check.verdict);
      setProjectViews(check.views);
      pushMind(
        check.verdict === "hit"
          ? `${check.views.toLocaleString()} views. Hit! That hook style goes up in the playbook.`
          : check.verdict === "flop"
            ? `${check.views.toLocaleString()} views. Flop. ${check.note}${
                check.recutHook ? ` Suggestion: ${check.recutHook}` : ""
              }`
            : `${check.views.toLocaleString()} views. Mid. ${check.note}`,
      );
      // Persist immediately so History swaps Continue → Re-cut even if they
      // leave before the debounced auto-save fires.
      try {
        const outcome = {
          status: "checked" as const,
          verdict: check.verdict,
          views: check.views,
          postUrl,
          postId,
        };
        if (projectId) {
          await api.updateProject(projectId, outcome);
        } else {
          const saved = await api.saveProject({
            name: projectName || "Untitled Take",
            videoId: video?.id || null,
            mediaUrl: mediaUrl || null,
            takeIn,
            takeOut,
            takeSegments,
            clips,
            effects: {
              rotate: previewRotate,
              flip: previewFlip,
              aspect,
              aiOn,
              compareOn,
            },
            ...outcome,
          });
          if (saved?.id) {
            setProjectId(saved.id);
            if (typeof window !== "undefined") {
              const next = new URL(window.location.href);
              next.searchParams.set("project", saved.id);
              window.history.replaceState({}, "", next.toString());
            }
          }
        }
      } catch {
        /* auto-save still has the new fields in its deps */
      }
    } catch (err: any) {
      pushMind(`Publish failed: ${err.message || err}`);
    }
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

  useEffect(() => {
    const targetId = video?.id || projectId || "notebook";
    api
      .getMessages(targetId)
      .then((history) => {
        if (history && history.length > 0) {
          setMessages(history);
        }
      })
      .catch(() => {});
  }, [video?.id, projectId]);

  async function handleSend(text: string) {
    setPrompt("");
    setMessages((prev) => [...prev, youMessage(text)]);
    const targetId = video?.id || projectId || "notebook";

    try {
      const reply = await api.sendMessage(targetId, text);
      setMessages((prev) => [...prev, reply]);
      if (!reply.pending) return;

      // A live Mind answers asynchronously: the placeholder above holds the
      // slot while we poll history for the real reply.
      const landed = await api.waitForMindReply(targetId, reply.createdAt);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === reply.id
            ? landed ?? {
                ...m,
                text: "The Mind is taking longer than usual — it will show up here when it answers.",
                pending: false,
              }
            : m,
        ),
      );
    } catch (err: any) {
      pushMind(`Failed to reach Encore Mind: ${err.message || err}`);
    }
  }

  /* ---- Transport ---- */

  // On-timeline length equals the real media time: once the file's metadata is
  // in we trust the media clock; before that we fall back to the take's own
  // stored duration so the beats still lay out.
  const duration = mediaDuration > 0 ? mediaDuration : video?.duration ?? 0;

  // Active timeline duration: spans exactly the trimmed active media so the timeline
  // ruler never includes the untrimmed portion!
  const activeTimelineDuration = useMemo(() => {
    if (takeSegments && takeSegments.length > 0) {
      return Math.max(
        takeSegments.reduce((acc, s) => Math.max(acc, s.end), 0),
        0.1,
      );
    }
    if (takeOut > 0) {
      return Math.max(takeOut - takeIn, 0.1);
    }
    return duration;
  }, [takeSegments, takeIn, takeOut, duration]);

  const seek = useCallback(
    (timelineSeconds: number) => {
      const el = mediaRef.current;
      const bounded = Math.max(0, Math.min(timelineSeconds, activeTimelineDuration));
      setTime(bounded);
      if (el && mediaDuration > 0) {
        const srcTime = timelineToSourceTime(
          bounded,
          takeSegments,
          takeIn,
          takeOut,
          mediaDuration,
        );
        el.currentTime = Math.min(Math.max(0, srcTime), mediaDuration);
      }
    },
    [activeTimelineDuration, takeSegments, takeIn, takeOut, mediaDuration],
  );

  const togglePlay = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (el.paused) {
      if (time >= activeTimelineDuration - 0.05 || time < 0) {
        const startSrc = timelineToSourceTime(0, takeSegments, takeIn, takeOut, mediaDuration);
        el.currentTime = startSrc;
        setTime(0);
      } else {
        const curSrc = timelineToSourceTime(time, takeSegments, takeIn, takeOut, mediaDuration);
        if (Math.abs(el.currentTime - curSrc) > 0.08) {
          el.currentTime = curSrc;
        }
      }
      void el.play();
    } else {
      el.pause();
    }
  }, [time, activeTimelineDuration, takeSegments, takeIn, takeOut, mediaDuration]);

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
      handleSplit();
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
  const aspectMeta = ASPECTS.find((item) => item.id === aspect) ?? ASPECTS[0];
  const hasTake = Boolean(mediaUrl || video || takeSegments.length > 0);

  function cycleAspect() {
    const index = ASPECTS.findIndex((item) => item.id === aspect);
    const next = ASPECTS[(index + 1) % ASPECTS.length] ?? ASPECTS[0];
    setAspect(next.id);
  }

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
          <span
            className="cut__autosave"
            style={{
              fontSize: "0.72rem",
              color:
                saveStatus === "saving"
                  ? "#eab308"
                  : saveStatus === "saved"
                    ? "#22c55e"
                    : "#64748b",
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              marginLeft: "8px",
              fontWeight: 500,
              opacity: saveStatus === "idle" ? 0.4 : 1,
              transition: "opacity 0.2s, color 0.2s",
            }}
            title={
              saveStatus === "saving"
                ? "Saving edits to history..."
                : "All options and edits saved to history"
            }
          >
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background:
                  saveStatus === "saving"
                    ? "#eab308"
                    : saveStatus === "saved"
                      ? "#22c55e"
                      : "#64748b",
                display: "inline-block",
              }}
            />
            {saveStatus === "saving"
              ? "Auto-saving..."
              : saveStatus === "saved"
                ? "Saved to history"
                : "Auto-save active"}
          </span>
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

      <ToolRail
        tool={tool}
        counts={{
          moments: moments.filter((m) => m.status === "pending").length,
          cuts: clips.length,
        }}
        onTool={setTool}
      />

      <ToolPanel
        tool={tool}
        video={video}
        busy={busy}
        moments={moments}
        clips={clips}
        messages={messages}
        selectedClipId={selectedClipId}
        prompt={prompt}
        onPrompt={setPrompt}
        onSend={handleSend}
        onReset={handleReset}
        onPickClip={setSelectedClipId}
        onClipChange={handleClipChange}
        onClipContext={openMenu}
        onSeek={seek}
        onRecut={handleRecut}
        onDecideMoment={handleDecideMoment}
        onToolChange={setTool}
      />

      <section className="cut__stage" aria-label="Preview and timeline" ref={stageRef}>
        <div
          className="cut__monitor"
          ref={monitorRef}
          onContextMenu={(event) => {
            if (!video) return;
            event.preventDefault();
            openTakeMenu(selectedTakeId, event.clientX, event.clientY);
          }}
        >
          <div
            className="cut__frame"
            style={{ "--ar": aspectMeta.n } as CSSProperties}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest(".cut__empty-hit")) return;
              cycleAspect();
            }}
            title="Click to change aspect ratio"
          >
            {mediaUrl ? (
              <video
                ref={mediaRef}
                src={mediaUrl}
                playsInline
                style={{
                  transform: `rotate(${previewRotate}deg) scaleX(${
                    previewFlip ? -1 : 1
                  })`,
                }}
                onLoadedMetadata={(event) => {
                  const el = event.currentTarget;
                  const dur = el.duration || 0;
                  setMediaDuration(dur);
                  const at = resumePlayhead.current;
                  if (at != null && at > 0 && dur > 0) {
                    const src = timelineToSourceTime(
                      at,
                      takeSegments,
                      takeIn,
                      takeOut,
                      dur,
                    );
                    el.currentTime = Math.min(Math.max(0, src), dur);
                    setTime(at);
                    resumePlayhead.current = null;
                  }
                }}
                onTimeUpdate={(event) => {
                  const el = event.currentTarget;
                  const srcCurrent = el.currentTime;
                  const t = sourceToTimelineTime(srcCurrent, takeSegments, takeIn);
                  setTime(t);

                  if (!el.paused && t >= activeTimelineDuration - 0.03) {
                    el.pause();
                    const endSrc = timelineToSourceTime(
                      activeTimelineDuration,
                      takeSegments,
                      takeIn,
                      takeOut,
                      mediaDuration,
                    );
                    el.currentTime = endSrc;
                    setTime(activeTimelineDuration);
                    setPlaying(false);
                  }
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onError={() => {
                  pushMind(
                    "Couldn't load the saved take. Re-upload it from the Take panel to keep editing.",
                  );
                }}
              />
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
                {hasTake ? (
                  <div className="cut__empty-hit" aria-live="polite">
                    <strong>{projectName === "Opening…" ? "Opening project" : projectName}</strong>
                    <span className="cut__empty-sub">Loading your take…</span>
                  </div>
                ) : (
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
                )}
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
            {compareOn && mediaUrl ? (
              <span className="cut__compare" aria-hidden="true" />
            ) : null}
          </div>

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
          canEdit={!!video || !!mediaUrl}
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
          duration={activeTimelineDuration}
          mediaDuration={mediaDuration > 0 ? mediaDuration : video?.duration ?? 0}
          time={time}
          takeName={hasTake && projectName !== "Opening…" ? projectName : null}
          takeIn={takeIn}
          takeOut={takeOut > 0 ? takeOut : duration}
          takeSegments={takeSegments}
          selectedTakeId={selectedTakeId}
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
          onPickTakeSegment={(id) => {
            setSelectedTakeId(id);
            setTool("take");
          }}
          onClipContextMenu={openMenu}
          onTakeContextMenu={openTakeMenu}
          onTakeTrim={handleTakeTrim}
          onTakeSegmentMove={handleTakeSegmentMove}
          onTakeSegmentMoveCommit={handleTakeSegmentMoveCommit}
          onClipMove={handleClipMove}
          onClipMoveCommit={handleClipMoveCommit}
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
