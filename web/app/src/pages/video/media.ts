/** Client-side media helpers: extract a poster thumbnail and duration from a
 *  selected video file before upload, so the library grid has thumbnails
 *  without a server-side transcoding pipeline. */

export interface Probe {
  durationSeconds: number;
  thumbnailDataUrl: string;
}

/** probeVideo loads the file into an off-screen <video>, seeks ~1s in, and
 *  draws a frame to a canvas for a JPEG poster. Falls back gracefully if the
 *  browser can't decode the file (returns zeros / empty thumbnail). */
export function probeVideo(file: File): Promise<Probe> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.src = url;

    let settled = false;
    const done = (p: Probe) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(p);
    };

    // Safety timeout — never block the upload on a flaky decode.
    const timer = window.setTimeout(
      () => done({ durationSeconds: 0, thumbnailDataUrl: "" }),
      8000,
    );

    video.onloadedmetadata = () => {
      const duration = isFinite(video.duration) ? video.duration : 0;
      // Seek a touch in to avoid black leader frames.
      const seekTo = Math.min(1, duration / 2 || 0);
      const capture = () => {
        try {
          const canvas = document.createElement("canvas");
          const w = video.videoWidth || 320;
          const h = video.videoHeight || 180;
          const scale = Math.min(1, 640 / w);
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          const ctx = canvas.getContext("2d");
          let thumb = "";
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            thumb = canvas.toDataURL("image/jpeg", 0.7);
            // Guard against oversized data URLs (column is TEXT but keep it sane).
            if (thumb.length > 400_000) thumb = "";
          }
          window.clearTimeout(timer);
          done({ durationSeconds: duration, thumbnailDataUrl: thumb });
        } catch {
          window.clearTimeout(timer);
          done({ durationSeconds: duration, thumbnailDataUrl: "" });
        }
      };
      video.onseeked = capture;
      try {
        video.currentTime = seekTo;
      } catch {
        capture();
      }
    };

    video.onerror = () => {
      window.clearTimeout(timer);
      done({ durationSeconds: 0, thumbnailDataUrl: "" });
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
