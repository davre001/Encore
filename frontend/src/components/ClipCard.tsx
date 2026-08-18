"use client";

import { AnimatePresence, motion } from "motion/react";
import type { Clip } from "@/types";
import { formatTime } from "@/lib/format";
import { DUR, EASE, hoverLift, springSoft } from "@/lib/motion";

type ClipCardProps = {
  clip: Clip;
  onChange: (clip: Clip) => void;
  onPost: (id: string) => void;
};

export default function ClipCard({ clip, onChange, onPost }: ClipCardProps) {
  return (
    <motion.article
      className="clip-card"
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={springSoft}
      whileHover={hoverLift}
    >
      <div className="clip-card__top">
        <span className="clip-card__time">
          {formatTime(clip.start)}–{formatTime(clip.end)}
        </span>
        <span className="clip-card__title">{clip.title}</span>
      </div>

      <div className="field">
        <label htmlFor={`title-${clip.id}`}>Title</label>
        <input
          id={`title-${clip.id}`}
          value={clip.title}
          onChange={(e) => onChange({ ...clip, title: e.target.value })}
          disabled={clip.posted}
        />
      </div>

      <div className="field">
        <label htmlFor={`caption-${clip.id}`}>Caption</label>
        <textarea
          id={`caption-${clip.id}`}
          rows={3}
          value={clip.caption}
          onChange={(e) => onChange({ ...clip, caption: e.target.value })}
          disabled={clip.posted}
        />
      </div>

      <div className="clip-card__tags">
        {clip.hashtags.map((tag) => (
          <span key={tag} className="chip">
            {tag}
          </span>
        ))}
      </div>

      <div className="clip-card__actions">
        <AnimatePresence mode="wait" initial={false}>
          {clip.posted ? (
            <motion.a
              key="open"
              href={clip.postUrl}
              target="_blank"
              rel="noreferrer"
              className="btn btn--ghost-solid btn--small"
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: DUR.fast, ease: EASE }}
              /* Motion owns transform here, so .btn:hover / :active cannot apply. */
              whileHover={{ y: -2 }}
              whileTap={{ y: 1, scale: 0.97 }}
            >
              Open post
            </motion.a>
          ) : (
            <motion.button
              key="post"
              type="button"
              className="btn btn--primary btn--small"
              onClick={() => onPost(clip.id)}
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: DUR.fast, ease: EASE }}
              whileHover={{ y: -2 }}
              whileTap={{ y: 1, scale: 0.97 }}
            >
              Post to YouTube
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </motion.article>
  );
}
