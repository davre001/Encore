"use client";

import { motion } from "motion/react";

/** Block-level tags the motion primitives can render as. */
export const TAGS = {
  div: motion.div,
  main: motion.main,
  section: motion.section,
  article: motion.article,
  header: motion.header,
  ul: motion.ul,
  ol: motion.ol,
  li: motion.li,
  p: motion.p,
  tbody: motion.tbody,
  tr: motion.tr,
} as const;

export type Tag = keyof typeof TAGS;

export function tagOf(as: Tag) {
  return TAGS[as] as typeof motion.div;
}
