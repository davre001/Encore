"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Captions,
  ClipboardPaste,
  Columns,
  Columns2,
  Copy,
  CopyPlus,
  Crop,
  Download,
  FileText,
  RefreshCw,
  Replace,
  Scissors,
  Snowflake,
  Split,
  Trash2,
  type LucideIcon,
} from "lucide-react";

/**
 * The clip right-click menu, straight off the skill's three-group spec. It's
 * hand-rolled rather than pulled from a menu lib: a right-click menu only needs
 * to open at the cursor, flip off the viewport edges, and close on Escape /
 * outside-click — no positioning engine required, and Encore has no menu dep.
 *
 * Group 1 (edit) and the Encore group (3) are fully wired; the middle group's
 * replace / transcript / separate-audio / split-scene are the skill's
 * fast-follow set, so they render disabled until their backend seat is live.
 */
export type ClipMenuAction =
  | "split"
  | "trim"
  | "copy"
  | "cut"
  | "paste"
  | "duplicate"
  | "delete"
  | "replace"
  | "download"
  | "transcript"
  | "separate-audio"
  | "split-scene"
  | "freeze"
  | "regen-caption"
  | "rerun-analysis";

type MenuItem = {
  action: ClipMenuAction;
  label: string;
  Icon: LucideIcon;
  shortcut?: string;
  disabled?: boolean;
};

type ClipContextMenuProps = {
  x: number;
  y: number;
  /**
   * "clip" is the full cut menu; "take" is the compact menu for the main take,
   * right-clicked from the monitor or the take block — the actions the user
   * asked for on the main clip (split / trim / duplicate / delete) plus a
   * download of the source.
   */
  mode?: "clip" | "take";
  /** Whether this clip is frozen, so the Freeze row can read "Unfreeze". */
  frozen?: boolean;
  /** Enables Paste — false when nothing has been copied/cut yet. */
  canPaste: boolean;
  /** Enables Separate audio — Encore clips carry no split audio track yet. */
  hasAudio?: boolean;
  onAction: (action: ClipMenuAction) => void;
  onClose: () => void;
};

export default function ClipContextMenu({
  x,
  y,
  mode = "clip",
  frozen,
  canPaste,
  hasAudio = false,
  onAction,
  onClose,
}: ClipContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Flip the menu back on-screen once it has a measured size — right/bottom
  // edges push it left/up so it never spills out of the viewport.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    const nx = Math.min(x, window.innerWidth - width - pad);
    const ny = Math.min(y, window.innerHeight - height - pad);
    setPos({ x: Math.max(pad, nx), y: Math.max(pad, ny) });
  }, [x, y]);

  // Escape, outside-click, scroll and resize all dismiss the menu.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    function onDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("wheel", onClose, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("wheel", onClose);
    };
  }, [onClose]);

  const groups: MenuItem[][] =
    mode === "take"
      ? [
          [
            { action: "split", label: "Split", Icon: Split, shortcut: "Ctrl B" },
            { action: "trim", label: "Trim", Icon: Crop },
            { action: "duplicate", label: "Duplicate", Icon: CopyPlus, shortcut: "Ctrl D" },
            { action: "delete", label: "Delete", Icon: Trash2, shortcut: "Del" },
          ],
          [{ action: "download", label: "Download take", Icon: Download }],
        ]
      : [
          [
            { action: "split", label: "Split", Icon: Split, shortcut: "Ctrl B" },
            { action: "copy", label: "Copy", Icon: Copy, shortcut: "Ctrl C" },
            { action: "cut", label: "Cut", Icon: Scissors, shortcut: "Ctrl X" },
            {
              action: "paste",
              label: "Paste",
              Icon: ClipboardPaste,
              shortcut: "Ctrl V",
              disabled: !canPaste,
            },
            { action: "duplicate", label: "Duplicate", Icon: CopyPlus, shortcut: "Ctrl D" },
            { action: "delete", label: "Delete", Icon: Trash2, shortcut: "Del" },
          ],
          [
            { action: "replace", label: "Replace", Icon: Replace, disabled: true },
            { action: "download", label: "Download clip", Icon: Download },
            {
              action: "transcript",
              label: "Transcript editing",
              Icon: FileText,
              disabled: true,
            },
            {
              action: "separate-audio",
              label: "Separate audio",
              Icon: Columns,
              shortcut: "Ctrl ⇧ S",
              disabled: !hasAudio,
            },
            { action: "split-scene", label: "Split scene", Icon: Columns2, disabled: true },
            {
              action: "freeze",
              label: frozen ? "Unfreeze" : "Freeze",
              Icon: Snowflake,
            },
          ],
          [
            { action: "regen-caption", label: "Regenerate caption", Icon: Captions },
            { action: "rerun-analysis", label: "Re-run analysis", Icon: RefreshCw },
          ],
        ];

  return (
    <div
      ref={ref}
      className="cut__menu"
      role="menu"
      aria-label={mode === "take" ? "Take actions" : "Clip actions"}
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
    >
      {groups.map((group, gi) => (
        <div key={gi} className="cut__menu-group">
          {group.map(({ action, label, Icon, shortcut, disabled }) => (
            <button
              key={action}
              type="button"
              role="menuitem"
              className="cut__menu-item"
              disabled={disabled}
              onClick={() => {
                if (disabled) return;
                onAction(action);
              }}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
              {shortcut ? <em>{shortcut}</em> : null}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
