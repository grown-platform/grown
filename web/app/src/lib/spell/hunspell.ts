// A small Hunspell-compatible spell checker (Grown-written, MIT).
//
// Reads Hunspell `.aff` / `.dic` files and answers "is this word spelled
// correctly?" and "what might the writer have meant?". It is shared by
// Docs, Sheets and Slides through the spell worker (spell.worker.ts), and
// is pure so vitest can drive it with hand-written dictionaries.
//
// Supported affix-file features (enough for the SCOWL English dictionaries
// and most simple Hunspell dictionaries):
//   SET, FLAG (char / UTF-8 / long / num), TRY, KEY, REP, ICONV, WORDCHARS,
//   PFX / SFX (strip, add, condition, cross product, continuation flags one
//   level deep: "twofold" suffixes), NOSUGGEST, FORBIDDENWORD, KEEPCASE,
//   NEEDAFFIX, ONLYINCOMPOUND, COMPOUNDMIN, COMPOUNDRULE, COMPOUNDFLAG /
//   COMPOUNDBEGIN / COMPOUNDMIDDLE / COMPOUNDEND (two to four parts).
// Not supported: AF / AM aliases, CIRCUMFIX, morphological analysis,
// CHECKCOMPOUND* restrictions, MAP, PHONE. Words with unsupported features
// are simply reported as misspelled.

export type FlagMode = "char" | "long" | "num" | "utf8";

interface AffixRule {
  /** Characters removed from the stem before `add` is attached. */
  strip: string;
  /** The affix itself ("" for Hunspell's 0). */
  add: string;
  /** Condition on the stem (after stripping), or null for ".". */
  cond: RegExp | null;
  /** Continuation flags carried by the affixed form. */
  cont: string[];
}

interface AffixClass {
  flag: string;
  cross: boolean;
  kind: "PFX" | "SFX";
  rules: AffixRule[];
}

interface Candidate {
  word: string;
  /** Edit cost used to rank suggestions (lower is better). */
  cost: number;
}

const QWERTY = "qwertyuiop|asdfghjkl|zxcvbnm";

/** Hunspell-compatible checker for one dictionary. */
export class Hunspell {
  /** Stem -> flag lists (homonyms keep one list each). */
  readonly words = new Map<string, string[][]>();
  flagMode: FlagMode = "char";
  tryChars = "";
  key = QWERTY;
  wordChars = "";
  rep: [RegExp, string, string][] = [];
  iconv: [string, string][] = [];
  noSuggest: string | null = null;
  forbidden: string | null = null;
  keepCase: string | null = null;
  needAffix: string | null = null;
  onlyInCompound: string | null = null;
  compoundFlag: string | null = null;
  compoundBegin: string | null = null;
  compoundMiddle: string | null = null;
  compoundEnd: string | null = null;
  compoundMin = 3;
  compoundRules: string[][] = [];
  private prefixes = new Map<string, AffixRule[]>();
  private suffixes = new Map<string, AffixRule[]>();
  private classes = new Map<string, AffixClass>();
  /** Longest prefix/suffix string, to bound the stripping loops. */
  private maxPfx = 0;
  private maxSfx = 0;
  private compoundRegex: RegExp[] = [];
  private compoundRuleFlags = new Set<string>();
  /** Words the user added (or removed) at runtime. */
  private personal = new Set<string>();
  private removed = new Set<string>();

  constructor(aff: string, dic?: string) {
    this.parseAff(aff);
    if (dic) this.addDictionary(dic);
  }

  // --- parsing ----------------------------------------------------------------------------

  /** parseFlags splits a flag field per the FLAG mode. */
  parseFlags(s: string): string[] {
    if (!s) return [];
    switch (this.flagMode) {
      case "long": {
        const out: string[] = [];
        for (let i = 0; i < s.length; i += 2) out.push(s.slice(i, i + 2));
        return out;
      }
      case "num":
        return s.split(",").map((f) => f.trim()).filter(Boolean);
      case "utf8":
        return [...s];
      default:
        return s.split("");
    }
  }

