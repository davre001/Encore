"use client";

import { motion } from "motion/react";
import { useRef, type ReactNode } from "react";

/*
 * Persists across the remounts `template.tsx` triggers on every navigation.
 * The very first mount of a session (a hard load or refresh) renders content
 * immediately — `initial={false}` skips the enter animation, so nothing is
 * held at `opacity: 0` waiting on hydration. Only client-side route changes
 * after that play the fade, which is where the transition actually reads.
 */
let seenFirstMount = false;

export default function PageMotion({ children }: { children: ReactNode }) {
  const animateEnter = useRef(seenFirstMount);
  seenFirstMount = true;

  return (
    <motion.div
      initial={animateEnter.current ? { opacity: 0, y: 10 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
