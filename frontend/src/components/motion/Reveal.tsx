"use client";

import type { HTMLMotionProps } from "motion/react";
import { VIEWPORT, fadeUp } from "@/lib/motion";
import { tagOf, type Tag } from "./tags";
import { useReducedMotionSafe } from "./useReducedMotionSafe";

type RevealProps = HTMLMotionProps<"div"> & {
  as?: Tag;
};

/** Fades and lifts its contents into place the first time they scroll into view. */
export default function Reveal({ as = "div", children, ...rest }: RevealProps) {
  const reduced = useReducedMotionSafe();
  const Motion = tagOf(as);

  if (reduced) {
    return <Motion {...rest}>{children}</Motion>;
  }

  return (
    <Motion
      initial="hidden"
      whileInView="show"
      viewport={VIEWPORT}
      variants={fadeUp}
      {...rest}
    >
      {children}
    </Motion>
  );
}
