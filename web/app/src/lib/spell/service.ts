// Main-thread spell-check service shared by Docs, Sheets and Slides.
//
// Editors ask `known(lang, word)` synchronously while building decorations
// and queue unknown words with `check(lang, words)`; the answers come back
// from the worker, fill the cache, and `subscribe` listeners redraw.
import { LocalSpellBackend, fetchLoader, type SpellBackend } from "./backend";
import { dictionaryFor } from "./languages";
import { loadSpellPrefs, saveSpellPrefs, syncSpellPrefs, type SpellPrefs } from "./prefs";
import type { SpellRequest, SpellResponse } from "./spell.worker";

/** WorkerBackend forwards requests to spell.worker.ts. */
class WorkerBackend implements SpellBackend {
  private worker: Worker;
  private next = 1;
  private pending = new Map<number, { resolve: (v: string[]) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL("./spell.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (ev: MessageEvent<SpellResponse>) => {
      const p = this.pending.get(ev.data.id);
      if (!p) return;
      this.pending.delete(ev.data.id);
      if (ev.data.ok) p.resolve(ev.data.result);
      else p.reject(new Error(ev.data.error));
    };
  }

  private call(req: Omit<SpellRequest, "id"> & { op: SpellRequest["op"] }): Promise<string[]> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...req, id });
    });
  }

  check(lang: string, words: string[]) {
    return this.call({ op: "check", lang, words } as SpellRequest);
  }
  suggest(lang: string, word: string, max?: number) {
    return this.call({ op: "suggest", lang, word, max } as SpellRequest);
  }
  async setPersonal(words: string[]) {
    await this.call({ op: "personal", words } as SpellRequest);
  }
}

export class SpellService {
  /** dictionary name -> word -> correct? */
  private cache = new Map<string, Map<string, boolean>>();
  private inflight = new Map<string, Set<string>>();
  private unsupported = new Set<string>();
  private listeners = new Set<() => void>();
  private prefs: SpellPrefs;
  private personal: Set<string>;

  constructor(private backend: SpellBackend, prefs: SpellPrefs = loadSpellPrefs()) {
    this.prefs = prefs;
    this.personal = new Set(prefs.words);
    if (prefs.words.length) void backend.setPersonal(prefs.words);
  }

  get enabled(): boolean {
    return this.prefs.enabled;
  }

  get words(): string[] {
    return [...this.personal].sort();
  }

  setEnabled(on: boolean) {
    if (on === this.prefs.enabled) return;
    this.prefs = saveSpellPrefs({ ...this.prefs, enabled: on });
    this.emit();
  }

  /** Can `lang` be checked at all (a bundled dictionary exists and
   *  loaded)? */
  supported(lang: string): boolean {
    const d = dictionaryFor(lang);
    return !!d && !this.unsupported.has(d);
  }

  /** known: true / false when cached, undefined while unknown. */
  known(lang: string, word: string): boolean | undefined {
    if (this.personal.has(word)) return true;
    const d = dictionaryFor(lang);
    if (!d || this.unsupported.has(d)) return true;
    return this.cache.get(d)?.get(word);
  }

  /** check asks the backend about words not cached yet; listeners run
   *  when the answers arrive. */
  async check(lang: string, words: Iterable<string>): Promise<void> {
    const d = dictionaryFor(lang);
    if (!d || this.unsupported.has(d)) return;
    const cache = this.cache.get(d) ?? new Map<string, boolean>();
    this.cache.set(d, cache);
    const flying = this.inflight.get(d) ?? new Set<string>();
    this.inflight.set(d, flying);
    const todo = [...new Set(words)].filter((w) => !cache.has(w) && !flying.has(w) && !this.personal.has(w));
    if (!todo.length) return;
    for (const w of todo) flying.add(w);
    try {
      const bad = new Set(await this.backend.check(lang, todo));
      for (const w of todo) cache.set(w, !bad.has(w));
      this.emit();
    } catch (e) {
      if ((e as Error).message === "unsupported") {
        this.unsupported.add(d);
        this.emit();
      }
    } finally {
      for (const w of todo) flying.delete(w);
    }
  }

  suggest(lang: string, word: string, max = 7): Promise<string[]> {
    return this.backend.suggest(lang, word, max).catch(() => []);
  }

  /** addWord: "Add to dictionary" (every language, every device). */
  addWord(word: string) {
    if (this.personal.has(word)) return;
    this.personal.add(word);
    this.persistWords();
  }

  removeWord(word: string) {
    if (!this.personal.delete(word)) return;
    for (const c of this.cache.values()) c.delete(word);
    this.persistWords();
  }

  private persistWords() {
    this.prefs = saveSpellPrefs({ ...this.prefs, words: [...this.personal] });
    void this.backend.setPersonal(this.prefs.words);
    this.emit();
  }

  /** Pull the server copy of the preferences (once per page load). */
  async sync(): Promise<void> {
    const p = await syncSpellPrefs();
    const changed = p.enabled !== this.prefs.enabled || p.words.length !== this.personal.size;
    this.prefs = p;
    this.personal = new Set(p.words);
    if (changed) {
      await this.backend.setPersonal(p.words);
      this.emit();
    }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of [...this.listeners]) fn();
  }
}

let instance: SpellService | null = null;
let synced = false;

/** spellService returns the page's shared service (worker-backed when
 *  the browser has workers, in-process otherwise). */
export function spellService(): SpellService {
  if (!instance) {
    let backend: SpellBackend;
    try {
      backend = typeof Worker !== "undefined" && typeof window !== "undefined" && !("__vitest_worker__" in globalThis) ? new WorkerBackend() : new LocalSpellBackend(fetchLoader(""));
    } catch {
      backend = new LocalSpellBackend(fetchLoader(""));
    }
    instance = new SpellService(backend);
  }
  if (!synced && typeof window !== "undefined" && !("__vitest_worker__" in globalThis)) {
    synced = true;
    void instance.sync();
  }
  return instance;
}

/** setSpellService replaces the shared service (tests). */
export function setSpellService(s: SpellService | null) {
  instance = s;
  synced = true;
}
