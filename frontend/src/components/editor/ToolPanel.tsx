"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, Play, RefreshCw, Square, X } from "lucide-react";
import type {
  AnalysisStatus,
  CaptionLanguage,
  CaptionTrack,
  Clip,
  Message,
  Moment,
  Video,
} from "@/types";
import type { ToolId } from "@/components/editor/ToolRail";
import { formatSpan, formatTime } from "@/lib/timecode";

// A URL in a bubble, kept out of the match when the sentence ends in a full
// stop: the trailing character class refuses . , ; : ! ? so "watch it: <url>."
// does not swallow the punctuation into the link.
const LINK_PATTERN = /(https?:\/\/[^\s<>()]*[^\s<>().,;:!?])/g;

/** Render a chat line with its links clickable.
 *
 * Encore replies with the YouTube URL when it publishes, and bubbles used to
 * render text only — so the link was dead text to copy by hand. Links open in
 * a new tab on purpose: navigating the current one would drop the editor and
 * any unsaved take state. split() with a capture group puts the matches at odd
 * indices, which is what distinguishes them from the surrounding prose.
 */
function linkify(text: string) {
  return text.split(LINK_PATTERN).map((part, index) =>
    index % 2 === 1 ? (
      <a
        key={index}
        className="cut__link"
        href={part}
        target="_blank"
        rel="noopener noreferrer"
      >
        {part}
      </a>
    ) : (
      part
    ),
  );
}

function formatMessageTime(createdAt: number) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

type ToolPanelProps = {
  tool: ToolId;
  video: Video | null;
  busy: boolean;
  analysisStatus: AnalysisStatus | null;
  moments: Moment[];
  clips: Clip[];
  messages: Message[];
  chatBusy: boolean;
  statusText: string | null;
  regeneratingMoments: boolean;
  actionProgress: { label: string; percent: number } | null;
  selectedClipId: string | null;
  captionTracks: CaptionTrack[];
  fontChoices: string[];
  mediaUrl: string | null;
  prompt: string;
  onPrompt: (value: string) => void;
  onSend: (text: string) => void;
  onReset: () => void;
  onStopAction: () => void;
  onPickClip: (id: string) => void;
  onClipChange: (clip: Clip) => void;
  onRemoveHashtag: (clipId: string, hashtag: string) => void;
  onGenerateCaptions: (clipId: string, language: CaptionLanguage) => void;
  onCaptionTrackChange: (track: CaptionTrack) => void;
  onLoadInstalledFonts: () => void;
  onClipContext: (id: string, x: number, y: number) => void;
  onSeek: (seconds: number) => void;
  onDecideMoment: (id: string, decision: "accept" | "reject") => void;
  onToolChange?: (tool: ToolId) => void;
  onReanalyze?: () => void;
};

const HEADINGS: Record<ToolId, string> = {
  take: "TAKE",
  moments: "MOMENTS",
  cuts: "CUTS",
  caption: "CAPTIONS",
  mind: "MIND",
};

const CAPTION_LANGUAGES: { id: CaptionLanguage; label: string }[] = [
  { id: "en", label: "English" },
  { id: "fr", label: "French" },
  { id: "es", label: "Spanish" },
  { id: "pt", label: "Portuguese" },
  { id: "de", label: "German" },
  { id: "it", label: "Italian" },
  { id: "ar", label: "Arabic" },
  { id: "hi", label: "Hindi" },
];

