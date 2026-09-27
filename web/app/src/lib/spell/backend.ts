// The spell-check backend: Hunspell dictionaries by language plus the
// user's personal words. Runs inside the spell worker in the app; tests
// (and browsers without Worker support) use it in-process.
import { Hunspell } from "./hunspell";
import { dictionaryFor } from "./languages";

/** Loads a dictionary's .aff and .dic text by base name ("en-US"). */
export type DictionaryLoader = (name: string) => Promise<{ aff: string; dic: string }>;

export interface SpellBackend {
  /** The misspelled words among `words` (unique), for language `lang`.
   *  Rejects with "unsupported" when the language has no dictionary. */
  check(lang: string, words: string[]): Promise<string[]>;
  suggest(lang: string, word: string, max?: number): Promise<string[]>;
  /** Personal words apply to every language. */
  setPersonal(words: string[]): Promise<void>;
}

export class LocalSpellBackend implements SpellBackend {
  private dicts = new Map<string, Promise<Hunspell | null>>();
  private personal: string[] = [];

  constructor(private load: DictionaryLoader) {}

  private speller(lang: string): Promise<Hunspell | null> {
    const name = dictionaryFor(lang);
    if (!name) return Promise.resolve(null);
    let p = this.dicts.get(name);
    if (!p) {
      p = this.load(name)
        .then(({ aff, dic }) => {
          const h = new Hunspell(aff, dic);
          for (const w of this.personal) h.add(w);
          return h;
        })
        .catch(() => null);
      this.dicts.set(name, p);
    }
    return p;
  }

  async check(lang: string, words: string[]): Promise<string[]> {
    const h = await this.speller(lang);
    if (!h) throw new Error("unsupported");
    return [...new Set(words)].filter((w) => !h.correct(w));
  }

  async suggest(lang: string, word: string, max = 8): Promise<string[]> {
    const h = await this.speller(lang);
    return h ? h.suggest(word, max) : [];
  }

  async setPersonal(words: string[]): Promise<void> {
    const old = new Set(this.personal);
    const next = new Set(words);
    this.personal = [...next];
    for (const p of this.dicts.values()) {
      const h = await p;
      if (!h) continue;
      for (const w of old) if (!next.has(w)) h.remove(w);
      for (const w of next) h.add(w);
    }
  }
}

/** fetchLoader loads `/dict/<name>.aff` and the gzipped `.dic`
 *  (DecompressionStream; plain `.dic` as a fallback). */
export function fetchLoader(base = ""): DictionaryLoader {
  return async (name) => {
    const aff = await fetch(`${base}/dict/${name}.aff`).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    });
    if (!/^\s*(SET|TRY|SFX|PFX|FLAG|#)/m.test(aff)) throw new Error("not an affix file");
    let dic: string;
    const gz = await fetch(`${base}/dict/${name}.dic.gz`);
    if (gz.ok && typeof DecompressionStream !== "undefined" && gz.body) {
      const stream = gz.body.pipeThrough(new DecompressionStream("gzip"));
      dic = await new Response(stream).text();
    } else {
      const r = await fetch(`${base}/dict/${name}.dic`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      dic = await r.text();
    }
    return { aff, dic };
  };
}
