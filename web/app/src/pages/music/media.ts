/** Client-side media helpers for the music library. Reads playback duration
 *  from a selected audio file before upload so the library shows track lengths
 *  without a server-side decode pipeline. Album artwork is left to the user /
 *  future ID3 parsing; the player falls back to a music-note placeholder. */

export interface Probe {
  durationSeconds: number;
}

/** probeAudio loads the file into an off-screen <audio> and reads its duration.
 *  Falls back to 0 if the browser can't decode the file. */
export function probeAudio(file: File): Promise<Probe> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = url;

    let settled = false;
    const done = (p: Probe) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(p);
    };

    // Safety timeout — never block the upload on a flaky decode.
    const timer = window.setTimeout(() => done({ durationSeconds: 0 }), 8000);

    audio.onloadedmetadata = () => {
      window.clearTimeout(timer);
      done({ durationSeconds: isFinite(audio.duration) ? audio.duration : 0 });
    };
    audio.onerror = () => {
      window.clearTimeout(timer);
      done({ durationSeconds: 0 });
    };
  });
}

/** formatDuration renders seconds as H:MM:SS or M:SS. */
export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0 || !isFinite(seconds)) return "";
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** formatClock renders a possibly-NaN media currentTime as M:SS (for the
 *  player scrubber); 0:00 for unknown. */
export function formatClock(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** formatBytes renders a byte count as a human-readable size. */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