function isStatusLine(text: string) {
  const lower = text.toLowerCase().trim();
  return (
    lower === "api error" ||
    lower === "timeout error" ||
    lower === "rate limit error" ||
    lower === "app server error" ||
    lower.includes("api error") ||
    lower.includes("connection error") ||
    lower.includes("app server error") ||
    lower.includes("timeout error") ||
    lower.includes("rate limit error") ||
    lower.includes("failed to reach encore mind") ||
    (lower.includes("video ai") && lower.includes("could not finish"))
  );
}
function displayAnalysisMessage(status: AnalysisStatus | null, hasVideo: boolean) {
  if (!status) return null;
  if (status.message.includes("video AI") && status.message.includes("could not finish")) {
    if (status.errorType === "network") {
      return "Connection error, check your network.";
    }
    return "API error";
  }
  if (status.errorType === "network") {
    return "Connection error, check your network.";
  }
  if (status.errorType === "api") {
    return "API error";
  }
  if (status.errorType === "timeout") {
    return "Timeout error";
  }
  return status.message || (hasVideo ? "Analysis updates will appear here as the video is processed." : null);
}
const ANALYSIS_PROGRESS: Record<AnalysisStatus["stage"], number> = {
  queued: 8,
  uploaded: 14,
  thinking: 26,
  transcribing: 44,
  watching: 68,
  generating: 86,
  complete: 100,
  empty: 100,
  error: 100,
};

const SLASH_COMMANDS = [
  {
    command: "/redo",
    label: "Regenerate moments",
    hint: "Clear current moments and run detection again.",
  },
  {
    command: "/permissions",
    label: "Show permission mode",
    hint: "List permission commands and the current mode.",
  },
  {
    command: "/permissions auto",
    label: "Auto approve",
    hint: "Let AI accept the best moments and prepare the best cut.",
  },
  {
    command: "/permissions manual",
    label: "Ask every time",
    hint: "Review moments and actions before they happen.",
  },
];

function MomentPreview({
  mediaUrl,
  moment,
  onSeek,
}: {
  mediaUrl: string | null;
  moment: Moment;
  onSeek: (seconds: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (!active) {
      el.pause();
      return;
    }
    el.currentTime = moment.start;
    el.muted = true;
    void el.play().catch(() => setActive(false));
  }, [active, moment.start]);

  if (!mediaUrl) return null;

  return (
    <div className="cut__moment-preview">
      <video
        ref={videoRef}
        src={mediaUrl}
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={(event) => {
          event.currentTarget.currentTime = moment.start;
        }}
        onTimeUpdate={(event) => {
          if (event.currentTarget.currentTime >= moment.end) {
            event.currentTarget.pause();
            event.currentTarget.currentTime = moment.start;
            setActive(false);
          }
        }}
        onClick={() => {
          onSeek(moment.start);
          setActive((value) => !value);
        }}
      />
      <button
        type="button"
        className="cut__preview-toggle"
        onClick={() => {
          onSeek(moment.start);
          setActive((value) => !value);
        }}
        aria-label={active ? "Stop moment preview" : "Preview moment"}
        title={active ? "Stop preview" : "Preview this moment"}
      >
        {active ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />}
      </button>
    </div>
  );
}

