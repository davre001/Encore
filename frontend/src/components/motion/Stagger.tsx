"use client";

import type { HTMLMotionProps } from "motion/react";
import { VIEWPORT, staggerContainer, staggerItem } from "@/lib/motion";
import { tagOf, type Tag } from "./tags";
import { useReducedMotionSafe } from "./useReducedMotionSafe";

type StaggerProps = HTMLMotionProps<"div"> & {
  as?: Tag;
  stagger?: number;
  delayChildren?: number;
  /**
   * `true` (default) gates the reveal on scrolling into view — right for
   * scroll sections. Set `false` for interactive lists whose children mount and
   * unmount (e.g. a filterable list inside `AnimatePresence`): `whileInView`
   * fires `once` and then stops observing, so items remounted afterwards never
   * receive the `show` variant and stay stuck at `opacity: 0`. A plain
   * `animate="show"` keeps driving every child, including late arrivals.
   */
  inView?: boolean;
};

/**
 * Reveals its `<StaggerItem>` children one after another, replacing
 * hand-rolled `delay: index * n` maths.
 */
export function Stagger({
  as = "div",
  stagger = 0.07,
  delayChildren = 0,
  inView = true,
  children,
  ...rest
}: StaggerProps) {
  const reduced = useReducedMotionSafe();
  const Motion = tagOf(as);

  if (reduced) {
    return <Motion {...rest}>{children}</Motion>;
  }

  const trigger = inView
    ? { initial: "hidden" as const, whileInView: "show" as const, viewport: VIEWPORT }
    : { initial: "hidden" as const, animate: "show" as const };

  return (
    <Motion {...trigger} variants={staggerContainer(stagger, delayChildren)} {...rest}>
      {children}
    </Motion>
  );
}

type StaggerItemProps = HTMLMotionProps<"div"> & {
  as?: Tag;
};

export function StaggerItem({ as = "div", children, ...rest }: StaggerItemProps) {
  const reduced = useReducedMotionSafe();
  const Motion = tagOf(as);

  if (reduced) {
    return <Motion {...rest}>{children}</Motion>;
  }

  return (
    <Motion variants={staggerItem} {...rest}>
      {children}
    </Motion>
  );
}
