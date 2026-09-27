// Spell-check Web Worker: owns the Hunspell dictionaries so loading and
// checking never block the editor. Messages are plain data (no code).
import { LocalSpellBackend, fetchLoader } from "./backend";

export type SpellRequest =
  | { id: number; op: "check"; lang: string; words: string[] }
  | { id: number; op: "suggest"; lang: string; word: string; max?: number }
  | { id: number; op: "personal"; words: string[] };

export type SpellResponse = { id: number; ok: true; result: string[] } | { id: number; ok: false; error: string };

const backend = new LocalSpellBackend(fetchLoader(self.location.origin));

self.onmessage = async (ev: MessageEvent<SpellRequest>) => {
  const req = ev.data;
  try {
    let result: string[] = [];
    if (req.op === "check") result = await backend.check(req.lang, req.words);
    else if (req.op === "suggest") result = await backend.suggest(req.lang, req.word, req.max);
    else if (req.op === "personal") await backend.setPersonal(req.words);
    (self as unknown as Worker).postMessage({ id: req.id, ok: true, result } satisfies SpellResponse);
  } catch (e) {
    (self as unknown as Worker).postMessage({ id: req.id, ok: false, error: (e as Error).message } satisfies SpellResponse);
  }
};
