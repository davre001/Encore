"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Pencil, Plus } from "lucide-react";
import EditorActions, {
  type ExportTarget,
} from "@/components/editor/EditorActions";
import Timeline from "@/components/editor/Timeline";
import ToolPanel from "@/components/editor/ToolPanel";
import ToolRail, { type ToolId } from "@/components/editor/ToolRail";
import TransportBar, {
  type AiPermissionMode,
  type TransportEdit,
} from "@/components/editor/TransportBar";
import ClipContextMenu, {
  type ClipMenuAction,
} from "@/components/editor/ClipContextMenu";
import type {
  AnalysisStatus,
  CaptionLanguage,
  CaptionTrack,
  Clip,
  Message,
  Moment,
  PostCheck,
  ProjectState,
  TakeSegment,
  Video,
} from "@/types";
import { WORKFLOW_STEPS, analysisStageLabel, workflowIndex } from "@/lib/studioAssets";
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

/** Thread for a chat typed before this session has a project to belong to.
 *
 * Opening /editor cold is the normal way to start: there is no project row yet,
 * so there is no thread yet either. The Mind still answers — and the reply is
 * filed under here — but nothing ever loads this thread back, which is what
 * keeps a fresh editor from opening on somebody else's conversation. */
const PRE_PROJECT_THREAD = "notebook";
const STOPPED_ACTION_PREFIX = "encore.stoppedAction.";

function stoppedActionKey(id: string | null | undefined) {
  return `${STOPPED_ACTION_PREFIX}${id || PRE_PROJECT_THREAD}`;
}

const UNPROMPTED_MIND_LINES = new Set([
  "I am preparing the video, reading the audio, and looking for beats that stand alone.",
  "Regenerating moments from the video.",
  "This browser cannot list installed fonts. Showing web-safe fonts.",
  "Font permission was not granted, so Encore kept the default font list.",
  "Put the playhead inside the clip to split it.",
  "Move the playhead inside the main take to split it.",
  "Move the playhead further into the take before trimming the left side.",
  "Move the playhead earlier in the take before trimming the right side.",
  "Move the playhead further into the selected take segment before trimming left.",
  "Move the playhead earlier in the selected take segment before trimming right.",
  "Not enough tape left here to cut a clip.",
  "Drag the highlighted edges of the take on the timeline to trim its in and out points.",
  "That cut is live — recut it to change the hook.",
]);

/** Lines the editor used to write on its own, with nobody having typed in Mind.
 *
 * A Keep/Skip, a trim that couldn't run, a font-list failure — the panel or the
 * control already shows the outcome, and these were filed into the thread
 * anyway, then reloaded with the project. The posted-link reply is not in here:
 * that one is the notice the creator asked to keep. */
function isUnpromptedChatLine(message: Message): boolean {
  const text = message.text.trim();
  if (message.role === "you") {
    return /^Export ".+" to device$/.test(text) || /^Share “.+” to YouTube$/.test(text);
  }
  if (message.role !== "mind") return false;
  if (UNPROMPTED_MIND_LINES.has(text)) return true;
  return (
    /^Kept “.+”\. Cut created in Cuts\.$/.test(text) ||
    /^Skipped “.+”\.$/.test(text) ||
    /^Failed to (accept|reject) moment:/.test(text) ||
    /^Upload failed:/.test(text) ||
    /^Couldn't remove /.test(text) ||
    /^“.+” is already live\. Recut it to ship a new open\.$/.test(text)
  );
}

/** Union of a server thread and the messages already on screen, oldest first.
 *
 * Only ever used when the server's copy is the *same* thread that is already
 * open; the loader replaces outright when the project changes. Within one
 * thread a bare replace still loses things: the "Posted … watch it here: <url>"
 * line is pushed the moment YouTube answers, and a reload that replaced the list
 * would wipe the only copy of the link off the screen. `ensureProject` is what
 * makes merging the right answer here — it guarantees that line was written
 * under the very thread the loader goes on to read.
 *
 * The server is authoritative, so its rows are kept verbatim — including a
 * genuine repeat of the same text. A local message is only dropped when the
 * server already holds that same role+text, which is the expected case for a
 * message that was pushed optimistically and has since been persisted. Matching
 * on the timestamp as well would not work: the server stamps its own
 * `int(time.time() * 1000)`, so the two copies never agree on a value.
 * Unprompted editor lines are dropped from both sides, so a "Kept …" that was
 * already saved does not come back when the project reopens.
 */
function mergeHistory(local: Message[], server: Message[]): Message[] {
  const kept = server.filter((message) => !isUnpromptedChatLine(message));
  const onServer = new Set(kept.map((message) => `${message.role}|${message.text}`));
  const out = [...kept];
  for (const message of local) {
    if (isUnpromptedChatLine(message)) continue;
    if (onServer.has(`${message.role}|${message.text}`)) continue;
    out.push(message);
  }
  return out.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
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

const ASPECTS: { id: string; label: string; ratio: string; n: number }[] = [
  { id: "16:9", label: "16:9", ratio: "16 / 9", n: 16 / 9 },
  { id: "9:16", label: "9:16", ratio: "9 / 16", n: 9 / 16 },
  { id: "4:3", label: "4:3", ratio: "4 / 3", n: 4 / 3 },
  { id: "1:1", label: "1:1", ratio: "1 / 1", n: 1 },
  { id: "4:5", label: "4:5", ratio: "4 / 5", n: 4 / 5 },
  { id: "21:9", label: "21:9", ratio: "21 / 9", n: 21 / 9 },
];

const CAPTION_LANGUAGE_LABELS: Record<CaptionLanguage, string> = {
  en: "English",
  fr: "French",
  es: "Spanish",
  pt: "Portuguese",
  de: "German",
  it: "Italian",
  ar: "Arabic",
  hi: "Hindi",
};

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

function captionWords(text: string): string[] {
  return text
    .replace(/#[\w-]+/g, "")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildCaptionSegments(
  clip: Clip,
  language: CaptionLanguage,
): CaptionTrack["segments"] {
  const words = captionWords(clip.caption || clip.title || "Caption");
  const chunkSize = 4;
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize).join(" "));
  }
  const lines = chunks.length > 0 ? chunks : [clip.title || "Caption"];
  const span = Math.max(clip.end - clip.start, 0.5);
  const step = span / lines.length;
  return lines.map((text, index) => ({
    id: uid("capseg"),
    start: clip.start + step * index,
    end: index === lines.length - 1 ? clip.end : clip.start + step * (index + 1),
    text: language === "en" ? text : `[${CAPTION_LANGUAGE_LABELS[language]}] ${text}`,
  }));
}

function isMomentRegenerationPrompt(text: string) {
  const lower = text.toLowerCase();
  if (lower.trim() === "/redo") return true;
  return (
    /\b(retry|rerun|re-run|regenerate|redo|refresh)\b/.test(lower) &&
    /\b(moment|moments|beat|beats|cut|cuts)\b/.test(lower)
  );
}

function parsePermissionCommand(text: string): "auto" | "ask" | "help" | null {
  const lower = text.trim().toLowerCase();
  if (!lower.startsWith("/permissions")) return null;
  if (/\b(auto|auto-approve|approve)\b/.test(lower)) return "auto";
  if (/\b(manual|ask|permission)\b/.test(lower)) return "ask";
  return "help";
}

