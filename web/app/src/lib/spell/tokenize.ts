// Word tokenisation for spell checking (shared by Docs, Sheets, Slides).

export interface SpellToken {
  word: string;
  /** Offsets into the checked string (UTF-16). */
  from: number;
  to: number;
}

export interface TokenizeOptions {
  /** Skip WORDS IN CAPITALS (Word's default: on). */
  ignoreUppercase?: boolean;
  /** Skip words with digits ("21st", "B2B"; Word's default: on). */
  ignoreNumbers?: boolean;
  /** Skip internet and file addresses (Word's default: on). */
  ignoreUrls?: boolean;
}

export const DEFAULT_TOKENIZE: Required<TokenizeOptions> = { ignoreUppercase: true, ignoreNumbers: true, ignoreUrls: true };

const WORD = /[\p{L}\p{M}\d]+(?:['’][\p{L}\p{M}]+)*/gu;
const URLISH = /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+|[\w.+-]+@[\w-]+\.[\w.-]+|(?:[A-Za-z]:)?(?:[\\/][\w.-]+){2,}/giu;

/** spellTokens splits `text` into checkable words with their offsets. */
export function spellTokens(text: string, opts: TokenizeOptions = {}): SpellToken[] {
  const o = { ...DEFAULT_TOKENIZE, ...opts };
  const skip: [number, number][] = [];
  if (o.ignoreUrls) {
    URLISH.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = URLISH.exec(text))) skip.push([m.index, m.index + m[0].length]);
  }
  const out: SpellToken[] = [];
  WORD.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD.exec(text))) {
    const from = m.index;
    const to = from + m[0].length;
    const word = m[0];
    if (!/\p{L}/u.test(word)) continue;
    if (o.ignoreNumbers && /\d/.test(word)) continue;
    if (o.ignoreUppercase && word.length > 1 && word === word.toUpperCase() && word !== word.toLowerCase()) continue;
    if (skip.some(([a, b]) => from < b && to > a)) continue;
    // A word glued to "_" or other identifier characters is code, not prose.
    if (/[_#@]/.test(text[from - 1] ?? "") || /[_#@]/.test(text[to] ?? "")) continue;
    out.push({ word, from, to });
  }
  return out;
}

/** The word around offset `at` in `text` (for "current word" helpers). */
export function wordAt(text: string, at: number): SpellToken | null {
  for (const t of spellTokens(text, { ignoreNumbers: false, ignoreUppercase: false, ignoreUrls: false })) if (at >= t.from && at <= t.to) return t;
  return null;
}
