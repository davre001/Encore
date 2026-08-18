"use client";

import { useEffect, useRef } from "react";
import { motion, useInView, useSpring, useTransform } from "motion/react";
import { useReducedMotionSafe } from "./useReducedMotionSafe";

type CountUpProps = {
  value: number;
  /** Defaults to a thousands-separated integer. */
  format?: (value: number) => string;
  suffix?: string;
  className?: string;
};

function thousands(value: number) {
  return Math.round(value).toLocaleString();
}

/**
 * Counts up to `value` once it scrolls into view.
 *
 * Callers should give the target element `font-variant-numeric: tabular-nums`,
 * otherwise the box width jitters as the digits change.
 */
export default function CountUp({
  value,
  format = thousands,
  suffix = "",
  className,
}: CountUpProps) {
  const reduced = useReducedMotionSafe();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const progress = useSpring(0, { stiffness: 90, damping: 26, mass: 1 });
  const text = useTransform(progress, (n) => `${format(n)}${suffix}`);

  useEffect(() => {
    if (inView && !reduced) progress.set(value);
  }, [inView, reduced, progress, value]);

  if (reduced) {
    return (
      <span className={className}>
        {format(value)}
        {suffix}
      </span>
    );
  }

  return (
    <motion.span ref={ref} className={className}>
      {text}
    </motion.span>
  );
}
