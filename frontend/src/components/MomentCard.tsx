"use client";

import { AnimatePresence, motion } from "motion/react";
import type { Moment } from "@/types";
import { formatTime } from "@/lib/format";
import { DUR, EASE, hoverLift, springSoft } from "@/lib/motion";

type MomentCardProps = {
  moment: Moment;
  onDecide: (id: string, decision: "accept" | "reject") => void;
};

export default function MomentCard({ moment, onDecide }: MomentCardProps) {
  const statusClass =
    moment.status === "accepted"
      ? " is-accepted"
      : moment.status === "rejected"
        ? " is-rejected"
        : "";

  return (
    <motion.article
      className={`moment-card${statusClass}`}
      layout
      initial={{ opacity: 0, y: 12 }}
      /*
       * `.moment-card.is-rejected` dims to 0.5 in editor.css. An inline opacity
       * of 1 from Motion would override that, so the resting opacity is decided
       * here instead of in CSS.
       */
      animate={{ opacity: moment.status === "rejected" ? 0.5 : 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={springSoft}
      whileHover={hoverLift}
    >
      <div className="moment-card__top">
        <span className="moment-card__time">
          {formatTime(moment.start)}–{formatTime(moment.end)}
        </span>
        <span className="moment-card__label">{moment.label}</span>
      </div>
      <p className="moment-card__reason">{moment.reason}</p>

      <AnimatePresence mode="wait" initial={false}>
        {moment.status === "pending" ? (
          <motion.div
            key="actions"
            className="moment-card__actions"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: DUR.fast, ease: EASE }}
          >
            <button
              type="button"
              className="btn btn--primary btn--small"
              onClick={() => onDecide(moment.id, "accept")}
            >
              Keep
            </button>
            <button
              type="button"
              className="btn btn--danger btn--small"
              onClick={() => onDecide(moment.id, "reject")}
            >
              Skip
            </button>
          </motion.div>
        ) : (
          <motion.p
            key="status"
            className="panel__meta"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: DUR.fast, ease: EASE }}
          >
            {moment.status === "accepted"
              ? "Kept — clip ready below"
              : "Skipped — notebook updated"}
          </motion.p>
        )}
      </AnimatePresence>
    </motion.article>
  );
}
