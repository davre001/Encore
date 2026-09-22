"use client";

import {
  Captions,
  FastForward,
  Maximize,
  Minimize,
  Pause,
  Play,
  Redo2,
  Rewind,
  Scissors,
  StepBack,
  StepForward,
  Trash2,
  Undo2,
  type LucideIcon,
} from "lucide-react";

function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  const r = s % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}

export type TransportEdit =
  | "undo"
  | "redo"
  | "delete"
  | "cut"
  | "captions"
  | "trim-left"
  | "trim-right";

export type AiPermissionMode = "auto" | "ask";

type TransportBarProps = {
  time: number;
  duration: number;
  playing: boolean;
  canEdit: boolean;
  canUndo: boolean;
  canRedo: boolean;
  aiPermissionMode: AiPermissionMode;
  fullscreen: boolean;
  onEdit: (edit: TransportEdit) => void;
  onRewind: () => void;
  onTogglePlay: () => void;
  onForward: () => void;
  onAiPermissionMode: (mode: AiPermissionMode) => void;
  onToggleFullscreen: () => void;
};

type IconBtnProps = {
  label: string;
  Icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
};

function IconBtn({ label, Icon, onClick, disabled, active }: IconBtnProps) {
  return (
    <button
      type="button"
      className={`cut__xbtn${active ? " is-active" : ""}`}
      aria-label={label}
      aria-pressed={active ? true : undefined}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon aria-hidden="true" />
    </button>
  );
}

export default function TransportBar({
  time,
  duration,
  playing,
  canEdit,
  canUndo,
  canRedo,
  aiPermissionMode,
  fullscreen,
  onEdit,
  onRewind,
  onTogglePlay,
  onForward,
  onAiPermissionMode,
  onToggleFullscreen,
}: TransportBarProps) {
  return (
    <div className="cut__transbar" role="toolbar" aria-label="Editor tools">
      <div className="cut__xcluster cut__xcluster--edit">
        <IconBtn label="Undo" Icon={Undo2} onClick={() => onEdit("undo")} disabled={!canUndo} />
        <IconBtn label="Redo" Icon={Redo2} onClick={() => onEdit("redo")} disabled={!canRedo} />
        <span className="cut__tool-divider" aria-hidden="true" />
        <IconBtn label="Delete selected" Icon={Trash2} onClick={() => onEdit("delete")} disabled={!canEdit} />
        <IconBtn label="Cut at playhead" Icon={Scissors} onClick={() => onEdit("cut")} disabled={!canEdit} />
        <IconBtn label="Generate captions" Icon={Captions} onClick={() => onEdit("captions")} disabled={!canEdit} />
        <IconBtn label="Trim left side to playhead" Icon={StepBack} onClick={() => onEdit("trim-left")} disabled={!canEdit} />
        <IconBtn label="Trim right side from playhead" Icon={StepForward} onClick={() => onEdit("trim-right")} disabled={!canEdit} />
      </div>

      <div className="cut__xcluster cut__xcluster--transport">
        <IconBtn label="Back 5 seconds" Icon={Rewind} onClick={onRewind} disabled={!canEdit} />
        <button
          type="button"
          className="cut__xplay"
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause" : "Play"}
          onClick={onTogglePlay}
          disabled={!canEdit}
        >
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </button>
        <IconBtn label="Forward 5 seconds" Icon={FastForward} onClick={onForward} disabled={!canEdit} />
        <span className="cut__xclock" aria-live="off">
          <b>{formatTime(time)}</b>
          <i>/</i>
          <span>{formatTime(duration)}</span>
        </span>
      </div>

      <div className="cut__xcluster cut__xcluster--view">
        <span className="cut__ai-label">AI</span>
        <div className="cut__ai-mode" role="group" aria-label="AI permission mode">
          <button
            type="button"
            className={aiPermissionMode === "auto" ? "is-active" : ""}
            aria-pressed={aiPermissionMode === "auto"}
            title="AI can auto approve supported actions"
            onClick={() => onAiPermissionMode("auto")}
          >
            Auto approve
          </button>
          <button
            type="button"
            className={aiPermissionMode === "ask" ? "is-active" : ""}
            aria-pressed={aiPermissionMode === "ask"}
            title="AI must ask before applying supported actions"
            onClick={() => onAiPermissionMode("ask")}
          >
            Ask every time
          </button>
        </div>
        <IconBtn
          label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          Icon={fullscreen ? Minimize : Maximize}
          onClick={onToggleFullscreen}
          active={fullscreen}
        />
      </div>
    </div>
  );
}
