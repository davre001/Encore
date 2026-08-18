"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Video } from "@/types";
import { formatTime } from "@/lib/format";
import { DUR, EASE, springSoft } from "@/lib/motion";

type UploadPanelProps = {
  video: Video | null;
  busy: boolean;
  onUpload: (file: File) => void;
  onReset: () => void;
};

export default function UploadPanel({
  video,
  busy,
  onUpload,
  onReset,
}: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  function takeFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("video/")) return;
    onUpload(file);
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Source</h2>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={busy ? "busy" : video ? "ready" : "waiting"}
            className="panel__meta"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: DUR.fast, ease: EASE }}
          >
            {busy ? "Watching…" : video ? "Ready" : "Waiting for a long take"}
          </motion.span>
        </AnimatePresence>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {!video ? (
          <motion.div
            key="dropzone"
            className={`upload${drag ? " is-drag" : ""}${busy ? " is-busy" : ""}`}
            /*
             * `.upload.is-busy` dims to 0.75 in editor.css, so the resting
             * opacity is decided here — an inline 1 would override the class.
             */
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: busy ? 0.75 : 1, y: 0, scale: drag ? 1.01 : 1 }}
            exit={{ opacity: 0, y: -8 }}
            transition={springSoft}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              takeFile(e.dataTransfer.files[0]);
            }}
          >
            <h3 className="upload__title">Drop the long take</h3>
            <p className="upload__hint">
              1–3 minutes is enough for the jam. MP4, MOV, or WebM.
            </p>
            <button
              type="button"
              className="btn btn--primary upload__btn"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              {busy ? "Encore is watching…" : "Choose a video"}
            </button>
            <input
              ref={inputRef}
              className="upload__input"
              type="file"
              accept="video/*"
              onChange={(e) => takeFile(e.target.files?.[0])}
            />
          </motion.div>
        ) : (
          <motion.div
            key="file"
            className="upload__file"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={springSoft}
          >
            <div>
              <strong>{video.name}</strong>
              <span>
                {formatTime(video.duration)} · analyzed for standalone beats
              </span>
            </div>
            <button type="button" className="btn btn--ghost-solid btn--small" onClick={onReset}>
              New file
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
