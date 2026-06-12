/*
 * activityLog.ts — a live, persistent activity log for the PBX admin console.
 *
 * There's no PBX backend behind the demo, so the Activity Log is a real
 * client-side event store: actions you take in the console (toggling call
 * recording, changing retention, playing/downloading/deleting a recording,
 * etc.) are appended here, persisted to localStorage, and pushed to any
 * mounted ActivitySection via a subscription. Newest first, capped at 500.
 */
import { useEffect, useReducer } from "react";

export interface ActivityEntry {
  time: string;
  actor: string;
  event: string;
  detail: string;
}

const KEY = "telephony_activity_log";
const MAX = 500;

const SEED: ActivityEntry[] = [
  { time: "2026-06-12 09:20", actor: "admin", event: "Extension created", detail: "Added extension 1005" },
  { time: "2026-06-12 08:11", actor: "admin", event: "Trunk updated", detail: "Backup-SIP max channels 5 → 8" },
  { time: "2026-06-11 17:45", actor: "system", event: "IP banned", detail: "203.0.113.45 (auth failures)" },
  { time: "2026-06-11 02:00", actor: "system", event: "Backup completed", detail: "Scheduled backup 246 MB" },
  { time: "2026-06-10 14:30", actor: "ada@example.com", event: "Login", detail: "Admin console sign-in" },
];

function load(): ActivityEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as ActivityEntry[];
  } catch {
    /* ignore corrupt/unavailable storage */
  }
  return SEED.slice();
}

let entries: ActivityEntry[] = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* private mode / quota — keep working in-memory */
  }
  listeners.forEach((l) => l());
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Record an action in the activity log. */
export function logActivity(event: string, detail: string, actor = "you") {
  entries = [{ time: stamp(), actor, event, detail }, ...entries].slice(0, MAX);
  persist();
}

export function clearActivity() {
  entries = [];
  persist();
}

export function getActivity(): ActivityEntry[] {
  return entries;
}

/** Subscribe to live updates (React hook). Returns the current entries. */
export function useActivityLog(): ActivityEntry[] {
  const [, force] = useReducer((c: number) => c + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => {
      listeners.delete(force);
    };
  }, []);
  return entries;
}