export default function ToolPanel(props: ToolPanelProps) {
  const { tool, video, busy, clips, selectedClipId } = props;
  const askInputRef = useRef<HTMLInputElement>(null);

  const selectedClip = clips.find((clip) => clip.id === selectedClipId) ?? null;
  const selectedCaptionTrack = selectedClip
    ? props.captionTracks.find((track) => track.clipId === selectedClip.id)
    : null;
  // The loader is shared by every tab. While it is on screen it is the status,
  // so the idle line each tab showed before a take existed ("Drop a long take…",
  // "Upload a long take first", "Nothing to show yet", "Pick a cut…") must not
  // sit underneath it.
  const panelLoading =
    busy ||
    (!!props.analysisStatus && !props.analysisStatus.done) ||
    !!props.actionProgress;

  const pendingMoments = props.moments.filter((m) => m.status === "pending");
  const count =
    tool === "cuts"
      ? clips.length
      : tool === "moments"
        ? (pendingMoments.length > 0 ? pendingMoments.length : props.moments.length)
        : undefined;
  const commandQuery = props.prompt.startsWith("/")
    ? props.prompt.slice(1).toLowerCase()
    : "";
  const commandMenuOpen = tool === "mind" && props.prompt.startsWith("/");
  const visibleCommands = SLASH_COMMANDS.filter((item) => {
    if (!commandQuery) return true;
    return (
      item.command.slice(1).toLowerCase().includes(commandQuery) ||
      item.label.toLowerCase().includes(commandQuery)
    );
  });
  const chatLocked =
    props.chatBusy ||
    props.busy ||
    props.regeneratingMoments ||
    !!props.actionProgress ||
    (!!props.analysisStatus && !props.analysisStatus.done);

  useEffect(() => {
    if (tool !== "mind") return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/") return;
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (typing) return;
      event.preventDefault();
      props.onPrompt("/");
      window.setTimeout(() => askInputRef.current?.focus(), 0);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props, tool]);

  return (
    <section className="cut__panel" aria-label={`${HEADINGS[tool]} panel`}>
      <header className="cut__panel-head">
        <h2>{HEADINGS[tool]}</h2>
        {count !== undefined && count > 0 ? <span>{count}</span> : null}
      </header>

      <div className="cut__panel-body">
        {/* Progress belongs to the panel, not to the chat thread. It reports what
            the editor itself is doing, and those jobs are exactly the ones that
            move the panel off Mind — cutting and publishing both select another
            tab — so while it lived inside the thread the loader disappeared at
            the very moment there was something to wait for. */}
        {/* While analysis is actually running, the bar follows the polled backend
            stage (message + a percent derived from that stage) so it tallies with
            the real job. actionProgress is only for the phases the backend cannot
            report, e.g. cutting, captioning, publishing. */}
        {props.analysisStatus && !props.analysisStatus.done ? (
          <div className="cut__chat-progress" aria-live="polite">
            <div className="cut__chat-progress-top">
              <span>{displayAnalysisMessage(props.analysisStatus, !!video)}</span>
              <b>{ANALYSIS_PROGRESS[props.analysisStatus.stage]}%</b>
              <button
                type="button"
                className="cut__progress-stop"
                aria-label="Stop current action"
                title="Stop current action"
                onClick={props.onStopAction}
              >
                <Square aria-hidden="true" />
              </button>
            </div>
            <span className="cut__chat-progress-track">
              <i
                style={{
                  width: `${ANALYSIS_PROGRESS[props.analysisStatus.stage]}%`,
                }}
              />
            </span>
          </div>
        ) : props.actionProgress ? (
          <div className="cut__chat-progress" aria-live="polite">
            <div className="cut__chat-progress-top">
              <span>{props.actionProgress.label}</span>
              <b>{props.actionProgress.percent}%</b>
              <button
                type="button"
                className="cut__progress-stop"
                aria-label="Stop current action"
                title="Stop current action"
                onClick={props.onStopAction}
              >
                <Square aria-hidden="true" />
              </button>
            </div>
            <span className="cut__chat-progress-track">
              <i style={{ width: `${props.actionProgress.percent}%` }} />
            </span>
          </div>
        ) : null}
        {/* ---- Take: the source long video ---- */}
        {tool === "take" ? (
          video ? (
            <div className="cut__row">
              <div className="cut__row-top">
                <span className="cut__row-label">{video.name}</span>
              </div>
              <span className="cut__time">{formatTime(video.duration)}</span>
              <div className="cut__row-actions">
                <button
                  type="button"
                  className="cut__mini cut__mini--danger"
                  onClick={props.onReset}
                >
                  Cancel take
                </button>
              </div>
            </div>
          ) : panelLoading ? null : (
            <p className="cut__hint">
              Drop a long take on the monitor to begin.
            </p>
          )
        ) : null}

        {/* ---- Moments: standout beats proposed by Encore ---- */}
        {tool === "moments" ? (
          props.moments.length === 0 ? (
            panelLoading ? null : (
            <p className="cut__hint">
              {displayAnalysisMessage(props.analysisStatus, !!video) ?? (video ? "No moments detected yet. Analysis updates will appear here as the video is processed." : "Upload a long take first. Encore will find the beats that stand alone.")}
            </p>
            )
          ) : (
            <>
              <div className="cut__moments-head">
                <p className="cut__hint" style={{ margin: 0 }}>
                  Review each beat. Keep it to turn it into a cut with captions, or Skip.
                </p>
                {props.onReanalyze ? (
                  <button
                    type="button"
                    className="cut__retry"
                    aria-label="Re-analyze"
                    title="Re-analyze"
                    disabled={props.regeneratingMoments || busy}
                    onClick={props.onReanalyze}
                  >
                    <RefreshCw aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              {props.moments.map((moment) => (
                <div
                  key={moment.id}
                  className={`cut__row${moment.status === "rejected" ? " is-rejected" : ""}`}
                >
                  <div className="cut__row-top">
                    <span className="cut__time">
                      {formatSpan(moment.start, moment.end)}
                    </span>
                    <span
                      className={`cut__badge cut__badge--${moment.status}`}
                      style={{
                        color:
                          moment.status === "accepted"
                            ? "var(--good)"
                            : moment.status === "rejected"
                              ? "var(--flop)"
                              : "var(--cut-copper)",
                      }}
                    >
                      {moment.status === "accepted"
                        ? "Kept"
                        : moment.status === "rejected"
                          ? "Skipped"
                          : "Pending"}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="cut__row-label"
                    style={{
                      border: 0,
                      background: "none",
                      color: "inherit",
                      textAlign: "left",
                      padding: 0,
                      cursor: "pointer",
                    }}
                    onClick={() => props.onSeek(moment.start)}
                  >
                    {moment.label}
                  </button>
                  <p className="cut__row-note">{moment.reason}</p>
                  <MomentPreview
                    mediaUrl={props.mediaUrl}
                    moment={moment}
                    onSeek={props.onSeek}
                  />
                  <div className="cut__row-actions">
                    {moment.status === "pending" ? (
                      <>
                        <button
                          type="button"
                          className="cut__mini cut__mini--keep"
                          onClick={() => props.onDecideMoment(moment.id, "accept")}
                        >
                          Keep
                        </button>
                        <button
                          type="button"
                          className="cut__mini"
                          style={{ color: "var(--flop)" }}
                          onClick={() => props.onDecideMoment(moment.id, "reject")}
                        >
                          Skip
                        </button>
                      </>
                    ) : (
                      <span className="cut__row-note" style={{ fontStyle: "italic" }}>
                        {moment.status === "accepted"
                          ? "Cut created in Cuts"
                          : "Skipped from cuts"}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </>
          )
        ) : null}

        {/* ---- Cuts: the cuts Encore made from the beats it found ---- */}
        {tool === "cuts" ? (
          clips.length === 0 ? (
            panelLoading ? null : (
            pendingMoments.length > 0 ? (
              <div className="cut__hint" style={{ display: "grid", gap: "0.5rem" }}>
                <p>
                  You have {pendingMoments.length} proposed moment
                  {pendingMoments.length > 1 ? "s" : ""} waiting for review.
                </p>
                {props.onToolChange ? (
                  <button
                    type="button"
                    className="cut__mini cut__mini--keep"
                    style={{ padding: "0.4rem 0.6rem" }}
                    onClick={() => props.onToolChange?.("moments")}
                  >
                    Review Moments
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="cut__hint">Nothing to show yet</p>
            )
          )
          ) : (
            clips.map((clip) => (
              <div
                key={clip.id}
                className={`cut__row cut__row--clip-card${
                  clip.id === selectedClipId ? " is-selected" : ""
                }`}
                onContextMenu={(event) => {
                  event.preventDefault();
                  props.onPickClip(clip.id);
                  props.onClipContext(clip.id, event.clientX, event.clientY);
                }}
              >
                <div className="cut__clip-card-head">
                  <span className="cut__time cut__clip-card-time">
                    {formatSpan(clip.start, clip.end)}
                  </span>
                  {clip.posted ? (
                    <span className="cut__badge cut__badge--live">Live</span>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="cut__row-label cut__clip-card-title"
                  onClick={() => {
                    props.onPickClip(clip.id);
                    props.onSeek(clip.start);
                  }}
                >
                  {clip.title}
                </button>
                <div className="cut__row-actions cut__clip-card-actions">
                  <button
                    type="button"
                    className={
                      clip.id === selectedClipId
                        ? "cut__mini cut__mini--selected"
                        : "cut__mini"
                    }
                    disabled={clip.posted && clip.id === selectedClipId}
                    onClick={() => props.onPickClip(clip.id)}
                  >
                    {clip.id === selectedClipId ? "Selected" : "Select"}
                  </button>
                </div>
              </div>
            ))
          )
        ) : null}

        {/* ---- Captions: post copy plus on-video timed text layers ---- */}
        {tool === "caption" ? (
          !selectedClip ? (
            panelLoading ? null : (
            <p className="cut__hint">
              Pick a cut on the timeline and its captions open here.
            </p>
            )
          ) : (
            <>
              <div className="cut__field">
                <label htmlFor={`cut-title-${selectedClip.id}`}>Title</label>
                <input
                  id={`cut-title-${selectedClip.id}`}
                  value={selectedClip.title}
                  disabled={selectedClip.posted}
                  onChange={(event) =>
                    props.onClipChange({
                      ...selectedClip,
                      title: event.target.value,
                    })
                  }
                />
              </div>
              <div className="cut__field">
                <label htmlFor={`cut-caption-${selectedClip.id}`}>Post caption</label>
                <textarea
                  id={`cut-caption-${selectedClip.id}`}
                  rows={5}
                  value={selectedClip.caption}
                  disabled={selectedClip.posted}
                  onChange={(event) =>
                    props.onClipChange({
                      ...selectedClip,
                      caption: event.target.value,
                    })
                  }
                />
              </div>
              <div
                style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}
              >
                {selectedClip.hashtags.map((tag) => (
                  <span key={tag} className="cut__tag cut__tag--removable">
                    {tag}
                    <button
                      type="button"
                      aria-label={`Remove ${tag}`}
                      title={`Remove ${tag}`}
                      disabled={selectedClip.posted}
                      onClick={() => props.onRemoveHashtag(selectedClip.id, tag)}
                    >
                      <X aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="cut__caption-tools">
                <div className="cut__field">
                  <label htmlFor={`caption-language-${selectedClip.id}`}>
                    Subtitle language
                  </label>
                  <select
                    id={`caption-language-${selectedClip.id}`}
                    value={selectedCaptionTrack?.language ?? "en"}
                    disabled={selectedClip.posted}
                    onChange={(event) =>
                      props.onGenerateCaptions(
                        selectedClip.id,
                        event.target.value as CaptionLanguage,
                      )
                    }
                  >
                    {CAPTION_LANGUAGES.map((language) => (
                      <option key={language.id} value={language.id}>
                        {language.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="cut__mini cut__mini--caption-action"
                  disabled={selectedClip.posted}
                  onClick={() =>
                    props.onGenerateCaptions(
                      selectedClip.id,
                      selectedCaptionTrack?.language ?? "en",
                    )
                  }
                >
                  Generate caption layer
                </button>
              </div>

              {selectedCaptionTrack ? (
                <div className="cut__caption-editor">
                  <div className="cut__field">
                    <label htmlFor={`caption-font-${selectedCaptionTrack.id}`}>
                      Font
                    </label>
                    <select
                      id={`caption-font-${selectedCaptionTrack.id}`}
                      value={selectedCaptionTrack.fontFamily}
                      disabled={selectedClip.posted}
                      onChange={(event) =>
                        props.onCaptionTrackChange({
                          ...selectedCaptionTrack,
                          fontFamily: event.target.value,
                          fontSource: "system",
                        })
                      }
                      onFocus={props.onLoadInstalledFonts}
                    >
                      {props.fontChoices.map((font) => (
                        <option key={font} value={font}>
                          {font}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    className="cut__mini"
                    disabled={selectedClip.posted}
                    onClick={props.onLoadInstalledFonts}
                  >
                    Refresh installed fonts
                  </button>

                  <div className="cut__caption-lines">
                    {selectedCaptionTrack.segments.map((segment, index) => (
                      <label key={segment.id} className="cut__caption-line">
                        <span>
                          {formatTime(segment.start)} - {formatTime(segment.end)}
                        </span>
                        <textarea
                          rows={2}
                          value={segment.text}
                          disabled={selectedClip.posted}
                          onFocus={() => props.onSeek(segment.start)}
                          onChange={(event) =>
                            props.onCaptionTrackChange({
                              ...selectedCaptionTrack,
                              segments: selectedCaptionTrack.segments.map((item, i) =>
                                i === index
                                  ? { ...item, text: event.target.value }
                                  : item,
                              ),
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )
        ) : null}

        {/* ---- Mind: the agent thread ---- */}
        {tool === "mind" ? (
          <div className="cut__mind-chat">
            <div className="cut__thread" role="log" aria-live="polite">
              <p className="cut__thread-day">Today</p>
              {props.messages.slice(-8).map((message) =>
                message.role === "mind" && isStatusLine(message.text) ? (
                  <p key={message.id} className="cut__thinking cut__status-text" aria-live="polite">
                    {message.text}
                  </p>
                ) : (
                  <p
                    key={message.id}
                    className={`cut__bubble cut__bubble--${message.role}`}
                  >
                    <span className="cut__bubble-meta">
                      <b>{message.role === "mind" ? "Encore" : "You"}</b>
                      <time dateTime={new Date(message.createdAt).toISOString()}>
                        {formatMessageTime(message.createdAt)}
                      </time>
                    </span>
                    <span className="cut__bubble-text">{linkify(message.text)}</span>
                  </p>
                ),
              )}
              {props.chatBusy ? (
                <p className="cut__thinking" aria-live="polite">
                  Thinking...
                </p>
              ) : props.statusText ? (
                <p className="cut__thinking cut__status-text" aria-live="polite">
                  {props.statusText}
                </p>
              ) : null}
            </div>
            <form
              className="cut__ask"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                const next = props.prompt.trim();
                if (chatLocked) {
                  props.onStopAction();
                  return;
                }
                if (next) props.onSend(next);
              }}
            >
              {commandMenuOpen ? (
                <div className="cut__command-menu" role="listbox">
                  {visibleCommands.length > 0 ? (
                    visibleCommands.map((item) => (
                      <button
                        key={item.command}
                        type="button"
                        className="cut__command-option"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          props.onPrompt(item.command);
                          window.setTimeout(() => askInputRef.current?.focus(), 0);
                        }}
                      >
                        <b>{item.command}</b>
                        <span>{item.label}</span>
                        <small>{item.hint}</small>
                      </button>
                    ))
                  ) : (
                    <p className="cut__command-empty">No command found</p>
                  )}
                </div>
              ) : null}
              <input
                ref={askInputRef}
                value={props.prompt}
                onChange={(event) => props.onPrompt(event.target.value)}
                placeholder={chatLocked ? "Encore is working..." : "Ask Encore..."}
                aria-label="Ask Encore"
                disabled={chatLocked}
              />
              <button
                type="submit"
                className={chatLocked ? "cut__ask-stop" : undefined}
                aria-label={chatLocked ? "Stop response" : "Send"}
                title={chatLocked ? "Stop response" : "Send"}
              >
                {chatLocked ? <Square aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
              </button>
            </form>
          </div>
        ) : null}
      </div>
    </section>
  );
}


