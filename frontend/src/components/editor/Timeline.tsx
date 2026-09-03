"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { ChevronsDownUp, ChevronsUpDown, Snowflake } from "lucide-react";
import type { Clip, TakeSegment } from "@/types";
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
  mediaDuration?: number;
  takeName: string | null;
  takeIn: number;
  takeOut: number;
  takeSegments?: TakeSegment[];
  selectedTakeId?: string | null;
  clips: Clip[];
  selectedClipId: string | null;
  pxPerSecond: number;
  heightRem: number;
  frames: Frame[];
  peaks: number[] | null;
  trimPulse: boolean;
  onSeek: (seconds: number) => void;
  onPickClip: (clipId: string) => void;
  onPickTakeSegment?: (takeId: string) => void;
  onClipContextMenu: (clipId: string, x: number, y: number) => void;
  onTakeContextMenu: (takeId: string | null, x: number, y: number) => void;
  onTakeTrim: (nextIn: number, nextOut: number) => void;
  onTakeSegmentMove?: (takeId: string, nextStart: number, nextEnd: number) => void;
  onTakeSegmentMoveCommit?: (
    takeId: string,
    nextStart: number,
    nextEnd: number,
    mode?: "move" | "trim-l" | "trim-r"
  ) => void;
  onClipMove?: (clipId: string, nextStart: number, nextEnd: number) => void;
  onClipMoveCommit?: (clipId: string, nextStart: number, nextEnd: number) => void;
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
  mediaDuration,
  takeName,
  takeIn,
  takeOut,
  takeSegments,
  selectedTakeId,
  clips,
  selectedClipId,
  pxPerSecond,
  heightRem,
  frames,
  peaks,
  trimPulse,
  onSeek,
  onPickClip,
  onPickTakeSegment,
  onClipContextMenu,
  onTakeContextMenu,
  onTakeTrim,
  onTakeSegmentMove,
  onTakeSegmentMoveCommit,
  onClipMove,
  onClipMoveCommit,
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
  const [takeSliding, setTakeSliding] = useState(false);

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
    if (!peaks || peaks.length === 0) return null;
    const baseDur = mediaDuration && mediaDuration > 0 ? mediaDuration : span;
    if (baseDur <= 0) return null;
    const a = clamp(Math.floor((start / baseDur) * peaks.length), 0, peaks.length - 1);
    const b = clamp(Math.ceil((end / baseDur) * peaks.length), a + 1, peaks.length);
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

  // Dragging state for take segments (moving left/right or trimming left/right)
  const [takeDragInfo, setTakeDragInfo] = useState<{
    takeId: string;
    start: number;
    end: number;
    mode: "move" | "trim-l" | "trim-r";
  } | null>(null);

  const takeDragRef = useRef<{
    takeId: string;
    startX: number;
    origStart: number;
    origEnd: number;
    mode: "move" | "trim-l" | "trim-r";
    hasMoved: boolean;
  } | null>(null);

  function onTakePointerDown(
    seg: TakeSegment,
    mode: "move" | "trim-l" | "trim-r"
  ) {
    return (event: PointerEvent<HTMLElement>) => {
      if (span <= 0) return;
      if (event.button !== 0) return; // ignore right-click
      event.preventDefault();
      event.stopPropagation();

      takeDragRef.current = {
        takeId: seg.id,
        startX: event.clientX,
        origStart: seg.start,
        origEnd: seg.end,
        mode,
        hasMoved: false,
      };

      setTakeDragInfo({
        takeId: seg.id,
        start: seg.start,
        end: seg.end,
        mode,
      });

      onPickTakeSegment?.(seg.id);
      event.currentTarget.setPointerCapture(event.pointerId);
    };
  }

  function onTakePointerMove(event: PointerEvent<HTMLElement>) {
    if (!takeDragRef.current) return;
    const { startX, origStart, origEnd, mode, takeId } = takeDragRef.current;
    const dx = event.clientX - startX;

    if (Math.abs(dx) > 2) {
      takeDragRef.current.hasMoved = true;
    }

    const dt = dx / Math.max(pxPerSecond, 1);
    const segDur = origEnd - origStart;

    let nextStart = origStart;
    let nextEnd = origEnd;

    if (mode === "move") {
      nextStart = clamp(origStart + dt, 0, Math.max(0, span - segDur));
      nextEnd = nextStart + segDur;
    } else if (mode === "trim-l") {
      nextStart = clamp(origStart + dt, 0, origEnd - 0.2);
      nextEnd = origEnd;
    } else if (mode === "trim-r") {
      nextStart = origStart;
      nextEnd = clamp(origEnd + dt, origStart + 0.2, span);
    }

    setTakeDragInfo({
      takeId,
      start: nextStart,
      end: nextEnd,
      mode,
    });

    onTakeSegmentMove?.(takeId, nextStart, nextEnd);
  }

  function onTakePointerUp(event: PointerEvent<HTMLElement>) {
    if (!takeDragRef.current) return;
    const { hasMoved, takeId } = takeDragRef.current;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (hasMoved && takeDragInfo && takeDragInfo.takeId === takeId) {
      onTakeSegmentMoveCommit?.(
        takeId,
        takeDragInfo.start,
        takeDragInfo.end,
        takeDragInfo.mode
      );
    } else if (!hasMoved) {
      const seg = segmentsToRender.find((s) => s.id === takeId);
      if (seg) onSeek(seg.start);
    }

    takeDragRef.current = null;
    setTakeDragInfo(null);
  }

  // Dragging state for clips (moving left/right or trimming left/right)
  const [dragInfo, setDragInfo] = useState<{
    clipId: string;
    start: number;
    end: number;
    mode: "move" | "trim-l" | "trim-r";
  } | null>(null);

  const clipDragRef = useRef<{
    clipId: string;
    startX: number;
    origStart: number;
    origEnd: number;
    mode: "move" | "trim-l" | "trim-r";
    hasMoved: boolean;
  } | null>(null);

  function onClipPointerDown(
    clip: Clip,
    mode: "move" | "trim-l" | "trim-r"
  ) {
    return (event: PointerEvent<HTMLElement>) => {
      if (span <= 0) return;
      if (event.button !== 0) return; // ignore right-click
      event.preventDefault();
      event.stopPropagation();

      clipDragRef.current = {
        clipId: clip.id,
        startX: event.clientX,
        origStart: clip.start,
        origEnd: clip.end,
        mode,
        hasMoved: false,
      };

      setDragInfo({
        clipId: clip.id,
        start: clip.start,
        end: clip.end,
        mode,
      });

      onPickClip(clip.id);
      event.currentTarget.setPointerCapture(event.pointerId);
    };
  }

  function onClipPointerMove(event: PointerEvent<HTMLElement>) {
    if (!clipDragRef.current) return;
    const { startX, origStart, origEnd, mode, clipId } = clipDragRef.current;
    const dx = event.clientX - startX;

    if (Math.abs(dx) > 2) {
      clipDragRef.current.hasMoved = true;
    }

    const dt = dx / Math.max(pxPerSecond, 1);
    const clipDur = origEnd - origStart;

    let nextStart = origStart;
    let nextEnd = origEnd;

    if (mode === "move") {
      // Shift entire clip left/right along the timeline
      nextStart = clamp(origStart + dt, 0, Math.max(0, span - clipDur));
      nextEnd = nextStart + clipDur;
    } else if (mode === "trim-l") {
      // Trim start (left edge)
      nextStart = clamp(origStart + dt, 0, origEnd - 0.2);
      nextEnd = origEnd;
    } else if (mode === "trim-r") {
      // Trim end (right edge)
      nextStart = origStart;
      nextEnd = clamp(origEnd + dt, origStart + 0.2, span);
    }

    setDragInfo({
      clipId,
      start: nextStart,
      end: nextEnd,
      mode,
    });

    onClipMove?.(clipId, nextStart, nextEnd);
  }

  function onClipPointerUp(event: PointerEvent<HTMLElement>) {
    if (!clipDragRef.current) return;
    const { hasMoved, clipId } = clipDragRef.current;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (hasMoved && dragInfo && dragInfo.clipId === clipId) {
      onClipMoveCommit?.(clipId, dragInfo.start, dragInfo.end);
    } else if (!hasMoved) {
      // Just a click without drag: seek to clip start
      const clip = clips.find((c) => c.id === clipId);
      if (clip) onSeek(clip.start);
    }

    clipDragRef.current = null;
    setDragInfo(null);
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

  const segmentsToRender: TakeSegment[] =
    takeSegments && takeSegments.length > 0
      ? takeSegments
      : takeName && span > 0
        ? [
            {
              id: "take_main",
              title: takeName,
              start: takeIn,
              end: Math.min(takeOut || span, span),
            },
          ]
        : [];

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
              {segmentsToRender.map((seg) => {
                const isDragging = takeDragInfo?.takeId === seg.id;
                const activeStart = isDragging ? takeDragInfo.start : seg.start;
                const activeEnd = isDragging ? takeDragInfo.end : seg.end;
                const box = boxOf(activeStart, activeEnd, 8);
                const srcStart = seg.sourceStart !== undefined ? seg.sourceStart : activeStart;
                const srcEnd = seg.sourceEnd !== undefined ? seg.sourceEnd : activeEnd;
                const segFrames = framesBetween(srcStart, srcEnd);
                const segBars = peaksBetween(srcStart, srcEnd, 40);
                const isSelected = seg.id === selectedTakeId;

                return (
                  <div
                    key={seg.id}
                    role="button"
                    tabIndex={0}
                    className={`cut__block cut__block--take${
                      isSelected ? " is-selected" : ""
                    }${trimPulse && isSelected ? " is-trimming" : ""}${
                      isDragging ? " is-sliding is-dragging" : ""
                    }`}
                    style={{ left: `${box.left}px`, width: `${box.width}px` }}
                    title={`${seg.title} (${formatTime(activeStart)} - ${formatTime(activeEnd)})`}
                    onPointerDown={onTakePointerDown(seg, "move")}
                    onPointerMove={onTakePointerMove}
                    onPointerUp={onTakePointerUp}
                    onPointerCancel={onTakePointerUp}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onPickTakeSegment?.(seg.id);
                      onTakeContextMenu(seg.id, event.clientX, event.clientY);
                    }}
                  >
                    {segFrames ? (
                      <span className="cut__film cut__film--real" aria-hidden="true">
                        {segFrames.map((f, i) => (
                          <img key={i} src={f.src} alt="" draggable={false} />
                        ))}
                      </span>
                    ) : (
                      <span className="cut__film" aria-hidden="true" />
                    )}
                    {segBars ? (
                      <span className="cut__wave" aria-hidden="true">
                        {segBars.map((v, i) => (
                          <span key={i} style={{ height: `${18 + v * 74}%` }} />
                        ))}
                      </span>
                    ) : null}
                    <span className="cut__block-label">{seg.title}</span>
                    {isDragging ? (
                      <span className="cut__block-time-badge" aria-hidden="true">
                        {formatTime(activeStart)} - {formatTime(activeEnd)}
                      </span>
                    ) : null}
                    {/* Left Trim handle */}
                    <span
                      className="cut__trim cut__trim--l"
                      aria-label="Trim left edge"
                      onPointerDown={onTakePointerDown(seg, "trim-l")}
                      onPointerMove={onTakePointerMove}
                      onPointerUp={onTakePointerUp}
                      onPointerCancel={onTakePointerUp}
                    />
                    {/* Right Trim handle */}
                    <span
                      className="cut__trim cut__trim--r"
                      aria-label="Trim right edge"
                      onPointerDown={onTakePointerDown(seg, "trim-r")}
                      onPointerMove={onTakePointerMove}
                      onPointerUp={onTakePointerUp}
                      onPointerCancel={onTakePointerUp}
                    />
                  </div>
                );
              })}
            </div>

            <div className="cut__track cut__track--clips" role="presentation">
              <span className="cut__track-name">Cuts</span>
              {clips.map((clip) => {
                const isDragging = dragInfo?.clipId === clip.id;
                const activeStart = isDragging ? dragInfo.start : clip.start;
                const activeEnd = isDragging ? dragInfo.end : clip.end;
                const box = boxOf(activeStart, activeEnd, 8);
                const clipFrames = framesBetween(activeStart, activeEnd);
                const bars =
                  peaksBetween(activeStart, activeEnd, 22) ?? seeded(clip.id, 22);
                return (
                  <div
                    key={clip.id}
                    role="button"
                    tabIndex={0}
                    className={`cut__block cut__block--clip${
                      clip.id === selectedClipId ? " is-selected" : ""
                    }${clip.frozen ? " is-frozen" : ""}${
                      isDragging ? " is-dragging" : ""
                    }`}
                    style={{ left: `${box.left}px`, width: `${box.width}px` }}
                    title={`${clip.title} (${formatTime(activeStart)} - ${formatTime(activeEnd)})`}
                    onPointerDown={onClipPointerDown(clip, "move")}
                    onPointerMove={onClipPointerMove}
                    onPointerUp={onClipPointerUp}
                    onPointerCancel={onClipPointerUp}
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
                    {isDragging ? (
                      <span className="cut__block-time-badge" aria-hidden="true">
                        {formatTime(activeStart)} - {formatTime(activeEnd)}
                      </span>
                    ) : null}
                    {clip.frozen ? (
                      <span className="cut__block-frozen" aria-hidden="true">
                        <Snowflake />
                      </span>
                    ) : null}
                    {/* Left Trim handle */}
                    <span
                      className="cut__trim cut__trim--l"
                      aria-label="Trim left edge"
                      onPointerDown={onClipPointerDown(clip, "trim-l")}
                      onPointerMove={onClipPointerMove}
                      onPointerUp={onClipPointerUp}
                      onPointerCancel={onClipPointerUp}
                    />
                    {/* Right Trim handle */}
                    <span
                      className="cut__trim cut__trim--r"
                      aria-label="Trim right edge"
                      onPointerDown={onClipPointerDown(clip, "trim-r")}
                      onPointerMove={onClipPointerMove}
                      onPointerUp={onClipPointerUp}
                      onPointerCancel={onClipPointerUp}
                    />
                  </div>
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
