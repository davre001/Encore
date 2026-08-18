"use client";

import { AnimatePresence, motion } from "motion/react";
import type { Moment } from "@/types";
import { DUR, EASE } from "@/lib/motion";
import MomentCard from "./MomentCard";

type MomentListProps = {
  moments: Moment[];
  onDecide: (id: string, decision: "accept" | "reject") => void;
};

export default function MomentList({ moments, onDecide }: MomentListProps) {
  const waiting = moments.filter((m) => m.status === "pending").length;

  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Moments</h2>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={moments.length ? waiting : "empty"}
            className="panel__meta"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: DUR.fast, ease: EASE }}
          >
            {moments.length ? `${waiting} waiting` : "Upload first"}
          </motion.span>
        </AnimatePresence>
      </div>

      {moments.length === 0 ? (
        <p className="panel__empty">
          After Encore watches the file, suggested cuts land here with a one-line why.
        </p>
      ) : (
        <motion.div className="moment-list" layout>
          <AnimatePresence initial={false}>
            {moments.map((moment) => (
              <MomentCard key={moment.id} moment={moment} onDecide={onDecide} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </section>
  );
}
