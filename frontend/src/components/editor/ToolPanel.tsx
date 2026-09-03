"use client";

import { type FormEvent } from "react";
import { ArrowUp } from "lucide-react";
import type { Clip, Message, Moment, Video } from "@/types";
import type { ToolId } from "@/components/editor/ToolRail";
import { formatSpan, formatTime } from "@/lib/timecode";

type ToolPanelProps = {
  tool: ToolId;
  video: Video | null;
  busy: boolean;
  moments: Moment[];
  clips: Clip[];
  messages: Message[];
  selectedClipId: string | null;
  prompt: string;
  onPrompt: (value: string) => void;
  onSend: (text: string) => void;
  onReset: () => void;
  onPickClip: (id: string) => void;
  onClipChange: (clip: Clip) => void;
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
  caption: "Caption",
  mind: "Mind",
};

export default function ToolPanel(props: ToolPanelProps) {
  const { tool, video, busy, clips, selectedClipId } = props;

  const selectedClip = clips.find((clip) => clip.id === selectedClipId) ?? null;

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
            <p className="cut__hint">Watching the tape and proposing standalone moments…</p>
          ) : props.moments.length === 0 ? (
            <p className="cut__hint">
              {video
                ? "No moments detected yet. As transcription and detection finish, proposed beats will appear here."
                : "Upload a long take first. Encore will find the beats that stand alone."}
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

        {/* ---- Caption: the selected cut's title, caption, hashtags ---- */}
        {tool === "caption" ? (
          !selectedClip ? (
            <p className="cut__hint">
              Pick a cut on the timeline and its title and caption open here.
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
                <label htmlFor={`cut-caption-${selectedClip.id}`}>Caption</label>
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
                  <span key={tag} className="cut__tag">
                    {tag}
                  </span>
                ))}
              </div>
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
