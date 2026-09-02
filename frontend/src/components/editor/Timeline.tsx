"use client";

import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { ChevronsDownUp, ChevronsUpDown, Snowflake } from "lucide-react";
import type { Clip } from "@/types";
import type { Frame } from "@/lib/mediaGraphics";
import { formatTime } from "@/lib/timecode";

export const MIN_PPS = 6;
export const MAX_PPS = 64;
// Tall enough that a clip's filmstrip + waveform never clip at the smallest
// dock height — the shrink toggle floors here.
export const MIN_TL_H = 8.8;
export const MAX_TL_H = 22;

type TimelineProps = {
  duration: number;
  time: number;
  takeName: string | null;
  takeIn: number;
  takeOut: number;
  clips: Clip[];
  selectedClipId: string | null;
  pxPerSecond: number;
  heightRem: number;
  frames: Frame[];
  peaks: number[] | null;
  trimPulse: boolean;
  onSeek: (seconds: number) => void;
  onPickClip: (clipId: string) => void;
  onClipContextMenu: (clipId: string, x: number, y: number) => void;
  onTakeContextMenu: (x: number, y: number) => void;
  onTakeTrim: (nextIn: number, nextOut: number) => void;
  onPxPerSecond: (value: number) => void;
  onHeightRem: (value: number) => void;
};

// A tiny deterministic PRNG (FNV-1a seed + xorshift) so a clip falls back to a
// stable, per-clip synthetic waveform when real audio peaks aren't available
// (e.g. a file with no audio track, or before decode finishes).
function seeded(seed: string, count: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    h >>>= 0;
    out.push((h % 1000) / 1000);
  }
  return out;
}

