"use client";

import { motion } from "motion/react";
import { EASE, VIEWPORT } from "@/lib/motion";
import { useReducedMotionSafe } from "@/components/motion/useReducedMotionSafe";

type VerdictDonutProps = {
  hits: number;
  mids: number;
  flops: number;
};

const R = 54;
const SIZE = 140;

/**
 * Hit / mid / flop split as a donut.
 *
 * Uses Motion's `pathLength` and `pathOffset` on `<circle>`, which handle the
 * stroke-dasharray maths in normalised 0–1 units — so each arc is just a
 * fraction and an offset, and animates from nothing.
 */
export default function VerdictDonut({ hits, mids, flops }: VerdictDonutProps) {
  const reduced = useReducedMotionSafe();
  const total = hits + mids + flops;

  const segments = [
    { key: "hit", label: "Hits", count: hits, tone: "is-hit" },
    { key: "mid", label: "Mid", count: mids, tone: "is-mid" },
    { key: "flop", label: "Flops", count: flops, tone: "is-flop" },
  ].filter((segment) => segment.count > 0);

  let running = 0;
  const arcs = segments.map((segment) => {
    const fraction = total ? segment.count / total : 0;
    const offset = running;
    running += fraction;
    return { ...segment, fraction, offset };
  });

  return (
    <div className="donut">
      <div className="donut__ring">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={`${hits} hits, ${mids} mid, ${flops} flops out of ${total} posts`}
        >
          {/* -90deg so the first arc starts at the top */}
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            <circle cx={SIZE / 2} cy={SIZE / 2} r={R} className="donut__track" />
            {arcs.map((arc) => (
              <motion.circle
                key={arc.key}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={R}
                className={`donut__arc ${arc.tone}`}
                /*
                 * `pathOffset` is not a real SVG attribute, so it can only be
                 * set through initial/animate — passing it as a static prop is
                 * a type error. `pathLength` starts at 0 so the arc sweeps in.
                 */
                initial={{
                  pathLength: reduced ? arc.fraction : 0,
                  pathOffset: arc.offset,
                }}
                whileInView={{ pathLength: arc.fraction, pathOffset: arc.offset }}
                viewport={VIEWPORT}
                transition={reduced ? { duration: 0 } : { duration: 0.9, ease: EASE }}
              />
            ))}
          </g>
        </svg>
        <div className="donut__center">
          <strong>{total}</strong>
          <span>posts</span>
        </div>
      </div>

      <ul className="donut__legend">
        {[
          { label: "Hits", count: hits, tone: "is-hit" },
          { label: "Mid", count: mids, tone: "is-mid" },
          { label: "Flops", count: flops, tone: "is-flop" },
        ].map((row) => (
          <li key={row.label}>
            <span className={`donut__swatch ${row.tone}`} aria-hidden="true" />
            <span className="donut__label">{row.label}</span>
            <span className="donut__value">
              {row.count}
              <em>{total ? Math.round((row.count / total) * 100) : 0}%</em>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
