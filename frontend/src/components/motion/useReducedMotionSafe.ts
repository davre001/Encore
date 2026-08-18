"use client";

import { useReducedMotion } from "motion/react";

/**
 * `useReducedMotion()` resolves to `null` until the media query is read.
 * Coerce that to `false` so callers get one honest boolean and the first
 * paint never sticks in a hidden state.
 *
 * This is needed because the `prefers-reduced-motion` block in motion.css
 * only stops CSS animation — it cannot stop JS-driven motion.
 */
export function useReducedMotionSafe(): boolean {
  return useReducedMotion() ?? false;
}