function tickStep(duration: number, pps: number): number {
  const visible = Math.max(40, 800 / Math.max(pps, 1));
  const raw = visible / 6;
  for (const step of [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]) {
    if (raw <= step) return step;
  }
  return 900;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export default function Timeline({
  duration,
  time,
  takeName,
  takeIn,
  takeOut,
  clips,
  selectedClipId,
  pxPerSecond,
  heightRem,
  frames,
  peaks,
  trimPulse,
  onSeek,
  onPickClip,
  onClipContextMenu,
  onTakeContextMenu,
  onTakeTrim,
  onPxPerSecond,
  onHeightRem,
}: TimelineProps) {
  const span = duration > 0 ? duration : 0;
  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const panning = useRef(false);
  const panOrigin = useRef({ x: 0, scroll: 0 });
  const seeking = useRef(false);
  const resizing = useRef(false);
  const resizeOrigin = useRef({ y: 0, h: heightRem });
  const scrubbing = useRef(false);
  const trimming = useRef<null | "l" | "r">(null);

  const widthPx = span > 0 ? Math.max(span * pxPerSecond, 1) : 0;
  const xOf = (seconds: number) => seconds * pxPerSecond;
  const wOf = (start: number, end: number) =>
    Math.max((end - start) * pxPerSecond, 8);

  // Keep every block inside the track: clamp its left edge into the track and
  // its width to whatever room is left, so shrinking or zooming the timeline
  // can never push a block past the track's right edge.
  const boxOf = (start: number, end: number, minW: number) => {
    const left = clamp(xOf(start), 0, widthPx);
    const width = clamp(wOf(start, end), minW, Math.max(minW, widthPx - left));
    return { left, width };
  };

  const ticks: number[] = [];
  if (span > 0) {
    const step = tickStep(span, pxPerSecond);
    for (let at = 0; at <= span; at += step) ticks.push(at);
  }

  // Frames whose timestamp falls inside a block's time range, so a cut shows
  // its own footage rather than the whole tape. Falls back to the single
  // nearest frame when a very short block would otherwise catch none.
  function framesBetween(start: number, end: number): Frame[] | null {
    if (!frames || frames.length === 0) return null;
    const inRange = frames.filter((f) => f.t >= start - 0.001 && f.t <= end + 0.001);
    if (inRange.length > 0) return inRange;
    const mid = (start + end) / 2;
    let best = frames[0];
    for (const f of frames) {
      if (Math.abs(f.t - mid) < Math.abs(best.t - mid)) best = f;
    }
    return [best];
  }

  // Real peak envelope sliced to a block's time range and resampled to `count`
  // bars; null when there's no decoded audio so the caller can fall back to the
  // seeded synthetic waveform.
  function peaksBetween(start: number, end: number, count: number): number[] | null {
    if (!peaks || peaks.length === 0 || span <= 0) return null;
    const a = clamp(Math.floor((start / span) * peaks.length), 0, peaks.length - 1);
    const b = clamp(Math.ceil((end / span) * peaks.length), a + 1, peaks.length);
    const slice = peaks.slice(a, b);
    if (slice.length === 0) return null;
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      out.push(slice[Math.floor((i / count) * slice.length)] ?? 0);
    }
    return out;
  }

  function secondsFromClientX(clientX: number) {
    const el = inner.current;
    if (!el || span <= 0) return 0;
    const box = el.getBoundingClientRect();
    if (box.width <= 0) return 0;
    const ratio = (clientX - box.left) / box.width;
    return clamp(ratio * span, 0, span);
  }

  function onRulerDown(event: PointerEvent<HTMLElement>) {
    if (span <= 0) return;
    event.preventDefault();
    seeking.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    onSeek(secondsFromClientX(event.clientX));
  }

  function onRulerMove(event: PointerEvent<HTMLElement>) {
    if (!seeking.current) return;
    onSeek(secondsFromClientX(event.clientX));
  }

  function endSeek(event: PointerEvent<HTMLElement>) {
    if (!seeking.current) return;
    seeking.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onPanDown(event: PointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest(".cut__block")) return;
    if ((event.target as HTMLElement).closest(".cut__playhead-knob")) return;
    event.preventDefault();
    panning.current = true;
    panOrigin.current = {
      x: event.clientX,
      scroll: scroller.current?.scrollLeft ?? 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPanMove(event: PointerEvent<HTMLElement>) {
    if (!panning.current || !scroller.current) return;
    const dx = event.clientX - panOrigin.current.x;
    scroller.current.scrollLeft = panOrigin.current.scroll - dx;
  }

  function endPan(event: PointerEvent<HTMLElement>) {
    if (!panning.current) return;
    panning.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (span <= 0) return;
    let next: number | null = null;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown":
        next = time - 1;
        break;
      case "ArrowRight":
      case "ArrowUp":
        next = time + 1;
        break;
      case "PageDown":
        next = time - 5;
        break;
      case "PageUp":
        next = time + 5;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = span;
        break;
      default:
        return;
    }
    event.preventDefault();
    onSeek(clamp(next, 0, span));
  }

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    onPxPerSecond(clamp(pxPerSecond * factor, MIN_PPS, MAX_PPS));
  }

  function onResizeDown(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    resizing.current = true;
    resizeOrigin.current = { y: event.clientY, h: heightRem };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onResizeMove(event: PointerEvent<HTMLButtonElement>) {
    if (!resizing.current) return;
    // The grip sits at the top edge of the bottom-docked timeline, so dragging
    // up must grow it and dragging down must shrink it — hence minus dy.
    const dy = event.clientY - resizeOrigin.current.y;
    onHeightRem(clamp(resizeOrigin.current.h - dy / 16, MIN_TL_H, MAX_TL_H));
  }

  function endResize(event: PointerEvent<HTMLButtonElement>) {
    if (!resizing.current) return;
    resizing.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  // Drag the playhead itself to scrub — the line carries a full-height,
  // invisible grab strip (cursor: ew-resize) so there's no visible knob, just a
  // line, while dragging still works. Clicking/tapping the ruler and the arrow
  // keys stay as non-drag alternatives, satisfying WCAG 2.5.7.
  function onKnobDown(event: PointerEvent<HTMLSpanElement>) {
    if (span <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    scrubbing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    onSeek(secondsFromClientX(event.clientX));
  }

  function onKnobMove(event: PointerEvent<HTMLSpanElement>) {
    if (!scrubbing.current) return;
    onSeek(secondsFromClientX(event.clientX));
  }

  function endScrub(event: PointerEvent<HTMLSpanElement>) {
    if (!scrubbing.current) return;
    scrubbing.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  // Drag the take's left / right edge to trim the main clip in and out.
  function onTrimDown(edge: "l" | "r") {
    return (event: PointerEvent<HTMLSpanElement>) => {
      if (span <= 0) return;
      event.preventDefault();
      event.stopPropagation();
      trimming.current = edge;
      event.currentTarget.setPointerCapture(event.pointerId);
    };
  }

  function onTrimMove(event: PointerEvent<HTMLSpanElement>) {
    if (!trimming.current) return;
    const t = secondsFromClientX(event.clientX);
    if (trimming.current === "l") {
      onTakeTrim(clamp(t, 0, takeOut - 0.5), takeOut);
    } else {
      onTakeTrim(takeIn, clamp(t, takeIn + 0.5, span));
    }
  }

  function endTrim(event: PointerEvent<HTMLSpanElement>) {
    if (!trimming.current) return;
    trimming.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  // Keep the playhead in view while playing, without fighting a user pan or scrub.
  useEffect(() => {
    const el = scroller.current;
    if (
      !el ||
      span <= 0 ||
      seeking.current ||
      panning.current ||
      scrubbing.current
    )
      return;
    const x = xOf(time);
    const left = el.scrollLeft;
    const right = left + el.clientWidth;
    const pad = 48;
    if (x < left + pad) el.scrollLeft = Math.max(0, x - pad);
    else if (x > right - pad) el.scrollLeft = x - el.clientWidth + pad;
  }, [time, pxPerSecond, span]);

  const compact = heightRem <= MIN_TL_H + 0.4;

  const takeBox = boxOf(takeIn, Math.min(takeOut || span, span), 1);
  const takeFrames = framesBetween(takeIn, Math.min(takeOut || span, span));
  const takeBars = peaksBetween(takeIn, Math.min(takeOut || span, span), 40);

  return (
    <div className="cut__timeline" style={{ height: `${heightRem}rem` }}>
      <div className="cut__timeline-bar">
        <span className="cut__tl-title">Timeline</span>
        <span className="cut__tl-fill" aria-hidden="true" />
        <button
          type="button"
          className="cut__tl-btn"
          aria-label={compact ? "Expand timeline" : "Shrink timeline"}
          onClick={() => onHeightRem(compact ? 12 : MIN_TL_H)}
        >
          {compact ? (
            <ChevronsUpDown aria-hidden="true" />
          ) : (
            <ChevronsDownUp aria-hidden="true" />
          )}
        </button>
      </div>

      <button
        type="button"
        className="cut__timeline-grip"
        aria-label="Resize timeline"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
      />

      <div ref={scroller} className="cut__timeline-scroll" onWheel={onWheel}>
        <div
          ref={inner}
          className="cut__timeline-inner"
          style={{ width: span > 0 ? `${widthPx}px` : "100%" }}
        >
          <div
            className="cut__ruler"
            role="slider"
            tabIndex={span > 0 ? 0 : -1}
            aria-label="Seek"
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={Math.round(span)}
            aria-valuenow={Math.round(time)}
            aria-valuetext={`${formatTime(time)} of ${formatTime(span)}`}
            onKeyDown={onKeyDown}
            onPointerDown={onRulerDown}
            onPointerMove={onRulerMove}
            onPointerUp={endSeek}
            onPointerCancel={endSeek}
          >
            {ticks.map((at) => (
              <span
                key={at}
                className="cut__tick"
                style={{ left: `${xOf(at)}px` }}
              >
                <span>{formatTime(at)}</span>
              </span>
            ))}
          </div>

          <div
            className="cut__lanes"
            onPointerDown={onPanDown}
            onPointerMove={onPanMove}
            onPointerUp={endPan}
            onPointerCancel={endPan}
          >
            <div className="cut__track" role="presentation">
              <span className="cut__track-name">Take</span>
              {takeName && span > 0 ? (
                <div
                  className={`cut__block cut__block--take${
                    trimPulse ? " is-trimming" : ""
                  }`}
                  style={{ left: `${takeBox.left}px`, width: `${takeBox.width}px` }}
                  title={takeName}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onTakeContextMenu(event.clientX, event.clientY);
                  }}
                >
                  {takeFrames ? (
                    <span className="cut__film cut__film--real" aria-hidden="true">
                      {takeFrames.map((f, i) => (
                        <img key={i} src={f.src} alt="" draggable={false} />
                      ))}
                    </span>
                  ) : (
                    <span className="cut__film" aria-hidden="true" />
                  )}
                  {takeBars ? (
                    <span className="cut__wave" aria-hidden="true">
                      {takeBars.map((v, i) => (
                        <span key={i} style={{ height: `${18 + v * 74}%` }} />
                      ))}
                    </span>
                  ) : null}
                  <span className="cut__block-label">{takeName}</span>
                  <span
                    className="cut__trim cut__trim--l"
                    aria-hidden="true"
                    onPointerDown={onTrimDown("l")}
                    onPointerMove={onTrimMove}
                    onPointerUp={endTrim}
                    onPointerCancel={endTrim}
                  />
                  <span
                    className="cut__trim cut__trim--r"
                    aria-hidden="true"
                    onPointerDown={onTrimDown("r")}
                    onPointerMove={onTrimMove}
                    onPointerUp={endTrim}
                    onPointerCancel={endTrim}
                  />
                </div>
              ) : null}
            </div>

            <div className="cut__track cut__track--clips" role="presentation">
              <span className="cut__track-name">Cuts</span>
              {clips.map((clip) => {
                const box = boxOf(clip.start, clip.end, 8);
                const clipFrames = framesBetween(clip.start, clip.end);
                const bars =
                  peaksBetween(clip.start, clip.end, 22) ?? seeded(clip.id, 22);
                return (
                  <button
                    key={clip.id}
                    type="button"
                    className={`cut__block cut__block--clip${
                      clip.id === selectedClipId ? " is-selected" : ""
                    }${clip.frozen ? " is-frozen" : ""}`}
                    style={{ left: `${box.left}px`, width: `${box.width}px` }}
                    title={clip.title}
                    onClick={(event) => {
                      event.stopPropagation();
                      onPickClip(clip.id);
                      onSeek(clip.start);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onPickClip(clip.id);
                      onClipContextMenu(clip.id, event.clientX, event.clientY);
                    }}
                  >
                    {clipFrames ? (
                      <span className="cut__film cut__film--real" aria-hidden="true">
                        {clipFrames.map((f, i) => (
                          <img key={i} src={f.src} alt="" draggable={false} />
                        ))}
                      </span>
                    ) : (
                      <span className="cut__film" aria-hidden="true" />
                    )}
                    <span className="cut__wave" aria-hidden="true">
                      {bars.map((v, i) => (
                        <span key={i} style={{ height: `${18 + v * 74}%` }} />
                      ))}
                    </span>
                    <span className="cut__block-label">{clip.title}</span>
                    {clip.frozen ? (
                      <span className="cut__block-frozen" aria-hidden="true">
                        <Snowflake />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {span > 0 ? (
              <span
                className="cut__playhead"
                style={{ left: `${xOf(time)}px` }}
                aria-hidden="true"
              >
                <span
                  className="cut__playhead-knob"
                  onPointerDown={onKnobDown}
                  onPointerMove={onKnobMove}
                  onPointerUp={endScrub}
                  onPointerCancel={endScrub}
                />
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
