"use client";

import {
  Columns2,
  Copy,
  Download,
  FastForward,
  FlipHorizontal2,
  Maximize,
  Minimize,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  Plus,
  Rewind,
  RotateCw,
  Scissors,
  Split,
  Trash2,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { MAX_PPS, MIN_PPS } from "./Timeline";

/** m:ss for the transport clock, matching the ruler's readout. */
function formatTime(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

/** The single edit action the toolbar can fire at the selected clip. */
export type TransportEdit =
  | "split"
  | "delete"
  | "rotate"
  | "flip"
  | "duplicate"
  | "cut"
  | "download";

type TransportBarProps = {
  time: number;
  duration: number;
  playing: boolean;
  /** No take loaded → the edit cluster is inert. */
  canEdit: boolean;
  aiOn: boolean;
  compareOn: boolean;
  fullscreen: boolean;
  panelOpen: boolean;
  pxPerSecond: number;
  onEdit: (edit: TransportEdit) => void;
  onRewind: () => void;
  onTogglePlay: () => void;
  onForward: () => void;
  onToggleAi: () => void;
  onToggleCompare: () => void;
  onPxPerSecond: (value: number) => void;
  onToggleFullscreen: () => void;
  onTogglePanel: () => void;
};

type IconBtnProps = {
  label: string;
  Icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  strong?: boolean;
};

function IconBtn({ label, Icon, onClick, disabled, active, strong }: IconBtnProps) {
  return (
    <button
      type="button"
      className={`cut__xbtn${active ? " is-active" : ""}${strong ? " cut__xbtn--strong" : ""}`}
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

/**
 * The bottom transport toolbar the skill calls for, in three clusters:
 * edit tools (left) act on the selected clip, transport (center) drives
 * playback with a m:ss / m:ss clock, and view tools (right) hold the AI /
 * compare toggles, the timeline zoom that used to sit on the timeline bar,
 * fullscreen, and the left-panel toggle.
 */
export default function TransportBar({
  time,
  duration,
  playing,
  canEdit,
  aiOn,
  compareOn,
  fullscreen,
  panelOpen,
  pxPerSecond,
  onEdit,
  onRewind,
  onTogglePlay,
  onForward,
  onToggleAi,
  onToggleCompare,
  onPxPerSecond,
  onToggleFullscreen,
  onTogglePanel,
}: TransportBarProps) {
  return (
    <div className="cut__transbar" role="toolbar" aria-label="Transport">
      <div className="cut__xcluster cut__xcluster--edit">
        <IconBtn label="Split take at playhead" Icon={Split} onClick={() => onEdit("split")} disabled={!canEdit} />
        <IconBtn label="Delete take" Icon={Trash2} onClick={() => onEdit("delete")} disabled={!canEdit} />
        <IconBtn label="Rotate 90°" Icon={RotateCw} onClick={() => onEdit("rotate")} disabled={!canEdit} />
        <IconBtn label="Flip horizontally" Icon={FlipHorizontal2} onClick={() => onEdit("flip")} disabled={!canEdit} />
        <IconBtn label="Duplicate take as a cut" Icon={Copy} onClick={() => onEdit("duplicate")} disabled={!canEdit} />
        <IconBtn label="Cut a clip from the playhead" Icon={Scissors} onClick={() => onEdit("cut")} disabled={!canEdit} />
        <IconBtn label="Download take" Icon={Download} onClick={() => onEdit("download")} disabled={!canEdit} />
      </div>

      <div className="cut__xcluster cut__xcluster--transport">
        <IconBtn label="Back 5 seconds" Icon={Rewind} onClick={onRewind} />
        <button
          type="button"
          className="cut__xplay"
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause" : "Play"}
          onClick={onTogglePlay}
        >
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </button>
        <IconBtn label="Forward 5 seconds" Icon={FastForward} onClick={onForward} />
        <span className="cut__xclock" aria-live="off">
          <b>{formatTime(time)}</b>
          <i>/</i>
          <span>{formatTime(duration)}</span>
        </span>
      </div>

      <div className="cut__xcluster cut__xcluster--view">
        <IconBtn label="AI tools" Icon={Wand2} onClick={onToggleAi} active={aiOn} strong />
        <IconBtn label="Compare view" Icon={Columns2} onClick={onToggleCompare} active={compareOn} />
        <span className="cut__xzoom">
          <button
            type="button"
            className="cut__xbtn"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => onPxPerSecond(Math.max(MIN_PPS, pxPerSecond - 4))}
          >
            <Minus aria-hidden="true" />
          </button>
          <input
            type="range"
            className="cut__xzoom-range"
            aria-label="Timeline zoom"
            min={MIN_PPS}
            max={MAX_PPS}
            step={1}
            value={pxPerSecond}
            onChange={(event) => onPxPerSecond(Number(event.target.value))}
          />
          <button
            type="button"
            className="cut__xbtn"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => onPxPerSecond(Math.min(MAX_PPS, pxPerSecond + 4))}
          >
            <Plus aria-hidden="true" />
          </button>
        </span>
        <IconBtn
          label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          Icon={fullscreen ? Minimize : Maximize}
          onClick={onToggleFullscreen}
          active={fullscreen}
        />
        <IconBtn
          label={panelOpen ? "Hide panel" : "Show panel"}
          Icon={panelOpen ? PanelLeftClose : PanelLeftOpen}
          onClick={onTogglePanel}
          active={!panelOpen}
        />
      </div>
    </div>
  );
}
