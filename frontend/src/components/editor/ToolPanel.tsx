"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, Play, Square, X } from "lucide-react";
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

type ToolPanelProps = {
  tool: ToolId;
  video: Video | null;
  busy: boolean;
  analysisStatus: AnalysisStatus | null;
  moments: Moment[];
  clips: Clip[];
  messages: Message[];
  chatBusy: boolean;
  regeneratingMoments: boolean;
  selectedClipId: string | null;
  captionTracks: CaptionTrack[];
  fontChoices: string[];
  mediaUrl: string | null;
  prompt: string;
  onPrompt: (value: string) => void;
  onSend: (text: string) => void;
  onReset: () => void;
  onPickClip: (id: string) => void;
  onClipChange: (clip: Clip) => void;
  onRemoveHashtag: (clipId: string, hashtag: string) => void;
  onGenerateCaptions: (clipId: string, language: CaptionLanguage) => void;
  onCaptionTrackChange: (track: CaptionTrack) => void;
  onLoadInstalledFonts: () => void;
  onClipContext: (id: string, x: number, y: number) => void;
  onSeek: (seconds: number) => void;
  onRecut: (id: string) => void;
  onDecideMoment: (id: string, decision: "accept" | "reject") => void;
  onToolChange?: (tool: ToolId) => void;
};

const HEADINGS: Record<ToolId, string> = {
  take: "Take",
  moments: "Moments",
  cuts: "Cuts",
  caption: "Captions",
  mind: "Mind",
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

  const selectedClip = clips.find((clip) => clip.id === selectedClipId) ?? null;
  const selectedCaptionTrack = selectedClip
    ? props.captionTracks.find((track) => track.clipId === selectedClip.id)
    : null;

  const pendingMoments = props.moments.filter((m) => m.status === "pending");
  const count =
    tool === "cuts"
      ? clips.length
      : tool === "moments"
        ? (pendingMoments.length > 0 ? pendingMoments.length : props.moments.length)
        : undefined;

  return (
    <section className="cut__panel" aria-label={`${HEADINGS[tool]} panel`}>
      <header className="cut__panel-head">
        <h2>{HEADINGS[tool]}</h2>
        {count !== undefined && count > 0 ? <span>{count}</span> : null}
      </header>

      <div className="cut__panel-body">
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
                  className="cut__mini"
                  onClick={props.onReset}
                >
                  Clear take
                </button>
              </div>
            </div>
          ) : (
            <p className="cut__hint">
              Drop a long take on the monitor to begin.
            </p>
          )
        ) : null}

        {/* ---- Moments: standout beats proposed by Encore ---- */}
        {tool === "moments" ? (
          busy ? (
            <p className="cut__hint">{props.analysisStatus?.message ?? "Preparing the video for analysis."}</p>
          ) : props.moments.length === 0 ? (
            <p className="cut__hint">
              {props.analysisStatus?.stage === "error" ? props.analysisStatus.message : props.analysisStatus?.message && video ? props.analysisStatus.message : video ? "No moments detected yet. Analysis updates will appear here as the video is processed." : "Upload a long take first. Encore will find the beats that stand alone."}
            </p>
          ) : (
            <>
              <p className="cut__hint" style={{ marginBottom: "0.2rem" }}>
                Review each beat. Keep it to turn it into a cut with captions, or Skip.
              </p>
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
          busy ? (
            <p className="cut__hint">Reading the tape and cutting the beats…</p>
          ) : clips.length === 0 ? (
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
          ) : (
            clips.map((clip) => (
              <div
                key={clip.id}
                className={`cut__row${
                  clip.id === selectedClipId ? " is-selected" : ""
                }`}
                onContextMenu={(event) => {
                  event.preventDefault();
                  props.onPickClip(clip.id);
                  props.onClipContext(clip.id, event.clientX, event.clientY);
                }}
              >
                <div className="cut__row-top">
                  <span className="cut__time">
                    {formatSpan(clip.start, clip.end)}
                  </span>
                  {clip.posted ? (
                    <span className="cut__badge cut__badge--live">Live</span>
                  ) : null}
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
                  onClick={() => {
                    props.onPickClip(clip.id);
                    props.onSeek(clip.start);
                  }}
                >
                  {clip.title}
                </button>
                <div className="cut__row-actions">
                  <button
                    type="button"
                    className={
                      clip.id === selectedClipId
                        ? "cut__mini cut__mini--keep"
                        : "cut__mini"
                    }
                    onClick={() => props.onPickClip(clip.id)}
                  >
                    {clip.id === selectedClipId ? "Selected" : "Select"}
                  </button>
                  {clip.posted ? (
                    <button
                      type="button"
                      className="cut__mini"
                      onClick={() => props.onRecut(clip.id)}
                    >
                      Recut
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          )
        ) : null}

        {/* ---- Captions: post copy plus on-video timed text layers ---- */}
        {tool === "caption" ? (
          !selectedClip ? (
            <p className="cut__hint">
              Pick a cut on the timeline and its captions open here.
            </p>
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
                  className="cut__mini cut__mini--keep"
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
              {selectedClip.posted ? (
                <p className="cut__hint">
                  This cut is live — recut it to change the hook.
                </p>
              ) : null}
            </>
          )
        ) : null}

        {/* ---- Mind: the agent thread ---- */}
        {tool === "mind" ? (
          <>
            <div className="cut__thread" role="log" aria-live="polite">
              {props.messages.slice(-8).map((message) => (
                <p
                  key={message.id}
                  className={`cut__bubble cut__bubble--${message.role}`}
                >
                  <b>{message.role === "mind" ? "Encore" : "You"}</b>
                  {message.text}
                </p>
              ))}
              {props.chatBusy ? (
                <p className="cut__thinking" aria-live="polite">
                  Thinking...
                </p>
              ) : null}
              {props.regeneratingMoments && props.analysisStatus ? (
                <div className="cut__chat-progress" aria-live="polite">
                  <div className="cut__chat-progress-top">
                    <span>{props.analysisStatus.message}</span>
                    <b>{ANALYSIS_PROGRESS[props.analysisStatus.stage]}%</b>
                  </div>
                  <span className="cut__chat-progress-track">
                    <i
                      style={{
                        width: `${ANALYSIS_PROGRESS[props.analysisStatus.stage]}%`,
                      }}
                    />
                  </span>
                </div>
              ) : null}
            </div>
            <form
              className="cut__ask"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                const next = props.prompt.trim();
                if (next) props.onSend(next);
              }}
            >
              <input
                value={props.prompt}
                onChange={(event) => props.onPrompt(event.target.value)}
                placeholder="Ask Encore…"
                aria-label="Ask Encore"
              />
              <button type="submit" aria-label="Send">
                <ArrowUp aria-hidden="true" />
              </button>
            </form>
          </>
        ) : null}
      </div>
    </section>
  );
}

