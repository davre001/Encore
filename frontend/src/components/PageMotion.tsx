"use client";

import { motion } from "motion/react";
import { useRef, type ReactNode } from "react";

/*
 * Persists across the remounts `template.tsx` triggers on every navigation.
 * The very first mount of a session (a hard load or refresh) renders content
 * immediately — `initial={false}` skips the enter animation, so nothing is
 * held at `opacity: 0` waiting on hydration. Only client-side route changes
 * after that play the fade, which is where the transition actually reads.
 *
 * The flag is read and written ONLY on the client. On the server it would
 * leak across requests (Node keeps module state alive), so a later SSR render
 * would emit the `opacity: 0` enter branch while the fresh client always
 * hydrates from `false` — a mismatch React "won't patch up". Guarding on
 * `window` keeps SSR always settled, so the first client render matches it.
 */
let clientMountedOnce = false;

export default function PageMotion({ children }: { children: ReactNode }) {
  const animateEnter = useRef(
    typeof window !== "undefined" && clientMountedOnce,
  );
  if (typeof window !== "undefined") clientMountedOnce = true;

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
