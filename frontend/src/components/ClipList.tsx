"use client";

import { AnimatePresence, motion } from "motion/react";
import type { Clip } from "@/types";
import ClipCard from "./ClipCard";

type ClipListProps = {
  clips: Clip[];
  onChange: (clip: Clip) => void;
  onPost: (id: string) => void;
};

export default function ClipList({ clips, onChange, onPost }: ClipListProps) {
  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Clips</h2>
        <span className="panel__meta">
          {clips.length ? `${clips.filter((c) => !c.posted).length} unposted` : "Keep a moment first"}
        </span>
      </div>
      {clips.length === 0 ? (
        <p className="panel__empty">
          Accepted moments become cuts with title, caption, and hashtags.
        </p>
      ) : (
        <motion.div className="clip-list" layout>
          <AnimatePresence initial={false}>
            {clips.map((clip) => (
              <ClipCard
                key={clip.id}
                clip={clip}
                onChange={onChange}
                onPost={onPost}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </section>
  );
}