  private parseAff(aff: string) {
    const lines = aff.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/^﻿/, "");
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      const parts = line.trim().split(/\s+/);
      const [cmd] = parts;
      switch (cmd) {
        case "FLAG":
          this.flagMode = parts[1] === "long" ? "long" : parts[1] === "num" ? "num" : parts[1] === "UTF-8" ? "utf8" : "char";
          break;
        case "TRY":
          this.tryChars = parts[1] ?? "";
          break;
        case "KEY":
          this.key = parts[1] ?? QWERTY;
          break;
        case "WORDCHARS":
          this.wordChars = parts[1] ?? "";
          break;
        case "NOSUGGEST":
          this.noSuggest = parts[1] ?? null;
          break;
        case "FORBIDDENWORD":
          this.forbidden = parts[1] ?? null;
          break;
        case "KEEPCASE":
          this.keepCase = parts[1] ?? null;
          break;
        case "NEEDAFFIX":
        case "PSEUDOROOT":
          this.needAffix = parts[1] ?? null;
          break;
        case "ONLYINCOMPOUND":
          this.onlyInCompound = parts[1] ?? null;
          break;
        case "COMPOUNDFLAG":
          this.compoundFlag = parts[1] ?? null;
          break;
        case "COMPOUNDBEGIN":
          this.compoundBegin = parts[1] ?? null;
          break;
        case "COMPOUNDMIDDLE":
          this.compoundMiddle = parts[1] ?? null;
          break;
        case "COMPOUNDEND":
          this.compoundEnd = parts[1] ?? null;
          break;
        case "COMPOUNDMIN":
          this.compoundMin = Math.max(1, parseInt(parts[1], 10) || 3);
          break;
        case "REP": {
          // The first REP line is the count; the rest are pairs.
          if (parts.length === 2 && /^\d+$/.test(parts[1])) break;
          const [from, to] = [parts[1] ?? "", (parts[2] ?? "").replace(/_/g, " ")];
          if (!from) break;
          const anchored = from.startsWith("^") || from.endsWith("$");
          const body = from.replace(/^\^/, "").replace(/\$$/, "");
          const re = new RegExp(`${from.startsWith("^") ? "^" : ""}${escapeRe(body)}${from.endsWith("$") ? "$" : ""}`, anchored ? "" : "g");
          this.rep.push([re, body, to]);
          break;
        }
        case "ICONV":
          if (parts.length === 3) this.iconv.push([parts[1], parts[2]]);
          break;
        case "COMPOUNDRULE":
          if (parts.length === 2 && /^\d+$/.test(parts[1])) break;
          this.compoundRules.push(this.parseRule(parts[1] ?? ""));
          break;
        case "PFX":
        case "SFX": {
          const [, flag, cross, countStr] = parts;
          if (parts.length === 4 && /^\d+$/.test(countStr)) {
            const cls: AffixClass = { flag, cross: cross === "Y", kind: cmd, rules: [] };
            const n = parseInt(countStr, 10);
            for (let k = 0; k < n && i + 1 < lines.length; k++) {
              const p = lines[++i].trim().split(/\s+/);
              if (p[0] !== cmd || p[1] !== flag) continue;
              const [addRaw, contRaw] = (p[3] ?? "0").split("/");
              const rule: AffixRule = {
                strip: p[2] === "0" ? "" : p[2] ?? "",
                add: addRaw === "0" ? "" : addRaw,
                cond: condRegex(p[4] ?? ".", cmd),
                cont: contRaw ? this.parseFlags(contRaw) : [],
              };
              cls.rules.push(rule);
              const idx = cmd === "PFX" ? this.prefixes : this.suffixes;
              const list = idx.get(rule.add) ?? [];
              list.push(rule);
              idx.set(rule.add, list);
              ruleClass.set(rule, cls);
              if (cmd === "PFX") this.maxPfx = Math.max(this.maxPfx, rule.add.length);
              else this.maxSfx = Math.max(this.maxSfx, rule.add.length);
            }
            this.classes.set(`${cmd}:${flag}`, cls);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  /** A COMPOUNDRULE pattern as a list of flag tokens and `*` / `?`. */
  private parseRule(s: string): string[] {
    const out: string[] = [];
    if (s.includes("(")) {
      const re = /\(([^)]+)\)|([*?])/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s))) out.push(m[1] ?? m[2]);
    } else {
      for (const ch of this.flagMode === "utf8" ? [...s] : s.split("")) out.push(ch);
    }
    for (const t of out) if (t !== "*" && t !== "?") this.compoundRuleFlags.add(t);
    return out;
  }

  /** addDictionary adds a `.dic` file's words (first line is the count). */
  addDictionary(dic: string) {
    const lines = dic.split(/\r?\n/);
    let start = 0;
    if (/^\d+\s*$/.test(lines[0] ?? "")) start = 1;
    for (let i = start; i < lines.length; i++) {
      const raw = lines[i];
      if (!raw || raw.startsWith("\t")) continue;
      // Morphological fields follow a tab or a space; "\/" escapes a slash.
      const entry = raw.split(/\t/)[0].replace(/\s+[a-z]{2}:.*$/, "").trim();
      if (!entry) continue;
      const m = /^((?:\\\/|[^/])+)(?:\/(.*))?$/.exec(entry);
      if (!m) continue;
      const word = m[1].replace(/\\\//g, "/");
      this.addStem(word, this.parseFlags(m[2] ?? ""));
    }
    this.compoundRegex = [];
  }

  private addStem(word: string, flags: string[]) {
    const list = this.words.get(word);
    if (list) list.push(flags);
    else this.words.set(word, [flags]);
  }

  // --- personal dictionary ------------------------------------------------------------------

  /** add accepts `word` from now on (a user's "Add to dictionary"). */
  add(word: string) {
    this.removed.delete(word);
    this.personal.add(word);
  }

  /** remove stops accepting `word` (undoing add, or banning a stem). */
  remove(word: string) {
    this.personal.delete(word);
    this.removed.add(word);
  }

  // --- checking ---------------------------------------------------------------------------

  private hasFlag(flags: string[], flag: string | null): boolean {
    return !!flag && flags.includes(flag);
  }

  /** The stem's flag lists, ignoring removed words. */
  private stem(word: string): string[][] | undefined {
    if (this.removed.has(word)) return undefined;
    return this.words.get(word);
  }

  private convert(word: string): string {
    let w = word;
    for (const [from, to] of this.iconv) w = w.split(from).join(to);
    return w;
  }

  /** Is `word` spelled correctly? */
  correct(word: string): boolean {
    const w = this.convert(word);
    if (!w) return true;
    if (this.personal.has(w)) return true;
    if (this.isForbidden(w)) return false;
    for (const v of caseVariants(w)) {
      if (this.personal.has(v.word)) return true;
      const r = this.checkWord(v.word, v.exact);
      if (r === "forbidden") return false;
      if (r) return true;
    }
    return false;
  }

  private isForbidden(w: string): boolean {
    const s = this.stem(w);
    return !!s && s.every((f) => this.hasFlag(f, this.forbidden));
  }

  /** checkWord: true when `w` is a stem, an affixed form, or a compound.
   *  `exact` is false for case-folded variants (KEEPCASE words must match
   *  as written). */
  private checkWord(w: string, exact: boolean): boolean | "forbidden" {
    const direct = this.stem(w);
    if (direct) {
      for (const f of direct) {
        if (this.hasFlag(f, this.forbidden)) return "forbidden";
        if (this.hasFlag(f, this.onlyInCompound) || this.hasFlag(f, this.needAffix)) continue;
        if (!exact && this.hasFlag(f, this.keepCase)) continue;
        return true;
      }
    }
    if (this.affixed(w, exact)) return true;
    return this.compound(w);
  }

  /** Every (stem, flags) pair an affixed form can come from, one prefix
   *  and up to two suffixes deep. */
  private affixed(w: string, exact: boolean): boolean {
    const ok = (stem: string, need: (f: string[]) => boolean) => {
      const s = this.stem(stem);
      if (!s) return false;
      return s.some((f) => !this.hasFlag(f, this.onlyInCompound) && !this.hasFlag(f, this.forbidden) && (exact || !this.hasFlag(f, this.keepCase)) && need(f));
    };
    // Suffixes (and suffix + cross-product prefix).
    for (const [base, rule] of this.stripSuffixes(w)) {
      const cls = ruleClass.get(rule)!;
      if (ok(base, (f) => f.includes(cls.flag))) return true;
      // Twofold: base itself is stem + inner suffix whose rule continues with cls.flag.
      for (const [inner, r2] of this.stripSuffixes(base)) {
        if (!r2.cont.includes(cls.flag)) continue;
        const c2 = ruleClass.get(r2)!;
        if (ok(inner, (f) => f.includes(c2.flag))) return true;
      }
      // Continuation on the stem side: a suffix rule whose continuation
      // flags allow it to follow the prefix class, handled below.
      if (cls.cross) {
        for (const [stem, pr] of this.stripPrefixes(base)) {
          const pc = ruleClass.get(pr)!;
          if (!pc.cross) continue;
          if (ok(stem, (f) => f.includes(cls.flag) && f.includes(pc.flag))) return true;
          if (pr.cont.includes(cls.flag) && ok(stem, (f) => f.includes(pc.flag))) return true;
        }
      }
    }
    // Prefixes alone.
    for (const [base, rule] of this.stripPrefixes(w)) {
      const cls = ruleClass.get(rule)!;
      if (ok(base, (f) => f.includes(cls.flag))) return true;
    }
    return false;
  }

  private *stripSuffixes(w: string): Generator<[string, AffixRule]> {
    const max = Math.min(this.maxSfx, w.length);
    for (let k = 0; k <= max; k++) {
      const add = w.slice(w.length - k);
      const rules = this.suffixes.get(k === 0 ? "" : add);
      if (!rules) continue;
      const rest = w.slice(0, w.length - k);
      for (const r of rules) {
        if (!rest && !r.strip) continue;
        const base = rest + r.strip;
        if (r.cond && !r.cond.test(base)) continue;
        yield [base, r];
      }
    }
  }

  private *stripPrefixes(w: string): Generator<[string, AffixRule]> {
    const max = Math.min(this.maxPfx, w.length);
    for (let k = 0; k <= max; k++) {
      const add = w.slice(0, k);
      const rules = this.prefixes.get(add);
      if (!rules) continue;
      const rest = w.slice(k);
      for (const r of rules) {
        if (!rest && !r.strip) continue;
        const base = r.strip + rest;
        if (r.cond && !r.cond.test(base)) continue;
        yield [base, r];
      }
    }
  }

  // --- compounds --------------------------------------------------------------------------

  /** Compounds by COMPOUNDRULE (e.g. English ordinals) or COMPOUNDFLAG /
   *  BEGIN / MIDDLE / END. */
  private compound(w: string): boolean {
    if (this.compoundRules.length && this.ruleCompound(w)) return true;
    if (this.compoundFlag || this.compoundBegin) return this.flagCompound(w, 0, 0);
    return false;
  }

  private ruleCompound(w: string): boolean {
    if (!this.compoundRegex.length) {
      // Each flag becomes an alternation of the stems that carry it.
      const alts = new Map<string, string[]>();
      for (const f of this.compoundRuleFlags) alts.set(f, []);
      for (const [word, lists] of this.words)
        for (const flags of lists) for (const f of flags) if (alts.has(f) && word.length >= this.compoundMin) alts.get(f)!.push(word);
      this.compoundRegex = this.compoundRules.map((rule) => {
        let src = "";
        for (const t of rule) {
          if (t === "*" || t === "?") src += t;
          else src += `(?:${(alts.get(t) ?? []).map(escapeRe).join("|") || "(?!)"})`;
        }
        return new RegExp(`^(?:${src})$`);
      });
    }
    return this.compoundRegex.some((re) => re.test(w));
  }

  private flagCompound(w: string, from: number, parts: number): boolean {
    if (parts >= 4) return false;
    const min = this.compoundMin;
    for (let end = from + min; end <= w.length; end++) {
      const part = w.slice(from, end);
      const last = end === w.length;
      if (last && parts === 0) return false;
      const role = parts === 0 ? this.compoundBegin : last ? this.compoundEnd : this.compoundMiddle;
      const s = this.stem(part) ?? this.stem(part.toLowerCase());
      if (!s) continue;
      const fits = s.some((f) => this.hasFlag(f, this.compoundFlag) || this.hasFlag(f, role));
      if (!fits) continue;
      if (last) return true;
      if (w.length - end >= min && this.flagCompound(w, end, parts + 1)) return true;
    }
    return false;
  }

  // --- suggestions ------------------------------------------------------------------------

  /** Can `word` be offered as a suggestion? */
  private suggestible(word: string): boolean {
    if (!this.correct(word)) return false;
    if (!this.noSuggest) return true;
    const s = this.stem(word) ?? this.stem(word.toLowerCase());
    return !s || !s.every((f) => this.hasFlag(f, this.noSuggest));
  }

  /** suggest returns up to `max` corrections, best first, cased like the
   *  input ("Teh" -> "The", "TEH" -> "THE"). */
  suggest(word: string, max = 8): string[] {
    const w = this.convert(word);
    if (!w) return [];
    const shape = caseShape(w);
    const lower = shape === "lower" || shape === "mixed" ? w : w.toLowerCase();
    const found = new Map<string, number>();
    const offer = (cand: string, cost: number) => {
      if (!cand || cand === w) return;
      const prev = found.get(cand);
      if (prev !== undefined && prev <= cost) return;
      const parts = cand.split(" ");
      if (parts.length > 1) {
        if (parts.every((p) => p.length > 1 || /^[aAI]$/.test(p)) && parts.every((p) => this.suggestible(p))) found.set(cand, cost);
        return;
      }
      if (this.suggestible(cand)) found.set(cand, cost);
    };
    // Wrong capitalisation ("paris" -> "Paris", "iPHONE" -> ...).
    for (const v of [capitalize(lower), w.toLowerCase(), w.toUpperCase()]) if (v !== w && this.correct(v)) found.set(v, 0);
    // REP table: common misspellings.
    for (const [re, from, to] of this.rep) {
      if (!re.global) {
        if (re.test(lower)) offer(lower.replace(re, to), 1);
        continue;
      }
      let idx = lower.indexOf(from);
      while (idx >= 0) {
        offer(lower.slice(0, idx) + to + lower.slice(idx + from.length), 1);
        idx = lower.indexOf(from, idx + 1);
      }
    }
    for (const c of this.edits(lower)) offer(c.word, c.cost);
    // Two words ("alot" -> "a lot").
    for (let i = 1; i < lower.length; i++) offer(`${lower.slice(0, i)} ${lower.slice(i)}`, 2.5);
    if (found.size < max) for (const c of this.ngram(lower, max * 2)) if (!found.has(c.word) && this.suggestible(c.word)) found.set(c.word, c.cost);
    const ranked = [...found.entries()]
      .sort((a, b) => a[1] - b[1] || lcsScore(lower, b[0]) - lcsScore(lower, a[0]) || a[0].length - b[0].length)
      .map(([s]) => s);
    return [...new Set(ranked.map((s) => applyShape(s, shape)))].slice(0, max);
  }

  /** Single edits (delete, transpose, replace, insert, move), cheaper when
   *  the keys are neighbours on the keyboard. */
  private edits(w: string): Candidate[] {
    const out: Candidate[] = [];
    const tryChars = [...new Set(this.tryChars.toLowerCase() || "etaoinshrdlucmfwypvbgkjqxz")];
    for (let i = 0; i < w.length; i++) {
      out.push({ word: w.slice(0, i) + w.slice(i + 1), cost: w[i] === w[i - 1] ? 1 : 1.6 });
      if (i + 1 < w.length) out.push({ word: w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2), cost: 1 });
      for (const c of tryChars) {
        if (c === w[i]) continue;
        out.push({ word: w.slice(0, i) + c + w.slice(i + 1), cost: this.adjacent(w[i], c) ? 1.1 : 1.7 });
      }
      // Move a character two places ("aclohol" -> "alcohol").
      if (i + 2 < w.length) out.push({ word: w.slice(0, i) + w[i + 1] + w[i + 2] + w[i] + w.slice(i + 3), cost: 2 });
    }
    for (let i = 0; i <= w.length; i++)
      for (const c of tryChars) out.push({ word: w.slice(0, i) + c + w.slice(i), cost: c === w[i - 1] || c === w[i] ? 1.1 : 1.6 });
    return out;
  }

  private adjacent(a: string, b: string): boolean {
    const rows = this.key.split("|");
    for (let r = 0; r < rows.length; r++) {
      const i = rows[r].indexOf(a);
      if (i < 0) continue;
      if (rows[r][i - 1] === b || rows[r][i + 1] === b) return true;
      for (const rr of [rows[r - 1], rows[r + 1]]) if (rr && (rr[i] === b || rr[i - 1] === b || rr[i + 1] === b)) return true;
    }
    return false;
  }

  /** Hunspell-style n-gram search over the stems (and their suffixed
   *  forms) for words that are more than one edit away. */
  private ngram(w: string, max: number): Candidate[] {
    const scored: [string, number][] = [];
    const n = w.length;
    for (const stem of this.words.keys()) {
      if (Math.abs(stem.length - n) > 4) continue;
      const s = ngramScore(w, stem.toLowerCase());
      if (s > 0) scored.push([stem, s]);
    }
    scored.sort((a, b) => b[1] - a[1]);
    const out = new Map<string, number>();
    for (const [stem] of scored.slice(0, 60)) {
      for (const form of this.forms(stem)) {
        const lf = form.toLowerCase();
        if (Math.abs(lf.length - n) > 3) continue;
        const d = editDistance(w, lf);
        if (d > Math.max(2, Math.floor(n / 3))) continue;
        const cost = 2 + d - ngramScore(w, lf) / (n * 3);
        if (!out.has(form) || out.get(form)! > cost) out.set(form, cost);
      }
    }
    return [...out.entries()].sort((a, b) => a[1] - b[1]).slice(0, max).map(([word, cost]) => ({ word, cost }));
  }

  /** forms expands a stem with its own suffixes and prefixes (one level). */
  forms(stem: string): string[] {
    const out = new Set<string>();
    for (const flags of this.words.get(stem) ?? []) {
      if (!this.hasFlag(flags, this.needAffix) && !this.hasFlag(flags, this.onlyInCompound)) out.add(stem);
      for (const f of flags) {
        for (const kind of ["SFX", "PFX"] as const) {
          const cls = this.classes.get(`${kind}:${f}`);
          if (!cls) continue;
          for (const r of cls.rules) {
            if (kind === "SFX") {
              if (r.strip && !stem.endsWith(r.strip)) continue;
              const base = stem.slice(0, stem.length - r.strip.length);
              if (r.cond && !r.cond.test(stem)) continue;
              out.add(base + r.add);
            } else {
              if (r.strip && !stem.startsWith(r.strip)) continue;
              if (r.cond && !r.cond.test(stem)) continue;
              out.add(r.add + stem.slice(r.strip.length));
            }
          }
        }
      }
    }
    return [...out];
  }
}

