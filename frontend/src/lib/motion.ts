import type { Transition, Variants } from "motion/react";

/**
 * House easing curve. Already used by motion.css, PageMotion, Landing and Home —
 * every new animation should share it so the whole app moves the same way.
 */
export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const DUR = {
  fast: 0.25,
  base: 0.45,
  slow: 0.65,
} as const;

/** Matches the viewport settings the existing Landing sections already use. */
export const VIEWPORT = { once: true, amount: 0.25 } as const;

export const springSoft: Transition = {
  type: "spring",
  stiffness: 220,
  damping: 30,
  mass: 0.9,
};

export const springSnappy: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 34,
  mass: 0.7,
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: EASE },
  },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: DUR.base, ease: EASE } },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE } },
};

export function staggerContainer(stagger = 0.07, delayChildren = 0): Variants {
  return {
    hidden: {},
    show: { transition: { staggerChildren: stagger, delayChildren } },
  };
}

/** Slides a line up into place. Needs a parent with `overflow: hidden`. */
export const lineReveal: Variants = {
  hidden: { y: "110%" },
  show: { y: "0%", transition: { duration: DUR.slow, ease: EASE } },
};

/**
 * The hover lift for cards and panels. This lives in JS rather than CSS because
 * Motion writes `transform` inline on animated elements, which would override a
 * CSS `:hover` transform. motion.css still handles the border and shadow half.
 */
export const hoverLift = { y: -3 } as const;
