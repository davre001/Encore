"use client";

import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { ArrowUp, Upload } from "lucide-react";
import type { Clip, Message, Video } from "@/types";
import type { ToolId } from "@/components/editor/ToolRail";
import { formatSpan, formatTime } from "@/lib/timecode";

type ToolPanelProps = {
  tool: ToolId;
  video: Video | null;
  busy: boolean;
  clips: Clip[];
  messages: Message[];
  selectedClipId: string | null;
  prompt: string;
  onPrompt: (value: string) => void;
  onSend: (text: string) => void;
  onUpload: (file: File) => void;
  onReset: () => void;
  onPickClip: (id: string) => void;
  onClipChange: (clip: Clip) => void;
  onClipContext: (id: string, x: number, y: number) => void;
  onSeek: (seconds: number) => void;
  onRecut: (id: string) => void;
};

const HEADINGS: Record<ToolId, string> = {
  take: "Take",
  cuts: "Cuts",
  caption: "Caption",
  mind: "Mind",
};

export default function ToolPanel(props: ToolPanelProps) {
  const { tool, video, busy, clips, selectedClipId } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  function takeFile(file: File | undefined) {
    if (!file || !file.type.startsWith("video/")) return;
    props.onUpload(file);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDrag(false);
    takeFile(event.dataTransfer.files?.[0]);
  }

  const selectedClip = clips.find((clip) => clip.id === selectedClipId) ?? null;

  const count = tool === "cuts" ? clips.length : undefined;

  return (
    <section className="cut__panel" aria-label={`${HEADINGS[tool]} panel`}>
      <header className="cut__panel-head">
        <h2>{HEADINGS[tool]}</h2>
        {count !== undefined && count > 0 ? <span>{count}</span> : null}
      </header>

      <div className="cut__panel-body">
        {/* ---- Take: the source long video ---- */}
        {tool === "take" ? (
          <>
            <div
              className={drag ? "cut__drop is-drag" : "cut__drop"}
              onDragOver={(event) => {
                event.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
            >
              <button
                type="button"
                className="cut__upload"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                <span className="cut__upload-icon" aria-hidden="true">
                  <Upload />
                </span>
                <strong>Upload a video</strong>
                <span className="cut__upload-sub">
                  Click or drop your long take here
                </span>
              </button>
              <input
                ref={fileRef}
                className="cut__file"
                type="file"
                accept="video/*"
                onChange={(event) => takeFile(event.target.files?.[0])}
              />
            </div>

            {video ? (
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
            ) : null}
          </>
        ) : null}

        {/* ---- Cuts: the cuts Encore made from the beats it found ---- */}
        {tool === "cuts" ? (
          busy ? (
            <p className="cut__hint">Reading the tape and cutting the beats…</p>
          ) : clips.length === 0 ? (
            <p className="cut__hint">Nothing to show yet</p>
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