const ruleClass = new WeakMap<AffixRule, AffixClass>();

// --- helpers ------------------------------------------------------------------------------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** condRegex turns a Hunspell condition ("[^aeiou]y", ".") into a regex
 *  anchored at the stem's end (SFX) or start (PFX). */
function condRegex(cond: string, kind: "PFX" | "SFX"): RegExp | null {
  if (!cond || cond === ".") return null;
  const src = cond.replace(/[\\$^(){}|+*?]/g, (c) => (c === "^" ? "^" : `\\${c}`));
  // Hunspell conditions use only [...], [^...], "." and literals; keep
  // "^" inside brackets as negation.
  const fixed = src.replace(/\\\^/g, "^");
  try {
    return kind === "SFX" ? new RegExp(`${fixed}$`, "u") : new RegExp(`^${fixed}`, "u");
  } catch {
    return null;
  }
}

export type CaseShape = "lower" | "capital" | "upper" | "mixed";

export function caseShape(w: string): CaseShape {
  const letters = w.replace(/[^\p{L}]/gu, "");
  if (!letters) return "lower";
  if (letters === letters.toLowerCase()) return "lower";
  if (letters === letters.toUpperCase()) return letters.length > 1 ? "upper" : "capital";
  const first = letters[0];
  if (first === first.toUpperCase() && letters.slice(1) === letters.slice(1).toLowerCase()) return "capital";
  return "mixed";
}

