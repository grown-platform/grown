import { formatBytes } from "./media";
import type { RadioCache, Station } from "./types";

/** retentionLabel renders a station's retention policy as a short phrase.
 *  "Keep" is still bounded by the server-wide radio cache limit. */
export function retentionLabel(s: Station): string {
  if (s.retention_mode === "days") return `Erase after ${s.retention_days}d`;
  return "Keep until cache is full";
}

/** cacheUsageLabel renders e.g. "Radio cache: 3.2 GB of 5.0 GB · 812 songs". */
export function cacheUsageLabel(c: RadioCache): string {
  const used = formatBytes(c.used_bytes) || "0 B";
  const songs = `${c.songs} song${c.songs === 1 ? "" : "s"}`;
  if (c.max_bytes > 0) {
    return `Radio cache: ${used} of ${formatBytes(c.max_bytes)} · ${songs}`;
  }
  return `Radio cache: ${used} · ${songs}`;
}

/** cacheUsageHint explains the server-wide limits in a tooltip. */
export function cacheUsageHint(c: RadioCache): string {
  const parts: string[] = [];
  if (c.max_bytes > 0) {
    parts.push(
      `the server keeps at most ${formatBytes(c.max_bytes)} of radio songs`,
    );
  }
  if (c.max_days > 0) parts.push(`none older than ${c.max_days} days`);
  const limits = parts.length
    ? `Across all organisations, ${parts.join(", ")}; the oldest are erased first. `
    : "";
  return `${limits}Liked songs and songs in a playlist are never erased.`;
}

/** cacheUsageFraction is used/max in [0,1], or null when unlimited. */
export function cacheUsageFraction(c: RadioCache): number | null {
  if (c.max_bytes <= 0) return null;
  return Math.min(1, Math.max(0, c.used_bytes / c.max_bytes));
}
