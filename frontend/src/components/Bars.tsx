"use client";

import { motion, type Variants } from "motion/react";
import { EASE, VIEWPORT, staggerContainer } from "@/lib/motion";
import { useReducedMotionSafe } from "./motion/useReducedMotionSafe";
type PostItem = {
  id?: string;
  day: string;
  views: number;
  verdict?: "hit" | "mid" | "flop";
};

type BarsProps = {
  posts: PostItem[];
  median: number;
  /** Extra class alongside `.bars`, e.g. `home__bars`. */
  className?: string;
};

const barReveal: Variants = {
  hidden: { height: "0%" },
  show: (percent: number) => ({
    height: `${percent}%`,
    transition: { duration: 0.6, ease: EASE },
  }),
};

/**
 * Weekly views against the median. Bars grow from nothing to their real value,
 * one after another, the first time the chart scrolls into view.
 *
 * Shared by Home and Analytics, which previously carried identical copies of
 * this markup.
 */
export default function Bars({ posts, median, className }: BarsProps) {
  const reduced = useReducedMotionSafe();

  if (!posts || posts.length === 0) {
    return (
      <div
        className={className ? `bars-empty ${className}` : "bars-empty"}
        style={{
          padding: "36px 16px",
          textAlign: "center",
          color: "var(--text-muted, #888)",
        }}
      >
        <p style={{ fontWeight: 500, fontSize: "0.9rem" }}>No posts published yet</p>
        <p style={{ fontSize: "0.8rem", marginTop: 4, opacity: 0.75 }}>
          Published cuts will show here with their view volume vs median.
        </p>
      </div>
    );
  }

  const series = posts.map((p) => ({ day: p.day, views: p.views }));
  const maxViews = Math.max(...series.map((point) => point.views), median, 1);

  return (
    <motion.div
      className={className ? `bars ${className}` : "bars"}
      aria-hidden="true"
      initial={reduced ? "show" : "hidden"}
      whileInView="show"
      viewport={VIEWPORT}
      variants={staggerContainer(0.06)}
    >
      {series.map((point) => {
        const post = posts.find((item) => item.day === point.day);
        const percent = (point.views / maxViews) * 100;

        return (
          <div key={point.day} className="bars__col">
            <div className="bars__stack">
              <span
                className="bars__median"
                style={{ bottom: `${(median / maxViews) * 100}%` }}
              />
              <motion.span
                className={`bars__fill${post ? ` is-${post.verdict}` : ""}`}
                custom={percent}
                variants={barReveal}
              />
            </div>
            <span className="bars__day">{point.day}</span>
          </div>
        );
      })}
    </motion.div>
  );
}
