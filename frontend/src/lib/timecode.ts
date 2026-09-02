/** m:ss for the transport clock, timeline ruler and moment rows. */
export function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** "0:18 – 0:41" for a moment or cut's span. */
export function formatSpan(start: number, end: number): string {
  return `${formatTime(start)} – ${formatTime(end)}`;
}
