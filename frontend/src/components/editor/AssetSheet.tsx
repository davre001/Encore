"use client";

import { useEffect } from "react";
import { motion } from "motion/react";
import type { Clip, Moment } from "@/types";
import type { StudioAsset } from "@/lib/studioAssets";
import { DUR, EASE } from "@/lib/motion";

type AssetSheetProps = {
  asset: StudioAsset;
  moment?: Moment;
  clip?: Clip;
  onClose: () => void;
  onDecide: (id: string, decision: "accept" | "reject") => void;
  onClipChange: (clip: Clip) => void;
  onPost: (id: string) => void;
  onRecut: (id: string) => void;
};

export default function AssetSheet({
  asset,
  moment,
  clip,
  onClose,
  onDecide,
  onClipChange,
  onPost,
  onRecut,
}: AssetSheetProps) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <button
        type="button"
        className="sheet__scrim"
        aria-label="Close"
        onClick={onClose}
      />
      <motion.div
        className="sheet__card"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.98 }}
        transition={{ duration: DUR.fast, ease: EASE }}
      >
        <p className="sheet__kicker">{asset.kicker}</p>
        <h2 id="sheet-title" className="sheet__title">
          {asset.title}
        </h2>

        {moment && moment.status === "pending" ? (
          <>
            <p>{moment.reason}</p>
            <div className="sheet__actions">
              <button
                type="button"
                className="btn btn--primary btn--small"
                onClick={() => {
                  onDecide(moment.id, "accept");
                  onClose();
                }}
              >
                Keep
              </button>
              <button
                type="button"
                className="btn btn--ghost-solid btn--small"
                onClick={() => {
                  onDecide(moment.id, "reject");
                  onClose();
                }}
              >
                Skip
              </button>
            </div>
          </>
        ) : null}

        {clip ? (
          <>
            <div className="field">
              <label htmlFor={`sheet-title-${clip.id}`}>Title</label>
              <input
                id={`sheet-title-${clip.id}`}
                value={clip.title}
                onChange={(event) =>
                  onClipChange({ ...clip, title: event.target.value })
                }
                disabled={clip.posted}
              />
            </div>
            <div className="field" style={{ marginTop: "0.75rem" }}>
              <label htmlFor={`sheet-caption-${clip.id}`}>Caption</label>
              <textarea
                id={`sheet-caption-${clip.id}`}
                rows={4}
                value={clip.caption}
                onChange={(event) =>
                  onClipChange({ ...clip, caption: event.target.value })
                }
                disabled={clip.posted}
              />
            </div>
            <div className="sheet__actions">
              {!clip.posted ? (
                <button
                  type="button"
                  className="btn btn--primary btn--small"
                  onClick={() => onPost(clip.id)}
                >
                  Post
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--ghost-solid btn--small"
                  onClick={() => onRecut(clip.id)}
                >
                  Recut
                </button>
              )}
              <button
                type="button"
                className="btn btn--ghost-solid btn--small"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </>
        ) : null}

        {!moment && !clip ? (
          <div className="sheet__actions">
            <button
              type="button"
              className="btn btn--ghost-solid btn--small"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        ) : null}
      </motion.div>
    </div>
  );
}
