"use client";

import { Download, Share2 } from "lucide-react";

export type ExportTarget = "device" | "youtube";

type EditorActionsProps = {
  /** No cut to act on yet — both controls are inert. */
  disabled?: boolean;
  /** Which target is mid-flight, so its button can show the state. */
  pending?: ExportTarget | null;
  /** Already live on YouTube, so sharing again is blocked. */
  shared?: boolean;
  onExport: () => void;
  onShare: () => void;
};

/**
 * The top-bar action cluster, mirroring CapCut: a ghost "Share" button (to
 * YouTube) sitting beside a filled "Export" button (to the device). Two plain
 * buttons — no dropdown — so each destination is one click away.
 */
export default function EditorActions({
  disabled,
  pending,
  shared,
  onExport,
  onShare,
}: EditorActionsProps) {
  return (
    <div className="cut__actions">
      <button
        type="button"
        className="cut__action cut__action--share"
        aria-label="Share to YouTube"
        title="Share to YouTube"
        disabled={disabled || shared || pending === "youtube"}
        onClick={onShare}
      >
        <Share2 aria-hidden="true" />
        {pending === "youtube" ? "Sharing…" : shared ? "Shared" : "Share"}
      </button>

      <button
        type="button"
        className="cut__action cut__action--export"
        aria-label="Export to device"
        title="Export to device"
        disabled={disabled || pending === "device"}
        onClick={onExport}
      >
        <Download aria-hidden="true" />
        {pending === "device" ? "Exporting…" : "Export"}
      </button>
    </div>
  );
}