function capitalize(w: string): string {
  return w ? w[0].toUpperCase() + w.slice(1) : w;
}

function applyShape(s: string, shape: CaseShape): string {
  if (shape === "upper") return s.toUpperCase();
  if (shape === "capital") return capitalize(s);
  return s;
}

/** The spellings a word may legitimately match: "THE" matches "the" and
 *  "The"; "The" matches "the"; "the" matches only itself. */
function caseVariants(w: string): { word: string; exact: boolean }[] {
  const shape = caseShape(w);
  const out = [{ word: w, exact: true }];
  if (shape === "upper") {
    out.push({ word: capitalize(w.toLowerCase()), exact: false }, { word: w.toLowerCase(), exact: false });
    // "O'NEIL" -> "O'Neil".
    const m = /^(\p{Lu}+['’])(\p{Lu})(.*)$/u.exec(w);
    if (m) out.push({ word: capitalize(m[1].toLowerCase()) + m[2] + m[3].toLowerCase(), exact: false });
  } else if (shape === "capital") {
    out.push({ word: w.toLowerCase(), exact: false });
  }
  return out;
}

/** Shared n-grams (1..3) between two words, weighted like Hunspell. */
export function ngramScore(a: string, b: string): number {
  let score = 0;
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= a.length; i++) if (b.includes(a.slice(i, i + n))) score += n;
  }
  // Penalise length differences.
  return score - Math.abs(a.length - b.length) * 2;
}

function lcsScore(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** Damerau-Levenshtein distance (optimal string alignment). */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}
