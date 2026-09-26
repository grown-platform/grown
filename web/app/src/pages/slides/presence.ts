// Pure helpers for collaborator presence (avatars + slide dots).

export const PRESENCE_COLORS = [
  "#3D5A80",
  "#E0777D",
  "#5B9279",
  "#C46B45",
  "#7A5980",
  "#2A9D8F",
  "#D9A441",
  "#1D8348",
];

/** A peer is considered gone after this many ms without a heartbeat. */
export const PRESENCE_TTL_MS = 12000;

/** colorFor picks a stable colour for a user id (string hash mod palette). */
export function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PRESENCE_COLORS[h % PRESENCE_COLORS.length];
}

/** prunePeers drops peers whose last heartbeat is older than `ttl`. */
export function prunePeers<P extends { ts: number }>(
  peers: Record<string, P>,
  now: number,
  ttl: number = PRESENCE_TTL_MS,
): Record<string, P> {
  const next: Record<string, P> = {};
  for (const [k, p] of Object.entries(peers)) if (now - p.ts < ttl) next[k] = p;
  return next;
}
