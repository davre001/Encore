"use client";

import { motion, type Variants } from "motion/react";
import { EASE, VIEWPORT, staggerContainer } from "@/lib/motion";
import { useReducedMotionSafe } from "./motion/useReducedMotionSafe";
import { daySeries, type AnalyticsPost } from "@/lib/mockAnalytics";

type BarsProps = {
  posts: AnalyticsPost[];
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
  const series = daySeries(posts);
  const maxViews = Math.max(...series.map((point) => point.views), median);

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
