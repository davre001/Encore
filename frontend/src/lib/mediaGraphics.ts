// Real media graphics for the timeline: frame thumbnails pulled off the picked
// file with a canvas, and an audio-peak envelope decoded with Web Audio. Both
// run off the actual uploaded blob (same-origin, so the canvas never taints),
// and both fail soft — a file that can't decode resolves to an empty result
// instead of throwing, so the mock/stand-in uploads stay silent.

export type Frame = { t: number; src: string };

function waitFor(
  el: HTMLMediaElement,
  event: string,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      el.removeEventListener(event, ok as unknown as EventListener);
      el.removeEventListener("error", err);
      window.clearTimeout(timer);
      resolve(ok);
    };
    const ok = () => finish(true);
    const err = () => finish(false);
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    el.addEventListener(event, ok, { once: true });
    el.addEventListener("error", err, { once: true });
  });
}

function seekTo(video: HTMLVideoElement, t: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      video.removeEventListener("seeked", ok as unknown as EventListener);
      window.clearTimeout(timer);
      resolve(ok);
    };
    const ok = () => finish(true);
    const timer = window.setTimeout(() => finish(false), 2500);
    video.addEventListener("seeked", ok, { once: true });
    try {
      video.currentTime = t;
    } catch {
      finish(false);
    }
  });
}

/**
 * Grab `count` evenly-spaced JPEG thumbnails across the take. Sequential seeks
 * keep memory flat; each frame is small (160px wide, quality 0.5) so a few
 * dozen of them stay cheap to hold and render.
 */
export async function extractFrames(
  url: string,
  duration: number,
  count = 48,
): Promise<Frame[]> {
  if (
    typeof document === "undefined" ||
    !url ||
    !duration ||
    !Number.isFinite(duration)
  ) {
    return [];
  }

  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.preload = "auto";
  video.playsInline = true;

  const ready = await waitFor(video, "loadedmetadata", 6000);
  if (!ready || !video.videoWidth) {
    video.removeAttribute("src");
    return [];
  }

  const w = 160;
  const h = Math.max(
    1,
    Math.round(w * (video.videoHeight / video.videoWidth || 9 / 16)),
  );
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  const n = Math.max(1, Math.min(count, Math.ceil(duration)));
  const frames: Frame[] = [];
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) / n) * duration;
    const seeked = await seekTo(video, Math.min(t, Math.max(0, duration - 0.05)));
    if (!seeked) continue;
    try {
      ctx.drawImage(video, 0, 0, w, h);
      frames.push({ t, src: canvas.toDataURL("image/jpeg", 0.5) });
    } catch {
      // A tainted or not-yet-painted frame — skip it and keep going.
    }
  }
  video.removeAttribute("src");
  return frames;
}

/**
 * Decode the file's audio and reduce it to a normalized peak envelope of
 * `buckets` samples (0..1). Returns null when the file has no decodable audio.
 */
export async function extractPeaks(
  url: string,
  buckets = 600,
): Promise<number[] | null> {
  if (typeof window === "undefined" || !url) return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return null;

  let audioCtx: AudioContext | null = null;
  try {
    const res = await fetch(url);
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength < 1024) return null;
    audioCtx = new Ctx();
    const decoded = await audioCtx.decodeAudioData(buffer);
    const channel = decoded.getChannelData(0);
    const block = Math.max(1, Math.floor(channel.length / buckets));
    const peaks: number[] = [];
    for (let i = 0; i < buckets; i++) {
      let max = 0;
      const base = i * block;
      for (let j = 0; j < block; j++) {
        const v = Math.abs(channel[base + j] || 0);
        if (v > max) max = v;
      }
      peaks.push(max);
    }
    const norm = Math.max(...peaks) || 1;
    return peaks.map((p) => p / norm);
  } catch {
    return null;
  } finally {
    try {
      await audioCtx?.close();
    } catch {
      // ignore
    }
  }
}
