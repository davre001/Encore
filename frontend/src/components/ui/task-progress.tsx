"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronUp, LoaderCircle, Minimize2, Square, X } from "lucide-react";
import styles from "./task-progress.module.css";

export type TaskProgressProps = {
  message: string;
  percent?: number;
  onStop: () => void;
  status?: "running" | "success" | "error";
  onDismiss?: () => void;
};

/** A task version of the supplied Budget Guard card, driven by real job updates. */
export default function TaskProgress({ message, percent, onStop, status = "running", onDismiss }: TaskProgressProps) {
  const [hidden, setHidden] = useState(false);
  const titleId = useId();
  const detailId = useId();
  const finished = status !== "running";
  const label = status === "success" ? "Completed" : status === "error" ? "Failed" : "In progress";
  const icon = status === "running"
    ? <LoaderCircle className={styles.spinner} size={22} aria-hidden="true" />
    : <span key={status} className={`${styles.resultIcon} ${status === "success" ? styles.success : styles.error}`}>
        {status === "success" ? <Check size={22} aria-hidden="true" /> : <X size={22} aria-hidden="true" />}
      </span>;
  const value = status === "success" ? 100 : percent !== undefined && Number.isFinite(percent)
    ? Math.round(Math.max(0, Math.min(100, percent)))
    : undefined;

  if (hidden) {
    return (
      <button type="button" className={styles.compact} data-status={status} onClick={() => setHidden(false)}
        aria-label={`Show task progress: ${message}${value !== undefined ? `, ${value}%` : ""}`}
        title={message}>
        {icon}
        <span>{finished ? label : value !== undefined ? `${value}%` : "Working"}</span>
        <ChevronUp size={12} aria-hidden="true" />
      </button>
    );
  }

  return (
    <section className={styles.popup} data-status={status} role="dialog" aria-modal="false"
      aria-labelledby={titleId} aria-describedby={detailId}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setHidden(true);
        }
      }}>
      <header className={styles.header}>
        <span>ENCORE / TASK PROGRESS</span>
        <button type="button" onClick={() => setHidden(true)} aria-label="Hide progress in sidebar" title="Hide in sidebar">
          <Minimize2 size={16} aria-hidden="true" />
        </button>
      </header>
      <div className={styles.body}>
        <div className={styles.heading}>
          {icon}
          <h2 id={titleId}>{status === "success" ? "Task completed" : status === "error" ? "Something went wrong" : "Your task is running"}</h2>
          <span className={styles.badge}>{label}</span>
        </div>
        <p id={detailId} role="status">{message}</p>
        {!finished && <>
        <div className={styles.numbers}><span>Progress</span><strong>{value !== undefined ? `${value}%` : "Working…"}</strong></div>
        <div className={styles.track} role="progressbar" aria-label="Task progress"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-valuetext={message}>
          <div className={value === undefined ? styles.indeterminate : styles.fill}
            style={value !== undefined ? { width: `${value}%` } : undefined} />
        </div>
        </>}
        <p className={styles.hint}>{finished ? "You can dismiss this result or keep it in the sidebar." : "You can keep editing. Hide this window to follow progress in the sidebar."}</p>
      </div>
      <footer className={styles.footer}>
        {finished ? <button type="button" onClick={onDismiss}>Dismiss</button> : <button type="button" onClick={onStop}><Square size={12} aria-hidden="true" /> Stop task</button>}
        <button type="button" onClick={() => setHidden(true)}>Hide in sidebar <Minimize2 size={14} aria-hidden="true" /></button>
      </footer>
    </section>
  );
}

type TrackerProps = TaskProgressProps & {
  active: boolean;
  stopped: boolean;
  error?: string | null;
  analysisRunning: boolean;
  analysisError?: string | null;
};

export function TaskProgressTracker({ active, stopped, error, analysisRunning, analysisError, message, percent, onStop }: TrackerProps) {
  const [task, setTask] = useState<(TaskProgressProps & { id: number }) | null>(null);
  const wasActive = useRef(false);
  const lastWasAnalysis = useRef(false);
  const sequence = useRef(0);

  useEffect(() => {
    if (stopped) {
      wasActive.current = false;
      setTask(null);
    } else if (active) {
      if (!wasActive.current) {
        sequence.current += 1;
        lastWasAnalysis.current = analysisRunning;
      } else if (analysisRunning) {
        lastWasAnalysis.current = true;
      }
      wasActive.current = true;
      setTask({ id: sequence.current, message, percent, status: "running", onStop });
    } else if (wasActive.current) {
      wasActive.current = false;
      const failure = error || (lastWasAnalysis.current ? analysisError : null);
      setTask((previous) => previous ? { ...previous, status: failure ? "error" : "success", message: failure || "Your task finished successfully." } : null);
    }
    // onStop is read from the current render below; callback identity must not restart tracking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stopped, error, analysisRunning, analysisError, message, percent]);

  return task ? <TaskProgress key={task.id} {...task} onStop={onStop} onDismiss={() => setTask(null)} /> : null;
}