function parseTimeInput(value: string): number | null {
  const clean = value.trim();
  if (!clean) return null;
  if (!clean.includes(":")) {
    const seconds = Number(clean);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  }
  const parts = clean.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function parseCutCommand(text: string): { start: number; end: number } | null {
  const lower = text.trim().toLowerCase();
  const asksForCut = lower.startsWith("/cut") || /\b(create|make|add)\b.*\bcut\b/.test(lower);
  if (!asksForCut) return null;
  const range = lower.match(/(?:from\s+)?(\d+(?::\d+){0,2}(?:\.\d+)?)\s*(?:-|to|until|through)\s*(\d+(?::\d+){0,2}(?:\.\d+)?)/);
  if (!range) return null;
  const start = parseTimeInput(range[1]);
  const end = parseTimeInput(range[2]);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

function isPublishPrompt(text: string) {
  const lower = text.trim().toLowerCase().replace(/[.!?]+$/, "");
  if (lower === "/publish" || lower === "/post") return true;
  if (/^(please\s+)?(post|publish|upload|share)( it| this| that)?$/.test(lower)) return true;
  // "publish my cut" never used to match, because the old check demanded the
  // word YouTube. Naming a cut, a clip, or YouTube is enough.
  return (
    /\b(post|publish|upload|share)\b/.test(lower) &&
    /\b(youtube|short|shorts|cut|clip)\b/.test(lower)
  );
}

/** The creator asked to find or rank beats, not only to post a cut they already have. */
function asksToBuildBeforePosting(text: string) {
  const lower = text.trim().toLowerCase();
  return (
    /\b(best|strongest)\b/.test(lower) ||
    /\b(create|make|find|detect|accept|keep|load)\b.*\b(moment|moments|beat|beats)\b/.test(lower)
  );
}

function isYes(text: string) {
  return /^(yes|yeah|yep|yup|do it|go ahead|ok|okay|sure|confirm)\b/i.test(text.trim());
}

function isNo(text: string) {
  return /^(no|nope|don't|dont|cancel|stop)\b/i.test(text.trim());
}

function isDonePrompt(text: string) {
  const lower = text.trim().toLowerCase().replace(/[.!?]+$/, "");
  return /^(done|selected|i selected it|ive selected it|i've selected it|picked it|i picked it|ok|okay|ready)$/.test(lower);
}

function isPleaseFollowup(text: string) {
  const lower = text.trim().toLowerCase().replace(/[.!?]+$/, "");
  return /^(pls|plz|please|please do|do it please|post it please|publish it please)$/.test(lower);
}

function isCreateMomentsPrompt(text: string) {
  const lower = text.trim().toLowerCase();
  return (
    lower === "/moments" ||
    lower === "/cuts" ||
    /\b(moment|moments|beat|beats)\b.*\b(hit|hits|strong|strongest|best|viral|hook|hooks|highlight|highlights)\b/.test(lower) ||
    /\b(hit|hits|strong|strongest|best|viral|hook|hooks|highlight|highlights)\b.*\b(moment|moments|beat|beats)\b/.test(lower) ||
    /\b(find|scan|detect|analy[sz]e|pull|pick)\b.*\b(moment|moments|beat|beats|hook|hooks|highlight|highlights)\b/.test(lower) ||
    /\b(load|create|make|add|accept|keep|turn)\b.*\b(moment|moments|beat|beats)\b.*\b(timeline|cut|cuts|clip|clips)?\b/.test(lower) ||
    /\b(create|make|add)\b.*\b(best|strongest)\b.*\b(cut|cuts|clip|clips|moment|moments)\b/.test(lower)
  );
}

function isStartWorkPrompt(text: string) {
  const lower = text.trim().toLowerCase().replace(/[.!?]+$/, "");
  return (
    lower === "start" ||
    lower === "yes start" ||
    lower === "start now" ||
    /^(yes|yeah|yep|yup|ok|okay|sure|go ahead|do it)\s+(start|begin|scan|analyze|analyse|find|detect)\b/.test(lower) ||
    /^(start|begin|scan|analyze|analyse|find|detect)\b.*\b(video|take|moments|beats|hooks|highlights)?\b/.test(lower)
  );
}

function isCaptionPrompt(text: string) {
  const lower = text.trim().toLowerCase();
  return lower === "/captions" || /\b(add|create|generate|make)\b.*\b(caption|captions|subtitles|cc)\b/.test(lower);
}

/** Whether a chat message actually names subtitles.
 *
 * The verb-free check matters for post requests: "post it to YouTube" and "post
 * it with captions" both route to the same action, and only the second one wants
 * a caption layer. Matching the noun alone is what tells them apart.
 */
function asksForCaptions(text: string) {
  return /\b(caption|captions|subtitles|cc)\b/i.test(text);
}

function wantsFullAutoPost(text: string) {
  const lower = text.trim().toLowerCase();
  return (
    isPublishPrompt(text) ||
    /\b(create|make|cut|load|accept|keep)\b.*\b(moment|moments|cut|cuts|clip|clips)\b.*\b(post|publish|upload|share)\b/.test(lower) ||
    /\b(post|publish|upload|share)\b.*\b(best|strongest)\b.*\b(moment|cut|clip)\b/.test(lower)
  );
}

/** Whether a chat message is asking to pick interrupted work back up.
 *
 * This has to be caught before the generic chat fallback. "Continue" used to be
 * handed straight to the Mind, which had no way to act on it: it read the
 * context, answered "Processing the remaining 3 moments", and no code ran at
 * all. Resuming is a control command like /permissions, so the editor handles it
 * itself rather than asking a language model to describe work it cannot start.
 *
 * Anchored to the start of the message so a passing "continue" mid-sentence
 * ("then continue cutting from 12s") still reaches the ordinary routing.
 */
function isResumePrompt(text: string) {
  const lower = text.trim().toLowerCase().replace(/[.!?]+$/, "");
  return (
    lower === "/resume" ||
    lower === "/continue" ||
    /^(resume|continue|carry on|keep going|go on|pick up)\b/.test(lower) ||
    /^where (were we|did we|are we)\b/.test(lower)
  );
}

function timedOutAnalysisStatus(videoId: string): AnalysisStatus {
  return {
    videoId,
    stage: "error",
    message:
      "The video AI is still working. If this keeps going, retry moments or use a shorter/lower-resolution clip.",
    errorType: "timeout",
    updatedAt: Date.now(),
    done: true,
  };
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
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus | null>(null);
  const [moments, setMoments] = useState<Moment[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  // Ids the backend knows about (from decide→listClips, or created at publish).
  // Anything not in here is a local-only cut that must be created before it can
  // be posted; anything in here gets its edits PATCHed at publish time.
  const serverClipIds = useRef<Set<string>>(new Set<string>());
  const [checks, setChecks] = useState<PostCheck[]>([]);
  // Starts empty. The thread answers what the creator asked, so an opening line
  // nobody prompted is the first thing that rule has to silence.
  const [messages, setMessages] = useState<Message[]>([]);

  const [tool, setTool] = useState<ToolId>("take");
  const [panelOpen, setPanelOpen] = useState(true);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [regeneratingMoments, setRegeneratingMoments] = useState(false);
  // Progress for work the backend cannot report (cutting, captioning,
  // publishing). Analysis phases come from analysisStatus instead, and every
  // action clears this in a finally so a finished bar never lingers on screen.
  const [actionProgress, setActionProgress] = useState<{ label: string; percent: number } | null>(null);
  const [actionStopped, setActionStopped] = useState(false);
  const stoppedActionRef = useRef(false);
  const rejoinAnalysisRef = useRef<string | null>(null);
  const autoResumeRef = useRef<string | null>(null);
  const [stamp, setStamp] = useState("");

  // Clip editing: a one-slot clipboard for copy/cut/paste and a linear
  // undo/redo history over the structural clip operations.
  const [clipboard, setClipboard] = useState<Clip | null>(null);
  const [past, setPast] = useState<Clip[][]>([]);
  const [future, setFuture] = useState<Clip[][]>([]);
  const [takePast, setTakePast] = useState<TakeSegment[][]>([]);
  const [takeFuture, setTakeFuture] = useState<TakeSegment[][]>([]);
  const [menu, setMenu] = useState<MenuState | null>(null);

  // Take-level edit state: multiple take segments (from splitting the main clip),
  // trimmed in/out, plus a pulse that flags trim handles.
  const [takeSegments, setTakeSegments] = useState<TakeSegment[]>([]);
  const [selectedTakeId, setSelectedTakeId] = useState<string | null>(null);
  const [takeIn, setTakeIn] = useState(0);
  const [takeOut, setTakeOut] = useState(0);
  const [trimPulse, setTrimPulse] = useState(false);
  const [captionTracks, setCaptionTracks] = useState<CaptionTrack[]>([]);
  const [selectedCaptionTrackId, setSelectedCaptionTrackId] = useState<string | null>(null);
  // What Delete acts on. A take, a cut, and a text layer can all be "selected"
  // at once, and the last one the user clicked is the only one Delete removes.
  const [selection, setSelection] = useState<"take" | "clip" | "caption" | null>(null);
  const [fontChoices, setFontChoices] = useState<string[]>([
    "Inter",
    "Arial",
    "Georgia",
    "Impact",
    "Montserrat",
    "Poppins",
    "Roboto",
  ]);

  // View toggles that live on the transport bar.
  const [aiOn, setAiOn] = useState(false);
  const [aiPermissionMode, setAiPermissionMode] =
    useState<AiPermissionMode>("ask");
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
  // Bumped when a load is abandoned (the creator imported a video before the
  // saved project arrived). A late response must not paint over that new take.
  const projectLoadToken = useRef(0);
  const projectIdRef = useRef<string | null>(null);
  const resumePlayhead = useRef<number | null>(null);
  // Which project the messages on screen came from, so the loader can tell a
  // reload of the current thread (merge) from a move to another one (replace).
  const openThread = useRef<string | null>(null);
  // Manual mode asked before running the auto-approve pipeline. The next reply
  // is yes or no to that question, not a new instruction.
  const pendingManualConfirm = useRef<string | null>(null);
  const pendingSelectedPublish = useRef<string | null>(null);

  /** The chat thread this session talks into: the project, and only the project.
   *
   * Keying the thread by anything else is what let projects mix. It used to be
   * `video?.id || projectId || "notebook"`, so a project that had a take wrote
   * under the video while one that did not wrote under the project, a re-cut
   * kept writing into the thread of the project it was cut from, and the loader
   * merged whatever came back into whatever was already on screen. One project,
   * one thread — and a project that has just been created reads an empty one.
   */
  const threadId = projectId ?? PRE_PROJECT_THREAD;
  projectIdRef.current = projectId;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stopped = window.localStorage.getItem(stoppedActionKey(projectId)) === "1";
    stoppedActionRef.current = stopped;
    setActionStopped(stopped);
  }, [projectId]);
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
    const token = ++projectLoadToken.current;
    api
      .getProject(qProject)
      .then((proj) => {
        if (!mounted || !proj || token !== projectLoadToken.current) return;
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
          if (proj.effects.captionTracks) {
            setCaptionTracks(proj.effects.captionTracks);
            setSelectedCaptionTrackId(proj.effects.captionTracks[0]?.id ?? null);
          }
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
          api
            .listClips(proj.videoId)
            .then((found) => {
              if (!mounted || !found) return;
              setClips(found);
              serverClipIds.current = new Set(found.map((clip) => clip.id));
              setSelectedClipId(found[0]?.id ?? null);
            })
            .catch(() => {});
          api
            .getAnalysisStatus(proj.videoId)
            .then((status) => {
              if (mounted && status) setAnalysisStatus(status);
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
        if (mounted && token === projectLoadToken.current) {
          window.setTimeout(() => {
            isInitialLoad.current = false;
          }, 600);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  /** The project row for the state on screen, minus its id.
   *
   * One builder for every writer — auto-save, the first save of a new project,
   * and publishing — because when they disagreed a project could be stored with
   * the wrong clips, or with no video at all.
   *
   * `overrides` is spread last so a caller can swap in what it knows better:
   * publishing passes the clips it has just marked posted, plus the outcome
   * fields that only exist once YouTube has answered.
   */
  function projectPayload(overrides: Partial<ProjectState> = {}) {
    return {
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
        aiPermissionMode,
        compareOn,
        captionTracks,
      },
      ...overrides,
    };
  }

  /** Make sure this session has a project row, and return its id.
   *
   * The chat thread is the project, so a write that lands before the project
   * exists is filed under the pre-project key and disappears from the thread the
   * moment a real id arrives and the loader swaps to it — which is exactly how
   * the "Posted … watch it here" link got lost. Uploading and publishing both
   * call this first.
   *
   * `overrides` exists for the upload path, which calls this the instant the
   * server returns a video id that the state above has not rendered yet.
   */
  async function ensureProject(
    overrides: Partial<ProjectState> = {},
  ): Promise<string | null> {
    const existingId = projectIdRef.current;
    if (existingId) {
      // A project created from chat has no video yet. The first upload has to
      // write its name and video onto that row, or the title stays "Untitled"
      // and a later reload shows the old name next to the new take.
      if (Object.keys(overrides).length > 0) {
        await api.updateProject(existingId, overrides).catch(() => null);
      }
      return existingId;
    }
    try {
      const saved = await api.saveProject(projectPayload(overrides));
      if (!saved?.id) return null;
      projectIdRef.current = saved.id;
      setProjectId(saved.id);
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("project", saved.id);
        window.history.replaceState({}, "", url.toString());
      }
      return saved.id;
    } catch {
      // Publishing and uploading both carry on: a project that could not be
      // saved yet is one the debounced auto-save will try again.
      return null;
    }
  }

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
        const res = await api.saveProject({ id: projectId || undefined, ...projectPayload() });
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
    aiPermissionMode,
    compareOn,
    captionTracks,
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

  useEffect(() => {
    api
      .getAiSettings()
      .then((settings) => setAiPermissionMode(settings.aiPermissionMode))
      .catch(() => {});
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

  function errorText(prefix: string, err: unknown) {
    const raw = err instanceof Error ? err.message : String(err || "Unknown error");
    const lower = raw.toLowerCase();
    if (
      lower.includes("failed to fetch") ||
      lower.includes("networkerror") ||
      lower.includes("load failed") ||
      lower.includes("internet disconnected") ||
      lower.includes("connection")
    ) {
      return `${prefix}: Connection error. Check your internet connection and try again.`;
    }
    if (lower.includes("econnrefused") || lower.includes("unable to connect")) {
      return `${prefix}: Unable to reach Encore API. Make sure the backend is running and try again.`;
    }
    if (lower.includes("api error")) {
      return `${prefix}: ${raw}`;
    }
    if (lower.includes("the video ai could not finish this analysis")) {
      return `${prefix}: API error while analyzing the video. Try again when the connection is stable.`;
    }
    return `${prefix}: ${raw}`;
  }

  function showStatus(text: string) {
    setStatusText(text);
  }
  const pushMind = useCallback((text: string, persist = true) => {
    setStatusText(null);
    setMessages((prev) => [...prev, mindMessage(text)]);
    if (!persist) return;
    void api.saveEditorEvent(threadId, text).catch(() => {});
  }, [threadId]);

  async function setPermissionMode(mode: AiPermissionMode, announce = false) {
    setAiPermissionMode(mode);
    // Persist every change so the stored mode can never drift away from what the
    // toolbar shows — a stale stored value is what used to flip this back.
    await api.updateAiSettings(mode).catch(() => null);
    if (announce) {
      pushMind(
        mode === "auto"
          ? "Permission mode set to Auto approve.\n\nI will accept the strongest moments and prepare the best cut automatically after analysis."
          : "Permission mode set to Ask every time.\n\nI will wait for you to approve moments and posting actions.",
      );
    }
    if (mode === "auto" && moments.some((moment) => moment.status === "pending") && !busy) {
      void autoApproveMoments(moments);
    }
  }

  /* ---- Take ---- */

  async function handleUpload(file: File) {
    const importedName = stem(file.name) || "Untitled";
    // The saved project had not finished opening, so this import is a new
    // project. Applying the late load afterwards is what put the old take on
    // the timeline under the new file's name.
    if (isInitialLoad.current) {
      projectLoadToken.current += 1;
      isInitialLoad.current = false;
      projectIdRef.current = null;
      setProjectId(null);
      if (typeof window !== "undefined") {
        const next = new URL(window.location.href);
        next.searchParams.delete("project");
        window.history.replaceState({}, "", next.toString());
      }
    }
    clearStoppedAction();
    setBusy(true);
    setAnalysisStatus({
      videoId: "pending",
      stage: "queued",
      message: "Preparing upload.",
      updatedAt: Date.now(),
      done: false,
    });
    setMoments([]);
    setClips([]);
    serverClipIds.current.clear();
    setChecks([]);
    setSelectedClipId(null);
    setMenu(null);
    setClipboard(null);
    setPast([]);
    setFuture([]);
    setTakePast([]);
    setTakeFuture([]);
    setCaptionTracks([]);
    setSelectedCaptionTrackId(null);
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
    setProjectName(importedName);
    setSelection("take");
    // Nothing is said here. An upload is a file being handed over, not a
    // question: "Uploaded take.mp4" was the creator's own line put in their
    // mouth by the editor, and "Uploading video and detecting standout moments…"
    // was the AI narrating a job the progress bar already reports. The panel
    // switches to Moments by itself when the beats land.
    setTool("moments");

    try {
      // 1. Upload to backend
      const nextVideo = await api.uploadVideo(file);
      setVideo(nextVideo);
      setAnalysisStatus({
        videoId: nextVideo.id,
        stage: "uploaded",
        message: "Upload complete. Preparing analysis.",
        updatedAt: Date.now(),
        done: false,
      });
      if (nextVideo.duration > 0) {
        setTakeOut(nextVideo.duration);
      }

      // Give the take a project of its own now that it has a video, so the
      // thread below belongs to this project and not to whatever was open
      // before. Deferring it to the debounced auto-save left a window where
      // analysis-time messages were filed under the pre-project key and then
      // vanished when the project id landed.
      await ensureProject({
        name: importedName,
        videoId: nextVideo.id,
        mediaUrl: api.videoFileUrl(nextVideo.id),
      });

      // 2. Poll for moments (propose_moments runs in a FastAPI background task).
      // Real Whisper on a genuinely long take can run well past a minute, so
      // give it room before declaring the tape momentless.
      let foundMoments: Moment[] = [];
      let latestStatus: AnalysisStatus | null = null;
      const startTime = Date.now();
      const timeoutMs = 420_000;
      while (Date.now() - startTime < timeoutMs) {
        await sleep(1000);
        if (stoppedActionRef.current) return;
        const status = await api.getAnalysisStatus(nextVideo.id).catch(() => null);
        if (status) {
          latestStatus = status;
          setAnalysisStatus(status);
        }
        foundMoments = await api.listMoments(nextVideo.id);
        if (foundMoments && foundMoments.length > 0) {
          break;
        }
        if (status?.done) {
          break;
        }
      }
      if (foundMoments.length === 0 && latestStatus && !latestStatus.done) {
        latestStatus = {
          ...latestStatus,
          stage: "error",
          message:
            "The video AI is still working. If this keeps going, retry moments or use a shorter/lower-resolution clip.",
          errorType: "timeout",
          updatedAt: Date.now(),
          done: true,
        };
        setAnalysisStatus(latestStatus);
      }

      setMoments(foundMoments);
      setBusy(false);

      if (foundMoments.length > 0) {
        // Use the mode the toolbar is showing. Re-reading it from the server here
        // is what used to silently flip "Ask every time" back to auto-approve.
        if (aiPermissionMode === "auto") {
          // No label here, and no chat line per accept. autoApproveMoments moves
          // the progress loader itself; a percent set before it would only jump
          // backwards.
          await autoApproveMoments(foundMoments);
        }
        // Ask mode announces nothing on purpose. The panel has already switched
        // to Moments with Keep and Skip sitting on every beat, and that is the
        // prompt — a chat line restating it is noise nobody asked for.
      } else {
        const finalStatus =
          latestStatus?.done
            ? latestStatus
            : await api.getAnalysisStatus(nextVideo.id).catch(() => null);
        if (finalStatus) setAnalysisStatus(finalStatus);
        // Silent for the same reason: the status line already reports that no
        // moments surfaced, so this was the same sentence in two places.
      }
    } catch (err: any) {
      setBusy(false);
      setAnalysisStatus({
        videoId: video?.id ?? "unknown",
        stage: "error",
        message: `Upload failed: ${err.message || err}`,
        errorType: "network",
        updatedAt: Date.now(),
        done: true,
      });
      // The status line already says the upload failed. A chat line here is the
      // editor talking about a job nobody asked it to narrate.
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
      }
      // No chat line. Keep and Skip are buttons, not a prompt, and the Moments
      // row already flips to Kept / Skipped (and "Cut created in Cuts"). Writing
      // it here is what put “Kept “…”. Cut created in Cuts.” in the thread.
    } catch {
      // Leave the row as it was. A failed decision stays pending, which is the
      // signal to try again — not a message in Mind.
    }
  }

  /** Strongest first - the detector scores each beat 0-100; unranked rows keep order. */
  function rankMoments(candidates: Moment[]): Moment[] {
    return [...candidates].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }

  function overlapSeconds(a: { start: number; end: number }, b: { start: number; end: number }) {
    return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  }

  function momentForClip(clip: Clip, candidateMoments: Moment[]): Moment | null {
    const direct = candidateMoments.find((moment) => moment.id === clip.momentId);
    if (direct) return direct;

    let best: { moment: Moment; overlap: number } | null = null;
    for (const moment of candidateMoments) {
      const overlap = overlapSeconds(clip, moment);
      const clipDuration = Math.max(0.1, clip.end - clip.start);
      const momentDuration = Math.max(0.1, moment.end - moment.start);
      const coverage = overlap / Math.min(clipDuration, momentDuration);
      if (coverage < 0.55) continue;
      if (!best || overlap > best.overlap) best = { moment, overlap };
    }
    return best?.moment ?? null;
  }

  /**
   * Pick the actual strongest cut, not the first cut in the array. The main
   * signal is the detector's 0-100 moment score. If an older/local clip lost its
   * momentId, match by timestamp overlap before falling back to order.
   */
  function pickBestClip(candidateClips: Clip[], candidateMoments: Moment[]): Clip | null {
    const originalIndex = new Map(candidateClips.map((clip, index) => [clip.id, index]));
    const scoreFor = (clip: Clip) => momentForClip(clip, candidateMoments)?.score ?? 0;
    const ranked = [...candidateClips].sort((a, b) => {
      if (a.posted !== b.posted) return a.posted ? 1 : -1;
      const scoreDelta = scoreFor(b) - scoreFor(a);
      if (Math.abs(scoreDelta) > 0.01) return scoreDelta;
      const durationDelta = (b.end - b.start) - (a.end - a.start);
      if (Math.abs(durationDelta) > 0.01) return durationDelta;
      return (originalIndex.get(a.id) ?? 0) - (originalIndex.get(b.id) ?? 0);
    });
    return ranked[0] ?? null;
  }

  async function autoApproveMoments(nextMoments: Moment[]) {
    const pending = rankMoments(
      nextMoments.filter((moment) => moment.status === "pending"),
    ).slice(0, 3);
    const vidId = video?.id || nextMoments[0]?.videoId;
    if (!pending.length && !vidId) return;
    setBusy(true);

    try {
      let nextClips: Clip[] = [];
      const acceptedMoments: Moment[] = [];
      let index = 0;
      for (const moment of pending) {
        if (stoppedActionRef.current) return;
        index += 1;
        setActionProgress({
          label: `Cutting "${moment.label}" (${index} of ${pending.length})`,
          percent: 60 + Math.round(((index - 1) / pending.length) * 24),
        });
        const updated = await api.decideMoment(moment.id, "accept");
        acceptedMoments.push(updated);
      }
      const momentsForPick = acceptedMoments.length
        ? nextMoments.map(
            (moment) => acceptedMoments.find((item) => item.id === moment.id) ?? moment,
          )
        : nextMoments;
      if (acceptedMoments.length) {
        setMoments(momentsForPick);
      }

      if (vidId) {
        nextClips = await api.listClips(vidId);
        setClips(nextClips);
        serverClipIds.current = new Set(nextClips.map((clip) => clip.id));
      }

      const bestClip = pickBestClip(nextClips, momentsForPick);
      if (!bestClip || bestClip.posted) return;

      setSelectedClipId(bestClip.id);
      setTool("cuts");
      await shipToYouTube(bestClip);
    } finally {
      setBusy(false);
      setActionProgress(null); // never leave a finished bar on screen
    }
  }
  function handleReset() {
    setVideo(null);
    setAnalysisStatus(null);
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
    setAiPermissionMode("ask");
    // Persist it too: resetting local state alone left the stored mode on
    // "auto", and the next upload read that stale value straight back.
    void api.updateAiSettings("ask").catch(() => null);
    setCaptionTracks([]);
    setSelectedCaptionTrackId(null);
    setMediaUrl(null);
    setMediaDuration(0);
    setTakeSegments([]);
    setSelectedTakeId(null);
    projectIdRef.current = null;
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
    setMessages([]);
  }

  function takeStageFile(file: File | undefined) {
    if (!file || !file.type.startsWith("video/")) return;
    void handleUpload(file);
  }

  /* ---- Cuts: editing ---- */

  function handlePickClip(clipId: string) {
    setSelectedClipId(clipId);
  }

  function handleClipChange(next: Clip) {
    setClips((prev) => prev.map((c) => (c.id === next.id ? next : c)));
  }

  async function handleRemoveHashtag(clipId: string, hashtag: string) {
    const previous = clips;
    const localNext = clips.map((clip) =>
      clip.id === clipId
        ? {
            ...clip,
            hashtags: clip.hashtags.filter((tag) => tag !== hashtag),
          }
        : clip,
    );
    setClips(localNext);

    if (!serverClipIds.current.has(clipId)) {
      return;
    }

    try {
      const updated = await api.removeClipHashtag(clipId, hashtag);
      setClips((prev) =>
        prev.map((clip) => (clip.id === clipId ? updated : clip)),
      );
    } catch {
      setClips(previous);
    }
  }

  async function generateCaptionTrackForRange(input: {
    clipId: string;
    title: string;
    caption: string;
    start: number;
    end: number;
    language: CaptionLanguage;
  }) {
    const existing = captionTracks.find((track) => track.clipId === input.clipId);
    let nextTrack: CaptionTrack;
    try {
      const generated = await api.generateCaptionTrack({
        ...input,
        videoId: video?.id,
      });
      nextTrack = {
        ...generated,
        id: existing?.id ?? generated.id,
        fontFamily: existing?.fontFamily ?? generated.fontFamily,
        fontSource: existing?.fontSource ?? generated.fontSource,
      };
    } catch {
      const fallbackClip: Clip = {
        id: input.clipId,
        momentId: input.clipId,
        videoId: video?.id ?? "take",
        title: input.title,
        caption: input.caption,
        hashtags: [],
        tags: [],
        start: input.start,
        end: input.end,
        posted: false,
      };
      nextTrack = {
        id: existing?.id ?? uid("captrack"),
        clipId: input.clipId,
        language: input.language,
        fontFamily: existing?.fontFamily ?? "Inter",
        fontSource: existing?.fontSource ?? "system",
        segments: buildCaptionSegments(fallbackClip, input.language),
      };
    }
    setCaptionTracks((prev) => [
      nextTrack,
      ...prev.filter((track) => track.clipId !== input.clipId),
    ]);
    setSelectedCaptionTrackId(nextTrack.id);
    setTool("caption");
  }

  async function handleGenerateCaptions(clipId: string, language: CaptionLanguage) {
    const clip = clips.find((item) => item.id === clipId);
    if (!clip) return;
    await generateCaptionTrackForRange({
      clipId,
      title: clip.title,
      caption: clip.caption,
      start: clip.start,
      end: clip.end,
      language,
    });
    setSelectedClipId(clipId);
  }

  async function generateCaptionsFromTransport() {
    const clip = selectedClipId ? clips.find((item) => item.id === selectedClipId) : null;
    if (clip) {
      await handleGenerateCaptions(clip.id, "en");
      return;
    }
    if (!video && !mediaUrl) return;
    await generateCaptionTrackForRange({
      clipId: "take_captions",
      title: projectName || "Main take",
      caption: projectName || "Main take",
      start: 0,
      end: activeTimelineDuration,
      language: "en",
    });
  }

  function handleCaptionTrackChange(track: CaptionTrack) {
    setCaptionTracks((prev) =>
      prev.map((item) => (item.id === track.id ? track : item)),
    );
    setSelectedCaptionTrackId(track.id);
  }

  async function loadInstalledFonts() {
    if (typeof window === "undefined") return;
    const queryLocalFonts = (window as any).queryLocalFonts;
    if (typeof queryLocalFonts !== "function") {
      return;
    }
    try {
      const fonts = await queryLocalFonts();
      const names: string[] = Array.from(
        new Set(
          fonts
            .map((font: any) => String(font.family || "").trim())
            .filter(Boolean),
        ),
      ) as string[];
      names.sort((a, b) => a.localeCompare(b));
      if (names.length > 0) {
        setFontChoices((prev) => Array.from(new Set([...prev, ...names])));
      }
    } catch {
      // Permission denied leaves the web-safe list in place. Not a chat event.
    }
  }

  // Snapshot the current clips before a structural change, so undo/redo can
  // step through the timeline edits. Caption typing is intentionally left out.
  function commit(next: Clip[]) {
    setPast((p) => [...p.slice(-49), clips]);
    setFuture([]);
    setClips(next);
  }

  function undo() {
    if (takePast.length > 0) {
      const prev = takePast[takePast.length - 1];
      setTakeFuture((f) => [takeSegments, ...f].slice(0, 50));
      setTakeSegments(prev);
      setTakePast((p) => p.slice(0, -1));
      setSelectedTakeId(prev[0]?.id ?? null);
      setTime(0);
      seek(0);
      return;
    }
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    setFuture((f) => [clips, ...f].slice(0, 50));
    setClips(prev);
    setPast((p) => p.slice(0, -1));
  }

  function redo() {
    if (takeFuture.length > 0) {
      const next = takeFuture[0];
      setTakePast((p) => [...p, takeSegments].slice(-50));
      setTakeSegments(next);
      setTakeFuture((f) => f.slice(1));
      setSelectedTakeId(next[0]?.id ?? null);
      setTime(0);
      seek(0);
      return;
    }
    if (future.length === 0) return;
    const next = future[0];
    setPast((p) => [...p, clips].slice(-50));
    setClips(next);
    setFuture((f) => f.slice(1));
  }

  function rememberTakeEdit() {
    setTakePast((p) => [...p.slice(-49), takeSegments]);
    setTakeFuture([]);
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
      void api.updateClip(clipId, { start: nextStart, end: nextEnd }).catch(() => {});
    }
  }

  function splitClip(id: string) {
    const clip = clips.find((c) => c.id === id);
    if (!clip) return;
    const at = time;
    if (at <= clip.start + 0.05 || at >= clip.end - 0.05) {
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
    setCaptionTracks((prev) => prev.filter((track) => track.clipId !== id));
    if (captionTracks.some((track) => track.clipId === id)) {
      setSelectedCaptionTrackId(null);
    }
    if (menu?.clipId === id) setMenu(null);
  }

  function copyClip(id: string) {
    const clip = clips.find((c) => c.id === id);
    if (!clip) return;
    setClipboard({ ...clip });
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
  }

  function regenCaption(id: string) {
    const clip = clips.find((c) => c.id === id);
    if (!clip) return;
    if (clip.posted) {
      return;
    }
    void handleGenerateCaptions(id, "en");
  }

  function momentCovering(clip: Clip, beats: Moment[]): Moment | undefined {
    return (
      beats.find((moment) => moment.id === clip.momentId) ??
      beats.find((moment) => moment.start < clip.end && moment.end > clip.start)
    );
  }

  async function reanalyzeTake() {
    if (!video?.id || busy) return;
    clearStoppedAction();
    setTool("moments");
    setBusy(true);
    setRegeneratingMoments(true);
    setMoments([]);
    setAnalysisStatus({
      videoId: video.id,
      stage: "queued",
      message: "Re-analyzing the take.",
      updatedAt: Date.now(),
      done: false,
    });
    try {
      setActionProgress({ label: "Finding moments again", percent: 18 });
      const started = await api.retryAnalysis(video.id);
      setAnalysisStatus(started);
      const { foundMoments, latestStatus } = await pollMomentAnalysis(video.id);
      if (stoppedActionRef.current) return;
      setMoments(foundMoments);
      if (latestStatus) setAnalysisStatus(latestStatus);

      const drafts = clips.filter(
        (clip) => !clip.posted && serverClipIds.current.has(clip.id),
      );
      if (drafts.length > 0) {
        setActionProgress({
          label: "Rewriting titles, descriptions, and hashtags",
          percent: 72,
        });
        const rewritten = new Map<string, Clip>();
        for (const clip of drafts) {
          const beat = momentCovering(clip, foundMoments);
          try {
            const next = await api.rewriteClip(clip.id, {
              label: beat?.label ?? clip.title,
              reason: beat?.reason,
            });
            rewritten.set(clip.id, next);
          } catch {
            /* A posted or missing cut keeps the copy it already has. */
          }
        }
        if (rewritten.size > 0) {
          setClips((prev) => prev.map((clip) => rewritten.get(clip.id) ?? clip));
        }
      }
      setActionProgress({ label: "Re-analysis complete", percent: 100 });
      await sleep(1200);
    } catch (err: any) {
      setAnalysisStatus({
        videoId: video.id,
        stage: "error",
        message: `Re-analysis failed: ${err.message || err}`,
        errorType: "network",
        updatedAt: Date.now(),
        done: true,
      });
    } finally {
      setBusy(false);
      setRegeneratingMoments(false);
      setActionProgress(null);
    }
  }

  function rerunAnalysis(_id: string) {
    void reanalyzeTake();
  }

  async function downloadRenderedClip(clip: Clip) {
    if (typeof document === "undefined") return;
    // Export is render-only. Posted clips are immutable for edits, but they must
    // still be downloadable, so do not PATCH them before rendering.
    const ready = clip.posted && serverClipIds.current.has(clip.id)
      ? clip
      : await ensureServerClip(clip);
    const track = captionTracks.find((item) => item.clipId === ready.id || item.clipId === clip.id) ?? null;
    const rendered = await api.renderClip(ready.id, track);
    serverClipIds.current.add(rendered.id);

    const link = document.createElement("a");
    link.href = api.clipFileUrl(rendered.id);
    link.download = `${fileSlug(rendered.title || clip.title)}.mp4`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function downloadClip(id: string) {
    const clip = clips.find((c) => c.id === id);
    if (clip) {
      void downloadRenderedClip(clip).catch((err: any) =>
        pushMind(`Download failed: ${err.message || err}`),
      );
      return;
    }
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
    rememberTakeEdit();
    setTakeSegments(aligned);

    const rightSegInAligned = aligned.find((s) => s.id === right.id);
    if (rightSegInAligned) {
      setSelectedTakeId(rightSegInAligned.id);
    }
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
    rememberTakeEdit();
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

      return aligned;
    });
  }

  function handleTakeTrim(nextIn: number, nextOut: number) {
    rememberTakeEdit();
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

  function trimTakeToPlayhead(edge: "left" | "right") {
    if ((!video && duration <= 0) || activeTimelineDuration <= 0) return;
    const at = clamp(time, 0, activeTimelineDuration);
    const sourceAt = timelineToSourceTime(
      at,
      takeSegments,
      takeIn,
      takeOut,
      mediaDuration,
    );

    if (takeSegments.length <= 1) {
      const currentIn = takeSegments[0]?.sourceStart ?? takeIn;
      const currentOut = takeSegments[0]?.sourceEnd ?? (takeOut > 0 ? takeOut : duration);
      if (edge === "left") {
        if (sourceAt <= currentIn + 0.1) {
          return;
        }
        handleTakeTrim(sourceAt, currentOut);
        return;
      }
      if (sourceAt >= currentOut - 0.1) {
        return;
      }
      handleTakeTrim(currentIn, sourceAt);
      return;
    }

    const target =
      takeSegments.find((s) => at >= s.start - 0.05 && at <= s.end + 0.05) ??
      (selectedTakeId ? takeSegments.find((s) => s.id === selectedTakeId) : null);
    if (!target) return;

    const sourceStart = target.sourceStart ?? target.start;
    const sourceEnd = target.sourceEnd ?? target.end;
    if (edge === "left" && sourceAt <= sourceStart + 0.1) {
      return;
    }
    if (edge === "right" && sourceAt >= sourceEnd - 0.1) {
      return;
    }

    rememberTakeEdit();
    const next = alignSegmentsToLeft(
      takeSegments.map((segment) =>
        segment.id === target.id
          ? {
              ...segment,
              sourceStart: edge === "left" ? sourceAt : sourceStart,
              sourceEnd: edge === "right" ? sourceAt : sourceEnd,
            }
          : segment,
      ),
    );
    setTakeSegments(next);
    setSelectedTakeId(target.id);
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
  }

  function cutTakeAtPlayhead() {
    if (!video) return;
    const hi = takeHi();
    const start = Math.min(Math.max(time, takeIn), Math.max(takeIn, hi - 1));
    const end = Math.min(start + 15, hi);
    if (end <= start + 0.1) {
      return;
    }
    const clip = makeTakeClip(start, end, "New cut");
    commit([...clips, clip]);
    setSelectedClipId(clip.id);
    setTool("cuts");
  }

  function deleteCaptionTrack(trackId: string) {
    setCaptionTracks((prev) => prev.filter((track) => track.id !== trackId));
    if (selectedCaptionTrackId === trackId) setSelectedCaptionTrackId(null);
    if (selection === "caption") setSelection(null);
  }

  function deleteTakeSegment(takeId?: string | null) {
    if (!video && takeSegments.length === 0 && duration <= 0) return;
    const targetId = takeId || selectedTakeId;
    if (takeSegments.length > 1 && targetId) {
      rememberTakeEdit();
      setTakeSegments((prev) => {
        const next = prev.filter((s) => s.id !== targetId);
        const aligned = alignSegmentsToLeft(next);
        if (aligned.length > 0) setSelectedTakeId(aligned[0].id);
        setTime(0);
        seek(0);
        return aligned;
      });
      return;
    }
    // The last video on the timeline. Remove that video only — the project,
    // its name, and its chat stay. handleReset was clearing all of those.
    rememberTakeEdit();
    setTakeSegments([]);
    setSelectedTakeId(null);
    setVideo(null);
    setMediaUrl(null);
    setMediaDuration(0);
    setMoments([]);
    setAnalysisStatus(null);
    setFrames([]);
    setPeaks(null);
    setTakeIn(0);
    setTakeOut(0);
    setTime(0);
    setPlaying(false);
    if (selection === "take") setSelection(null);
  }

  function deleteSelected() {
    if (selection === "caption" && selectedCaptionTrackId) {
      deleteCaptionTrack(selectedCaptionTrackId);
      return;
    }
    if (selection === "clip" && selectedClipId) {
      deleteClip(selectedClipId);
      return;
    }
    deleteTakeSegment(selectedTakeId);
  }

  function trimTake() {
    if (!video) return;
    setTrimPulse(true);
    window.setTimeout(() => setTrimPulse(false), 1600);
  }

  function downloadTake() {
    if (!video || !mediaUrl || typeof document === "undefined") return;
    const link = document.createElement("a");
    link.href = mediaUrl;
    link.download = `${fileSlug(projectName)}.mp4`;
    document.body.appendChild(link);
    link.click();
    link.remove();
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
        deleteTakeSegment(selectedTakeId);
        break;
      case "download":
        downloadTake();
        break;
      case "rerun-analysis":
        void reanalyzeTake();
        break;
      default:
        break;
    }
  }

  /* ---- Context menu + transport edit dispatch ---- */

  function openMenu(clipId: string, x: number, y: number) {
    setSelectedClipId(clipId);
    setSelection("clip");
    setMenu({ kind: "clip", clipId, x, y });
  }

  function openTakeMenu(takeId: string | null, x: number, y: number) {
    if (takeId) setSelectedTakeId(takeId);
    setSelection("take");
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
    switch (edit) {
      case "undo":
        undo();
        break;
      case "redo":
        redo();
        break;
      case "delete":
        deleteSelected();
        break;
      case "cut":
        handleSplit();
        break;
      case "captions":
        void generateCaptionsFromTransport();
        break;
      case "trim-left":
        trimTakeToPlayhead("left");
        break;
      case "trim-right":
        trimTakeToPlayhead("right");
        break;
    }
  }

  /* ---- Export ---- */

  const exportClip =
    clips.find((clip) => clip.id === selectedClipId) ??
    clips.find((clip) => !clip.posted) ??
    clips[0] ??
    null;

  const previewCaptionTrack =
    (selectedClipId
      ? captionTracks.find((track) => track.clipId === selectedClipId)
      : null) ??
    (selectedCaptionTrackId
      ? captionTracks.find((track) => track.id === selectedCaptionTrackId)
      : null) ??
    captionTracks.find((track) =>
      track.segments.some((segment) => time >= segment.start && time <= segment.end),
    ) ??
    null;

  const previewCaptionSegment =
    previewCaptionTrack?.segments.find(
      (segment) => time >= segment.start && time <= segment.end,
    ) ?? null;

  /** Publishes a cut and comes back with the verdict — the real YouTube / API path. */
  /**
   * Guarantee the clip exists on the backend with its current copy before we
   * post it. Clips the server already knows are PATCHed first, so caption/title
   * and trim edits actually ship (instead of the stale server copy); local cuts
   * from the editing tools are created from their range, so they stop 404-ing on
   * publish. Returns the server clip whose id the post endpoint will accept.
   */
  async function ensureServerClip(clip: Clip): Promise<Clip> {
    const clipVideoId = video?.id || clip.videoId;
    if (!clipVideoId) throw new Error("Upload a take before publishing.");
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
      videoId: clipVideoId,
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

  async function shipToYouTube(clip: Clip): Promise<boolean> {
    try {
      setActionProgress({ label: `Preparing “${clip.title}”`, percent: 36 });
      const ready = await ensureServerClip(clip);
      setActionProgress({
        label: `Publishing “${clip.title}” to YouTube`,
        percent: 74,
      });
      const { postId, postUrl } = await api.postClip(ready.id);
      setActionProgress({ label: `Published “${clip.title}”`, percent: 100 });
      setClips((prev) =>
        prev.map((c) =>
          c.id === clip.id ? { ...ready, posted: true, postId, postUrl } : c,
        ),
      );
      if (selectedClipId === clip.id) setSelectedClipId(ready.id);
      setProjectStatus("posted");
      setProjectPostUrl(postUrl);
      setProjectPostId(postId);
      const postedMessage = `Posted “${clip.title}” to YouTube. Watch it here: ${postUrl}`;
      pushMind(postedMessage, false);
      // Create the project first if this session never saved one, then file the
      // link in its thread. Writing it anywhere else loses it: the loader
      // replaces the thread the moment a project id arrives, so a line filed
      // under the pre-project key is gone as soon as the id lands.
      const thread = projectId ?? (await ensureProject());
      if (thread) {
        await api.saveEditorEvent(thread, postedMessage).catch(() => null);
      }

      const postedClips = clips.map((c) =>
        c.id === clip.id ? { ...ready, posted: true, postId, postUrl } : c,
      );
      try {
        const postedOutcome = {
          status: "posted" as const,
          postUrl,
          postId,
        };
        // `thread` is a real project id by now — ensureProject above created the
        // row if this session did not have one — so this is always an update of
        // a project that exists, never the second save of a new one.
        if (thread) {
          await api.updateProject(thread, { ...postedOutcome, clips: postedClips });
        }
      } catch {
        /* Backend post verification has already been recorded by /api/posts. */
      }

      // No navigation here: publishing must not yank the creator off the
      // timeline mid-session. The chat reply already carries the link.
      //
      // And no grading. A Short reads ~0 views for hours, so checking here used
      // to always come back "Flop" — telling the creator their hook had failed
      // seconds after it went up, and feeding that flop to the playbook. The
      // backend now refuses to grade a fresh post; this stops asking it to and
      // reports the wait instead.
      const check = await api.checkPost(postId);
      setChecks((prev) => [check, ...prev]);
      setProjectViews(check.views);
      // A narrowed local rather than a boolean: it is what keeps "pending" out
      // of setProjectVerdict and the project's stored verdict field, both of
      // which only accept a real grade.
      const verdict = check.verdict === "pending" ? null : check.verdict;
      if (verdict) {
        setProjectStatus("checked");
        setProjectVerdict(verdict);
      }
      // Deliberately not announced in the chat, in either branch. A grade lands
      // seconds or hours after the post went up and nothing the creator typed is
      // being answered by it — the verdict reaches them through the project, the
      // Cuts panel and Analytics regardless. Without a verdict the project is
      // left on "posted" rather than "checked", so History keeps offering
      // Continue instead of a re-cut for a post that was never judged.
      // Persist immediately so History swaps Continue → Re-cut even if they
      // leave before the debounced auto-save fires.
      try {
        const outcome = {
          status: (verdict ? "checked" : "posted") as "checked" | "posted",
          ...(verdict ? { verdict } : {}),
          views: check.views,
          postUrl,
          postId,
        };
        if (thread) {
          await api.updateProject(thread, outcome);
        }
      } catch {
        /* auto-save still has the new fields in its deps */
      }
      // Hold 100% long enough to paint. Clearing in the same turn as the post
      // returns is why the bar never looked finished — it jumped off 92 (or
      // 100) before the browser drew the last frame.
      await sleep(1400);
      return true;
    } catch (err: any) {
      showStatus(errorText("Publish failed", err));
      return false;
    }
  }

  async function handleExport(target: ExportTarget) {
    const clip = exportClip;
    if (!clip || exporting) return;
    setSelectedClipId(clip.id);
    setExporting(target);

    if (target === "device") {
      try {
        await downloadRenderedClip(clip);
      } catch (err: any) {
        showStatus(errorText("Export failed", err));
      }
      setExporting(null);
      return;
    }
    // A cut that is already live needs nothing said in the thread — the Cuts
    // row is already marked live. Only a draft goes out to YouTube.
    if (!clip.posted) {
      await shipToYouTube(clip);
    }

    setExporting(null);
  }

  async function stopCurrentAction() {
    stoppedActionRef.current = true;
    setActionStopped(true);
    setBusy(false);
    setRegeneratingMoments(false);
    setActionProgress(null);
    if (analysisStatus && !analysisStatus.done) {
      setAnalysisStatus({
        ...analysisStatus,
        stage: "error",
        message: "Stopped by user.",
        errorType: "unknown",
        updatedAt: Date.now(),
        done: true,
      });
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem(stoppedActionKey(projectId), "1");
    }
    const target = threadId;
    await api.saveEditorEvent(target, "Stopped current editor action.", "you").catch(() => null);
  }

  function clearStoppedAction() {
    stoppedActionRef.current = false;
    setActionStopped(false);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(stoppedActionKey(projectId));
    }
  }

  /* ---- Mind ---- */

  async function pollMomentAnalysis(videoId: string) {
    let foundMoments: Moment[] = [];
    let latestStatus: AnalysisStatus | null = null;
    const startTime = Date.now();
    const timeoutMs = 420_000;

    while (Date.now() - startTime < timeoutMs) {
      await sleep(1000);
      const status = await api.getAnalysisStatus(videoId).catch(() => null);
      if (status) {
        latestStatus = status;
        setAnalysisStatus(status);
      }
      foundMoments = await api.listMoments(videoId);
      if (foundMoments && foundMoments.length > 0) break;
      if (status?.done) break;
    }

    if (foundMoments.length === 0 && latestStatus && !latestStatus.done) {
      latestStatus = timedOutAnalysisStatus(videoId);
      setAnalysisStatus(latestStatus);
    }

    return { foundMoments, latestStatus };
  }

  // After a refresh, reconnect the visible loader to the backend analysis job.
  // If auto approve is on and the user has not stopped the action, continue the
  // same pipeline when moments arrive.
  useEffect(() => {
    if (!video?.id || !analysisStatus || analysisStatus.done || actionStopped) return;
    if (rejoinAnalysisRef.current === video.id) return;
    rejoinAnalysisRef.current = video.id;
    let cancelled = false;
    void (async () => {
      const { foundMoments, latestStatus } = await pollMomentAnalysis(video.id);
      if (cancelled || stoppedActionRef.current) return;
      if (foundMoments.length > 0) {
        setMoments(foundMoments);
        if (aiPermissionMode === "auto") {
          await autoApproveMoments(foundMoments);
        }
      } else if (latestStatus) {
        setAnalysisStatus(latestStatus);
      }
      rejoinAnalysisRef.current = null;
    })();
    return () => {
      cancelled = true;
      rejoinAnalysisRef.current = null;
    };
  }, [!!analysisStatus && !analysisStatus.done, actionStopped, aiPermissionMode, video?.id]);
  async function regenerateMomentsFromChat(text: string) {
    const targetId = threadId;
    await api.saveEditorEvent(targetId, text, "you").catch(() => null);

    if (!video?.id) {
      pushMind("I can do that, but I need a video in the editor first. Upload your take, then I'll rescan it for stronger moments.");
      return;
    }

    clearStoppedAction();
    setTool("mind");
    setBusy(true);
    setRegeneratingMoments(true);
    setMoments([]);
    setAnalysisStatus({
      videoId: video.id,
      stage: "queued",
      message: "Regenerating moments from the video.",
      updatedAt: Date.now(),
      done: false,
    });

    try {
      const started = await api.retryAnalysis(video.id);
      setAnalysisStatus(started);
      // No hardcoded progress here: the polled analysisStatus.stage now drives
      // the bar, so it tracks the backend's real stage instead of a fixed guess.
      const { foundMoments, latestStatus } = await pollMomentAnalysis(video.id);
      if (stoppedActionRef.current) return;
      setMoments(foundMoments);

      if (foundMoments.length > 0) {
        if (aiPermissionMode === "auto") {
          pushMind(
            `Done. I regenerated ${foundMoments.length} moment${
              foundMoments.length === 1 ? "" : "s"
            } and replaced the old set.`,
          );
          setActionProgress({ label: "Creating cuts from the regenerated moments", percent: 60 });
          await autoApproveMoments(foundMoments);
        } else {
          pushMind(
            `Done. I regenerated ${foundMoments.length} moment${
              foundMoments.length === 1 ? "" : "s"
            } and replaced the old set.`,
          );
        }
      } else {
        const finalStatus =
          latestStatus?.done
            ? latestStatus
            : await api.getAnalysisStatus(video.id).catch(() => null);
        if (finalStatus) setAnalysisStatus(finalStatus);
        pushMind(
          finalStatus?.message ??
            "I regenerated the video, but no strong standalone moments were found.",
        );
      }
    } catch (err: any) {
      const message = `Regeneration failed: ${err.message || err}`;
      setAnalysisStatus({
        videoId: video.id,
        stage: "error",
        message,
        errorType: "network",
        updatedAt: Date.now(),
        done: true,
      });
      showStatus(message);
    } finally {
      setBusy(false);
      setRegeneratingMoments(false);
      setActionProgress(null); // never leave a finished bar on screen
    }
  }

  // Load the thread of whichever project is open, and drop the previous one.
  //
  // Merging across a change of project was the leak: opening project B after A
  // left A's conversation on screen and appended B's underneath it, because the
  // merge only ever added. Within one project the merge stays — see mergeHistory
  // — but a change of project (another one from History, a re-cut, Reset) starts
  // from the server's copy and nothing else, which for a new project is an empty
  // screen.
  useEffect(() => {
    if (!projectId) {
      // Nothing has been uploaded, so no project exists and there is no thread
      // to read. Showing the pre-project thread here is what used to put a
      // previous session's chat in front of a brand-new project.
      openThread.current = null;
      setMessages([]);
      return;
    }
    const sameThread = openThread.current === projectId;
    openThread.current = projectId;
    api
      .getMessages(projectId)
      .then((history) => {
        const rows = (history ?? []).filter((message) => !isUnpromptedChatLine(message));
        setMessages((prev) => (sameThread ? mergeHistory(prev, rows) : rows));
      })
      .catch(() => {});
  }, [projectId]);

  async function runAiEditorAction(commandText: string, opts: { captions?: boolean; publish?: boolean } = {}) {
    const targetId = threadId;
    await api.saveEditorEvent(targetId, commandText, "you").catch(() => null);

    if (!video?.id && !clips.length) {
      pushMind("I'm with you. Drop a video into the editor first, then I can find the moments that hit, turn them into cuts, add captions, and publish when you're ready.");
      return;
    }

    clearStoppedAction();
    setTool("cuts");
    setBusy(true);
    try {
      let workingMoments = moments;
      let workingClips = clips;

      if (video?.id) {
        const [freshMoments, freshClips, status] = await Promise.all([
          api.listMoments(video.id).catch(() => workingMoments),
          api.listClips(video.id).catch(() => workingClips),
          api.getAnalysisStatus(video.id).catch(() => null),
        ]);
        workingMoments = freshMoments;
        workingClips = freshClips;
        setMoments(workingMoments);
        setClips(workingClips);
        serverClipIds.current = new Set(workingClips.map((clip) => clip.id));
        if (status) setAnalysisStatus(status);
      }

      if (video?.id && workingMoments.length === 0) {
        // Immediate feedback for the moment before the first status poll lands;
        // from the next poll on, the live analysis stage drives the bar.
        setActionProgress({ label: "Finding standout moments", percent: 22 });
        pushMind("Finding the strongest moments in this take now...");
        const started = await api.retryAnalysis(video.id);
        setAnalysisStatus(started);
        const result = await pollMomentAnalysis(video.id);
        if (stoppedActionRef.current) return;
        workingMoments = result.foundMoments;
        setMoments(workingMoments);
      }

      const existingMomentIds = new Set(workingClips.map((clip) => clip.momentId));
      const missingAccepted = workingMoments.filter(
        (moment) => moment.status === "accepted" && !existingMomentIds.has(moment.id),
      );
      const pending = workingMoments.filter((moment) => moment.status === "pending");
      // Strongest beats first, so the three we take are the best three, not the earliest three.
      const toAccept = rankMoments([...missingAccepted, ...pending]).slice(0, 3);

      if (toAccept.length > 0) {
        setActionProgress({ label: `Preparing ${toAccept.length} moment${toAccept.length === 1 ? "" : "s"}`, percent: 48 });
        pushMind(`Loading ${toAccept.length} best moment${toAccept.length === 1 ? "" : "s"} into the timeline now.`);
        const accepted: Moment[] = [];
        for (const moment of toAccept) {
          if (stoppedActionRef.current) return;
          try {
            const updated = await api.decideMoment(moment.id, "accept");
            accepted.push(updated);
          } catch (err: any) {
            showStatus(errorText(`Could not create a cut for "${moment.label}"`, err));
            continue;
          }
          if (video?.id) {
            workingClips = await api.listClips(video.id).catch(() => workingClips);
            setClips(workingClips);
            serverClipIds.current = new Set(workingClips.map((clip) => clip.id));
          }
        }
        if (accepted.length > 0) {
          setMoments((prev) =>
            prev.map((moment) => accepted.find((item) => item.id === moment.id) ?? moment),
          );
        }
      }

      if (video?.id) {
        workingClips = await api.listClips(video.id).catch(() => workingClips);
        setClips(workingClips);
        serverClipIds.current = new Set(workingClips.map((clip) => clip.id));
      }

      const bestClip = pickBestClip(workingClips, workingMoments) ?? exportClip;

      if (!bestClip) {
        pushMind("No cuts are ready yet. If moments are still analyzing, wait for the status to finish, then use /cuts again.");
        return;
      }

      setSelectedClipId(bestClip.id);

      // Captions only when they were actually asked for. Publishing used to imply
      // them, which dropped a subtitle layer onto the timeline nobody requested.
      if (opts.captions) {
        setActionProgress({ label: "Adding captions", percent: 84 });
        await generateCaptionTrackForRange({
          clipId: bestClip.id,
          title: bestClip.title,
          caption: bestClip.caption,
          start: bestClip.start,
          end: bestClip.end,
          language: "en",
        });
      }

      if (opts.publish) {
        await shipToYouTube(bestClip);
      } else {
        pushMind(
          opts.captions
            ? `Created the best cut and added captions for "${bestClip.title}".`
            : `Created ${workingClips.length} cut${workingClips.length === 1 ? "" : "s"}. Best cut selected: "${bestClip.title}".`,
        );
      }
    } catch (err: any) {
      showStatus(errorText("AI action failed", err));
    } finally {
      setBusy(false);
      setActionProgress(null); // never leave a finished bar on screen
    }
  }

  async function createCutFromChat(commandText: string, range: { start: number; end: number }) {
    const targetId = threadId;
    await api.saveEditorEvent(targetId, commandText, "you").catch(() => null);

    if (!video?.id) {
      pushMind("I can make that cut once there's a video on the timeline. Upload the take first, then give me the range again.");
      return;
    }

    const maxEnd = mediaDuration || video.duration || takeOut || range.end;
    const start = Math.max(0, Math.min(range.start, maxEnd));
    const end = Math.max(start + 0.1, Math.min(range.end, maxEnd));
    if (end <= start + 0.1) {
      pushMind("That cut range is too short. Try something like /cut 0:12 to 0:25.");
      return;
    }

    setBusy(true);
    try {
      const title = `Cut ${formatTime(start)}-${formatTime(end)}`;
      setActionProgress({ label: `Creating ${title}`, percent: 55 });
      const created = await api.createClip({
        videoId: video.id,
        start,
        end,
        title,
        label: title,
      });
      serverClipIds.current.add(created.id);
      commit([...clips, created]);
      setSelectedClipId(created.id);
      setTool("cuts");
      setActionProgress({ label: "Cut created", percent: 100 });
      pushMind(`Created "${created.title}" from ${formatTime(start)} to ${formatTime(end)}.`);
    } catch (err: any) {
      showStatus(errorText("Could not create that cut", err));
    } finally {
      setBusy(false);
      // Clear the bar when the work ends. Nothing cleared it before, so a stale
      // "Cut created 100%" sat in the chat forever, contradicting the real state.
      setActionProgress(null);
    }
  }

  async function publishSelectedFromChat(commandText: string) {
    const targetId = threadId;
    await api.saveEditorEvent(targetId, commandText, "you").catch(() => null);
    // The selected cut only. exportClip falls back to "any draft", which is how
    // a manual "publish my cut" used to wander off and cut the strongest moments.
    const clip = clips.find((item) => item.id === selectedClipId) ?? null;
    if (!clip) {
      pendingSelectedPublish.current = commandText;
      pushMind(
        "Select the cut you want, then type \"done\" and I'll publish that exact cut.",
      );
      return;
    }
    pendingSelectedPublish.current = null;
    if (clip.posted) {
      pushMind(`“${clip.title}” is already on YouTube. I won't post it again.`);
      return;
    }
    pushMind(`Publishing “${clip.title}” — the cut you selected.`);
    setBusy(true);
    setTool("cuts");
    try {
      if (asksForCaptions(commandText)) {
        setActionProgress({
          label: `Adding captions to “${clip.title}”`,
          percent: 18,
        });
        await generateCaptionTrackForRange({
          clipId: clip.id,
          title: clip.title,
          caption: clip.caption,
          start: clip.start,
          end: clip.end,
          language: "en",
        });
      }
      await shipToYouTube(clip);
    } finally {
      setBusy(false);
      setActionProgress(null);
    }
  }

  async function captionSelectedFromChat(commandText: string) {
    const targetId = threadId;
    await api.saveEditorEvent(targetId, commandText, "you").catch(() => null);
    const clip = clips.find((item) => item.id === selectedClipId) ?? null;
    if (!clip) {
      pushMind("Select a cut first. In manual mode I'll caption that cut only.");
      return;
    }
    pushMind(`Adding captions to "${clip.title}" - the cut you selected.`);
    setBusy(true);
    setTool("caption");
    try {
      setActionProgress({
        label: `Adding captions to "${clip.title}"`,
        percent: 48,
      });
      await generateCaptionTrackForRange({
        clipId: clip.id,
        title: clip.title,
        caption: clip.caption,
        start: clip.start,
        end: clip.end,
        language: "en",
      });
      setActionProgress({
        label: `Captions added to "${clip.title}"`,
        percent: 100,
      });
      await sleep(1200);
    } finally {
      setBusy(false);
      setActionProgress(null);
    }
  }

  /**
   * Pick up work an interruption cut short, starting from the server's state.
   *
   * Reading the screen's own lists would be the wrong start: the interruption is
   * exactly what left the two out of step. A request that died mid-accept leaves
   * the UI holding whatever it had optimistically, while the server knows
   * precisely which moments were already decided. So this re-reads both lists
   * first, then continues at the furthest stage that was actually reached, and
   * narrates each stage to the progress loader rather than to the chat.
   *
   * That makes resuming repeatable: every attempt reads the recorded state fresh,
   * so an interrupted run picks up at the next undecided moment and already-cut
   * work is never redone.
   */
  async function resumeWork() {
    if (!video?.id) {
      pushMind("There is nothing to resume yet — upload a take first.");
      return;
    }

    // Deliberately not chatBusy: that flag exists to put "Thinking..." above the
    // composer, and nothing here is thinking — the progress loader below is the
    // honest report, and chatBusy does not gate the input anyway.
    setBusy(true);
    try {
      setActionProgress({ label: "Checking where the last run stopped", percent: 8 });
      const [serverMoments, serverClips] = await Promise.all([
        api.listMoments(video.id),
        api.listClips(video.id),
      ]);
      setMoments(serverMoments);
      setClips(serverClips);
      serverClipIds.current = new Set(serverClips.map((clip) => clip.id));

      // Stage 1 — the run died while moments were still being decided, so the
      // cut and publish steps after it never started.
      const undecided = rankMoments(
        serverMoments.filter((moment) => moment.status === "pending"),
      );
      if (undecided.length) {
        setTool("moments");
        if (aiPermissionMode === "auto") {
          setActionProgress({
            label: `Resuming ${undecided.length} undecided moment${
              undecided.length === 1 ? "" : "s"
            }`,
            percent: 40,
          });
          await autoApproveMoments(serverMoments);
        } else {
          pushMind(
            `Picked up where it stopped: ${undecided.length} moment${
              undecided.length === 1 ? " is" : "s are"
            } still waiting on Keep or Skip. Auto approve is off, so they need your call.`,
          );
        }
        return;
      }

      // Stage 2 — every moment was decided, but a cut never reached YouTube.
      const drafts = serverClips.filter((clip) => !clip.posted);
      const best = pickBestClip(serverClips, serverMoments);
      if (best && drafts.length) {
        setTool("cuts");
        setSelectedClipId(best.id);
        if (aiPermissionMode === "auto") {
          await shipToYouTube(best);
        } else {
          pushMind(
            `Picked up where it stopped: “${best.title}” is cut and ready${
              drafts.length > 1 ? `, along with ${drafts.length - 1} more` : ""
            }. Auto approve is off, so nothing published itself — say “post it” when you want it up.`,
          );
        }
        return;
      }

      // Stage 3 — nothing was in flight. Saying so plainly is the honest answer,
      // and it is what stops the Mind from promising work that has no code behind
      // it: "Processing the remaining 3 moments" was pure invention.
      setTool("cuts");
      pushMind(
        serverClips.length
          ? "Nothing was left mid-flight — every moment has been decided and every cut is already on YouTube."
          : "Nothing was left mid-flight — no moments are waiting on a decision and there are no cuts yet.",
      );
    } catch (err: any) {
      // The state read is idempotent, so saying "resume" again simply carries on
      // from wherever this attempt got to.
      showStatus(errorText("Couldn't resume", err));
    } finally {
      setBusy(false);
      setActionProgress(null); // never leave a finished bar on screen
    }
  }

  useEffect(() => {
    if (!video?.id || !analysisStatus?.done || actionStopped) return;
    let cancelled = false;
    void (async () => {
      const [serverMoments, serverClips] = await Promise.all([
        api.listMoments(video.id).catch(() => null),
        api.listClips(video.id).catch(() => null),
      ]);
      if (cancelled) return;
      if (serverMoments) setMoments(serverMoments);
      if (serverClips) {
        setClips(serverClips);
        serverClipIds.current = new Set(serverClips.map((clip) => clip.id));
        setSelectedClipId((current) => current ?? serverClips[0]?.id ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [video?.id, analysisStatus?.done, analysisStatus?.updatedAt, actionStopped]);

  useEffect(() => {
    if (!video?.id || aiPermissionMode !== "auto" || busy || actionStopped) return;
    const clipMomentIds = new Set(clips.map((clip) => clip.momentId));
    const pending = moments.filter((moment) => moment.status === "pending");
    const uncutAccepted = moments.filter(
      (moment) => moment.status === "accepted" && !clipMomentIds.has(moment.id),
    );
    const drafts = clips.filter((clip) => !clip.posted);
    if (!pending.length && !uncutAccepted.length && !drafts.length) return;

    const key = [
      video.id,
      pending.map((moment) => moment.id).join(","),
      uncutAccepted.map((moment) => moment.id).join(","),
      drafts.map((clip) => clip.id).join(","),
    ].join("|");
    if (autoResumeRef.current === key) return;
    autoResumeRef.current = key;
    void resumeWork();
  }, [video?.id, aiPermissionMode, busy, actionStopped, moments, clips]);
  async function handleSend(text: string) {
    setStatusText(null);
    setPrompt("");
    setMessages((prev) => [...prev, youMessage(text)]);
    const targetId = threadId;

    const permissionCommand = parsePermissionCommand(text);
    if (permissionCommand) {
      await api.saveEditorEvent(targetId, text, "you").catch(() => null);
      if (permissionCommand === "help") {
        pushMind(
          "Permission commands:\n\n/permissions auto\n/permissions manual\n\nCurrent mode: " +
            (aiPermissionMode === "auto" ? "Auto approve" : "Ask every time"),
        );
      } else {
        await setPermissionMode(permissionCommand, true);
      }
      return;
    }

    if (isResumePrompt(text)) {
      // Handled by the editor, not the Mind — see resumeWork. The ask is still
      // recorded so the thread reads the way the creator typed it.
      await api.saveEditorEvent(targetId, text, "you").catch(() => null);
      await resumeWork();
      return;
    }

    if (isMomentRegenerationPrompt(text)) {
      await regenerateMomentsFromChat(text);
      return;
    }

    if (pendingSelectedPublish.current && isDonePrompt(text)) {
      const pending = pendingSelectedPublish.current;
      pendingSelectedPublish.current = null;
      await publishSelectedFromChat(pending);
      return;
    }
    if (isPleaseFollowup(text)) {
      const selected = clips.find((item) => item.id === selectedClipId) ?? null;
      if (selected?.posted) {
        const link = selected.postUrl ? ` Watch it here: ${selected.postUrl}` : "";
        pushMind(`"${selected.title}" is already on YouTube.${link}`);
        return;
      }
      if (selected) {
        await publishSelectedFromChat("publish the selected cut to YouTube");
        return;
      }
    }
    if (pendingManualConfirm.current) {
      const pending = pendingManualConfirm.current;
      if (isYes(text)) {
        pendingManualConfirm.current = null;
        await runAiEditorAction(pending, {
          captions: asksForCaptions(pending),
          publish: true,
        });
        return;
      }
      if (isNo(text)) {
        pendingManualConfirm.current = null;
        const selected = clips.find((item) => item.id === selectedClipId);
        pushMind(
          selected
            ? `Okay. I won't pick moments. Say “publish it” when you want “${selected.title}” on YouTube.`
            : "Okay. I won't pick moments.",
        );
        return;
      }
      pendingManualConfirm.current = null;
    }

    const manual = aiPermissionMode !== "auto";

    // Manual mode does the sentence the creator typed, and asks before it
    // borrows the auto-approve pipeline (pick moments, cut the best, publish).
    if (manual && isPublishPrompt(text) && asksToBuildBeforePosting(text)) {
      pendingManualConfirm.current = text;
      await api.saveEditorEvent(targetId, text, "you").catch(() => null);
      const selected = clips.find((item) => item.id === selectedClipId);
      pushMind(
        selected
          ? `Picking moments and publishing one is auto approve. Reply “yes” to do that, or “no”. To post only the cut you selected, say “publish it” and I’ll put “${selected.title}” on YouTube.`
          : "Picking moments and publishing one is auto approve. You're in manual mode, so reply “yes” to do that, or select a cut and tell me to publish it.",
      );
      return;
    }

    if (manual && isPublishPrompt(text)) {
      await publishSelectedFromChat(text);
      return;
    }

    if (manual && isCaptionPrompt(text)) {
      await captionSelectedFromChat(text);
      return;
    }

    if (!manual && wantsFullAutoPost(text)) {
      // Captions come from the message, not from the fact that this is a post.
      await runAiEditorAction(text, { captions: asksForCaptions(text), publish: true });
      return;
    }

    if (isCaptionPrompt(text)) {
      await runAiEditorAction(text, { captions: true });
      return;
    }

    if (isCreateMomentsPrompt(text) || isStartWorkPrompt(text)) {
      await runAiEditorAction(text, { captions: asksForCaptions(text) });
      return;
    }

    const cutCommand = parseCutCommand(text);
    if (cutCommand) {
      await createCutFromChat(text, cutCommand);
      return;
    }

    if (isPublishPrompt(text)) {
      await publishSelectedFromChat(text);
      return;
    }

    setChatBusy(true);

    try {
      const reply = await api.sendMessage(targetId, text);
      setMessages((prev) => [...prev, reply]);
    } catch (err: any) {
      showStatus(errorText("Failed to reach Encore Mind", err));
    } finally {
      setChatBusy(false);
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
      deleteSelected();
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
              onBlur={(event) => {
                const name = event.currentTarget.value.trim() || "Untitled";
                setProjectName(name);
                setRenaming(false);
                if (projectIdRef.current) {
                  void api.updateProject(projectIdRef.current, { name }).catch(() => null);
                }
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
            <div className="cut__slate-name">
              <button
                type="button"
                className="cut__project"
                title="Rename project"
                onClick={() => setRenaming(true)}
              >
                {projectName}
              </button>
              <button
                type="button"
                className="cut__rename"
                aria-label="Rename project"
                title="Rename project"
                onClick={() => setRenaming(true)}
              >
                <Pencil aria-hidden="true" />
              </button>
            </div>
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
          {analysisStatus && !analysisStatus.done
            ? analysisStageLabel(analysisStatus.stage)
            : WORKFLOW_STEPS[stage].label}
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
        analysisStatus={actionStopped ? null : analysisStatus}
        moments={moments}
        clips={clips}
        messages={messages.filter((message) => !isUnpromptedChatLine(message))}
        chatBusy={chatBusy}
        statusText={statusText}
        regeneratingMoments={regeneratingMoments}
        actionProgress={actionProgress}
        selectedClipId={selectedClipId}
        captionTracks={captionTracks}
        fontChoices={fontChoices}
        mediaUrl={mediaUrl}
        prompt={prompt}
        onPrompt={setPrompt}
        onSend={handleSend}
        onReset={handleReset}
        onPickClip={handlePickClip}
        onClipChange={handleClipChange}
        onRemoveHashtag={handleRemoveHashtag}
        onGenerateCaptions={handleGenerateCaptions}
        onCaptionTrackChange={handleCaptionTrackChange}
        onLoadInstalledFonts={loadInstalledFonts}
        onClipContext={openMenu}
        onSeek={seek}
        onRecut={handleRecut}
        onDecideMoment={handleDecideMoment}
        onToolChange={setTool}
        onReanalyze={() => void reanalyzeTake()}
        onStopAction={() => void stopCurrentAction()}
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
              if (mediaUrl) togglePlay();
            }}
            title={mediaUrl ? (playing ? "Pause preview" : "Play preview") : undefined}
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
                {projectName === "Opening…" || hasTake ? (
                  <div className="cut__empty-hit" aria-live="polite">
                    <strong>{projectName === "Opening…" ? "Opening project" : projectName}</strong>
                    <span className="cut__empty-sub">
                      {projectName === "Opening…" ? "Opening your project…" : "Loading your take…"}
                    </span>
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
                    <strong>Import media</strong>
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
            {previewCaptionSegment ? (
              <span
                className="cut__caption-preview"
                style={{ fontFamily: previewCaptionTrack?.fontFamily ?? "Inter" }}
              >
                {previewCaptionSegment.text}
              </span>
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
          duration={activeTimelineDuration}
          playing={playing}
          canEdit={!!video || !!mediaUrl || takeSegments.length > 0}
          canUndo={takePast.length > 0 || past.length > 0}
          canRedo={takeFuture.length > 0 || future.length > 0}
          aiPermissionMode={aiPermissionMode}
          fullscreen={fullscreen}
          onEdit={onTransportEdit}
          onRewind={() => seek(Math.max(0, time - 5))}
          onTogglePlay={togglePlay}
          onForward={() => seek(Math.min(activeTimelineDuration, time + 5))}
          onAiPermissionMode={(mode) => {
            void setPermissionMode(mode, false);
          }}
          onToggleFullscreen={toggleFullscreen}
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
          captionTracks={captionTracks}
          pxPerSecond={pxPerSecond}
          heightRem={timelineH}
          frames={frames}
          peaks={peaks}
          trimPulse={trimPulse}
          onSeek={seek}
          onPickClip={(id) => {
            handlePickClip(id);
            setSelection("clip");
            setTool("caption");
          }}
          onPickCaptionTrack={(id) => {
            setSelectedCaptionTrackId(id);
            setSelection("caption");
            setTool("caption");
          }}
          onPickTakeSegment={(id) => {
            setSelectedTakeId(id);
            setSelection("take");
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
          hasCuts={clips.length > 0}
          onAction={onMenuAction}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </main>
  );
}


