"use client";

import { motion } from "motion/react";
import { DUR, EASE, VIEWPORT } from "@/lib/motion";
import { useReducedMotionSafe } from "@/components/motion/useReducedMotionSafe";
type PostItem = {
  id?: string;
  day: string;
  views: number;
  verdict?: "hit" | "mid" | "flop";
};

type ViewsBarsProps = {
  posts: PostItem[];
  median: number;
};

const W = 640;
const H = 250;
const PAD = { top: 40, right: 14, bottom: 30, left: 48 };

/** Rounds up to a readable axis maximum (4200 -> 5000, 15100 -> 16000). */
function niceMax(value: number) {
  if (value <= 0) return 1000;
  const step = Math.pow(10, Math.floor(Math.log10(value))) / 2;
  return Math.ceil(value / step) * step;
}

function short(value: number) {
  return value >= 1000 ? `${Math.round(value / 100) / 10}k` : `${value}`;
}

/**
 * Weekly views as vertical bars, coloured by verdict, with a dashed median rule
 * and a floating legend pill carrying the week's total. Hand-rolled SVG to match
 * ViewsArea — no charting dependency. Bars grow up from the baseline on reveal.
 */
export default function ViewsBars({ posts, median }: ViewsBarsProps) {
  const reduced = useReducedMotionSafe();

  if (!posts || posts.length === 0) {
    return (
      <div
        className="chart-empty"
        style={{
          padding: "54px 24px",
          textAlign: "center",
          color: "var(--text-muted, #888)",
        }}
      >
        <p style={{ fontWeight: 500, fontSize: "0.95rem" }}>No published posts yet</p>
        <p style={{ fontSize: "0.85rem", marginTop: 6, opacity: 0.8 }}>
          Post cuts or connect your YouTube channel to see views compared against your median.
        </p>
      </div>
    );
  }

  const series = posts.map((p) => ({ day: p.day, views: p.views }));

  const total = series.reduce((sum, point) => sum + point.views, 0);
  const top = niceMax(Math.max(...series.map((p) => p.views), median));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const baseY = PAD.top + plotH;

  const band = plotW / series.length;
  const barW = Math.min(band * 0.54, 46);

  const bars = series.map((point, index) => {
    const barH = (point.views / top) * plotH;
    return {
      ...point,
      x: PAD.left + band * (index + 0.5) - barW / 2,
      y: baseY - barH,
      h: barH,
      verdict: posts.find((p) => p.day === point.day)?.verdict,
    };
  });

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({
    value: top * fraction,
    y: baseY - fraction * plotH,
  }));

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Views per day for the last ${series.length} posts, totalling ${total.toLocaleString()} against a median of ${median.toLocaleString()}`}
    >
      {ticks.map((tick) => (
        <g key={tick.value}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={tick.y}
            y2={tick.y}
            className="chart__grid"
          />
          <text
            x={PAD.left - 10}
            y={tick.y + 4}
            className="chart__tick"
            textAnchor="end"
          >
            {short(Math.round(tick.value))}
          </text>
        </g>
      ))}

      {bars.map((bar, index) => (
        <motion.rect
          key={bar.day}
          x={bar.x}
          width={barW}
          rx={6}
          className={`bar${bar.verdict ? ` is-${bar.verdict}` : ""}`}
          initial={reduced ? { y: bar.y, height: bar.h } : { y: baseY, height: 0 }}
          whileInView={{ y: bar.y, height: bar.h }}
          viewport={VIEWPORT}
          transition={{ duration: DUR.base, ease: EASE, delay: 0.1 + index * 0.06 }}
        />
      ))}

      <line
        x1={PAD.left}
        x2={W - PAD.right}
        y1={baseY - (median / top) * plotH}
        y2={baseY - (median / top) * plotH}
        className="chart__median"
      />
      <text
        x={W - PAD.right}
        y={baseY - (median / top) * plotH - 7}
        className="chart__tick"
        textAnchor="end"
      >
        median {short(median)}
      </text>

      {bars.map((bar) => (
        <text
          key={`label-${bar.day}`}
          x={bar.x + barW / 2}
          y={H - 8}
          className="chart__tick"
          textAnchor="middle"
        >
          {bar.day}
        </text>
      ))}

      {/* Floating legend pill — the week's running total, Efferd-style. */}
      <g className="chart__pill">
        <rect
          x={PAD.left + 4}
          y={8}
          width={132}
          height={44}
          rx={10}
        />
        <text x={PAD.left + 18} y={26} className="chart__pill-label">
          Views
        </text>
        <text x={PAD.left + 18} y={44} className="chart__pill-value">
          {total.toLocaleString()}
        </text>
      </g>
    </svg>
  );
}
