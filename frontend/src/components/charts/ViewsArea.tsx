"use client";

import { useId } from "react";
import { motion } from "motion/react";
import { DUR, EASE, VIEWPORT } from "@/lib/motion";
import { useReducedMotionSafe } from "@/components/motion/useReducedMotionSafe";
import { daySeries, type AnalyticsPost } from "@/lib/mockAnalytics";

type ViewsAreaProps = {
  posts: AnalyticsPost[];
  median: number;
};

const W = 640;
const H = 250;
const PAD = { top: 14, right: 14, bottom: 30, left: 48 };

/** Rounds up to a readable axis maximum (4200 -> 5000, 15100 -> 16000). */
function niceMax(value: number) {
  const step = Math.pow(10, Math.floor(Math.log10(value))) / 2;
  return Math.ceil(value / step) * step;
}

function short(value: number) {
  return value >= 1000 ? `${Math.round(value / 100) / 10}k` : `${value}`;
}

/**
 * Weekly views as a line + gradient area, with a dashed rule at the median.
 * Hand-rolled SVG, matching how Bars.tsx is built — no charting dependency.
 */
export default function ViewsArea({ posts, median }: ViewsAreaProps) {
  const reduced = useReducedMotionSafe();
  const gradientId = useId();
  const series = daySeries(posts);

  const top = niceMax(Math.max(...series.map((p) => p.views), median));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const x = (index: number) =>
    PAD.left + (series.length === 1 ? plotW / 2 : (index / (series.length - 1)) * plotW);
  const y = (value: number) => PAD.top + plotH - (value / top) * plotH;

  const points = series.map((point, index) => ({
    ...point,
    cx: x(index),
    cy: y(point.views),
    verdict: posts.find((p) => p.day === point.day)?.verdict,
  }));

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.cx} ${p.cy}`).join(" ");
  const area = `${line} L ${points[points.length - 1].cx} ${PAD.top + plotH} L ${points[0].cx} ${PAD.top + plotH} Z`;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({
    value: top * fraction,
    y: y(top * fraction),
  }));

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Views per day for the last ${series.length} posts, against a median of ${median.toLocaleString()}`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--paper)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--paper)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {ticks.map((tick) => (
        <g key={tick.value}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={tick.y}
            y2={tick.y}
            className="chart__grid"
          />
          <text x={PAD.left - 10} y={tick.y + 4} className="chart__tick" textAnchor="end">
            {short(Math.round(tick.value))}
          </text>
        </g>
      ))}

      <motion.path
        d={area}
        fill={`url(#${gradientId})`}
        initial={reduced ? undefined : { opacity: 0 }}
        whileInView={reduced ? undefined : { opacity: 1 }}
        viewport={VIEWPORT}
        transition={{ duration: DUR.slow, ease: EASE, delay: 0.25 }}
      />

      <motion.path
        d={line}
        className="chart__line"
        initial={reduced ? undefined : { pathLength: 0 }}
        whileInView={reduced ? undefined : { pathLength: 1 }}
        viewport={VIEWPORT}
        transition={{ duration: 1.1, ease: EASE }}
      />

      <line
        x1={PAD.left}
        x2={W - PAD.right}
        y1={y(median)}
        y2={y(median)}
        className="chart__median"
      />
      <text x={W - PAD.right} y={y(median) - 7} className="chart__tick" textAnchor="end">
        median {short(median)}
      </text>

      {points.map((point, index) => (
        <motion.circle
          key={point.day}
          cx={point.cx}
          cy={point.cy}
          r={4}
          className={`chart__dot${point.verdict ? ` is-${point.verdict}` : ""}`}
          initial={reduced ? undefined : { scale: 0, opacity: 0 }}
          whileInView={reduced ? undefined : { scale: 1, opacity: 1 }}
          viewport={VIEWPORT}
          transition={{ duration: DUR.fast, ease: EASE, delay: 0.35 + index * 0.07 }}
        />
      ))}

      {points.map((point) => (
        <text
          key={`label-${point.day}`}
          x={point.cx}
          y={H - 8}
          className="chart__tick"
          textAnchor="middle"
        >
          {point.day}
        </text>
      ))}
    </svg>
  );
}
