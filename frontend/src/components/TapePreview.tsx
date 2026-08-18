"use client";

import { useRef, useState } from "react";
import { motion, useInView, type Variants } from "motion/react";
import { useReducedMotionSafe } from "@/components/motion/useReducedMotionSafe";
import { DUR, EASE, springSnappy, springSoft, staggerContainer } from "@/lib/motion";

const FILM_CELLS = [0, 1, 2, 3, 4, 5];

const TAKES = [
  { range: "0:18–0:41", label: "confession hook", verdict: "Keep", tone: "take--yes" },
  { range: "1:02–1:28", label: "talking-head tip", verdict: "Skip", tone: "take--no" },
  { range: "2:10–2:31", label: "exam-panic rant", verdict: "Later", tone: "" },
];

const cellReveal: Variants = {
  hidden: { opacity: 0.2, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } },
};

/**
 * `.take--no` is dimmed to 0.55 in CSS, and an inline opacity from Motion would
 * override that — so the dimmed row animates to its own resting opacity.
 */
function takeReveal(dim: boolean): Variants {
  return {
    hidden: { opacity: 0, x: -12 },
    show: {
      opacity: dim ? 0.55 : 1,
      x: 0,
      transition: { duration: DUR.base, ease: EASE },
    },
  };
}

const stampReveal: Variants = {
  hidden: { opacity: 0, scale: 0.7 },
  show: { opacity: 1, scale: 1, transition: { ...springSnappy, delay: 0.14 } },
};

/**
 * The film-strip / keep-skip "tape" graphic. Plays its sweep and stamp sequence
 * the first time it scrolls into view, and replays on hover.
 *
 * Extracted from the landing hero when that hero was replaced by
 * `AnimatedMarqueeHero`. Styling still lives under `.hero__stage` / `.tape` in
 * styles/landing.css, so render it inside an element with those classes.
 */
export default function TapePreview() {
  const reduced = useReducedMotionSafe();
  const tapeRef = useRef<HTMLDivElement>(null);
  const tapeInView = useInView(tapeRef, { once: true, amount: 0.4 });
  const [replay, setReplay] = useState(0);

  const tapeState = reduced || tapeInView ? "show" : "hidden";

  return (
    <motion.div
      ref={tapeRef}
      className="tape"
      initial={reduced ? undefined : { opacity: 0, y: 18 }}
      animate={reduced ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: DUR.slow, ease: EASE, delay: 0.12 }}
      whileHover={reduced ? undefined : { rotate: -1.2, y: -6 }}
      onHoverStart={() => {
        if (!reduced) setReplay((count) => count + 1);
      }}
    >
      <header className="tape__top">
        <span className="tape__dot" />
        <span>study-vlog-final.mp4</span>
        <span>12:04</span>
      </header>

      <motion.div
        key={`film-${replay}`}
        className="tape__film"
        initial={reduced ? "show" : "hidden"}
        animate={tapeState}
        variants={staggerContainer(0.075, 0.35)}
      >
        {FILM_CELLS.map((cell) => (
          <motion.span key={cell} variants={cellReveal} />
        ))}
      </motion.div>

      <motion.ul
        key={`takes-${replay}`}
        className="takes"
        initial={reduced ? "show" : "hidden"}
        animate={tapeState}
        variants={staggerContainer(0.12, 0.72)}
      >
        {TAKES.map((take) => (
          <motion.li
            key={take.range}
            className={`take ${take.tone}`.trim()}
            variants={takeReveal(take.tone === "take--no")}
            whileHover={reduced ? undefined : { y: -3 }}
            transition={springSoft}
          >
            <strong>{take.range}</strong>
            <em>{take.label}</em>
            <motion.span variants={reduced ? undefined : stampReveal}>
              {take.verdict}
            </motion.span>
          </motion.li>
        ))}
      </motion.ul>

      <p className="tape__note">
        Night 2 · Clip 1 is 3× your median. Recut queued for the flop.
      </p>
    </motion.div>
  );
}
