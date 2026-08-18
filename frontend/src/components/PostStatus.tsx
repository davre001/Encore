"use client";

import { AnimatePresence, motion } from "motion/react";
import type { PostCheck } from "@/types";
import { springSoft } from "@/lib/motion";

type PostStatusProps = {
  checks: PostCheck[];
  onRecut?: (clipId: string) => void;
};

export default function PostStatus({ checks, onRecut }: PostStatusProps) {
  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Live check</h2>
        <span className="panel__meta">
          {checks.length ? "Compared to your median" : "After a post lands"}
        </span>
      </div>
      {checks.length === 0 ? (
        <p className="panel__empty">
          Encore watches the live URL and comes back with hit, mid, or flop — no prompt from you.
        </p>
      ) : (
        <motion.div className="post-status" layout>
          <AnimatePresence initial={false}>
            {checks.map((check) => (
              <motion.article
                key={check.postId}
                className={`post-card${check.verdict === "hit" ? " is-hit" : ""}${check.verdict === "flop" ? " is-flop" : ""}`}
                layout
                initial={{ opacity: 0, y: -12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.98 }}
                transition={springSoft}
              >
                <div className="post-card__verdict">{check.verdict}</div>
                <p>
                  {check.views.toLocaleString()} views · median{" "}
                  {check.median.toLocaleString()}
                </p>
                <p>{check.note}</p>
                {check.recutHook ? (
                  <>
                    <p>
                      <strong>Recut:</strong> {check.recutHook}
                    </p>
                    {onRecut ? (
                      <button
                        type="button"
                        className="btn btn--primary btn--small"
                        onClick={() => onRecut(check.clipId)}
                      >
                        Queue recut
                      </button>
                    ) : null}
                  </>
                ) : null}
              </motion.article>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </section>
  );
}
