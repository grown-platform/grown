// Format ▸ Text ▸ change case (Excel/OnlyOffice "Change case").
//
// The conversions work on the whole cell text so that word and sentence
// boundaries are seen across rich-text runs; changeRunsCase maps the result
// back onto the runs (case changes keep the length of the text we handle).

export type TextCase = "lower" | "upper" | "toggle" | "capitalize" | "sentence";

const isLetter = (ch: string) => ch.toLowerCase() !== ch.toUpperCase();
const isWordChar = (ch: string) => isLetter(ch) || /[0-9]/.test(ch);

interface Word {
  start: number;
  end: number;
  sentenceStart: boolean;
}

/** Words (runs of letters/digits) and whether each starts a sentence. */
function words(text: string): Word[] {
  const out: Word[] = [];
  let sentence = true;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (!isWordChar(ch)) {
      if (ch === "\n" || ch === "." || ch === "!" || ch === "?") sentence = true;
      i++;
      continue;
    }
    let j = i;
    while (j < text.length && isWordChar(text[j])) j++;
    out.push({ start: i, end: j, sentenceStart: sentence });
    sentence = false;
    i = j;
  }
  return out;
}

const allUpper = (w: string) => w.length > 1 && w === w.toUpperCase() && w !== w.toLowerCase();
const capitalized = (w: string) => w[0] === w[0].toUpperCase() && w.slice(1) === w.slice(1).toLowerCase();
const cap = (w: string) => w[0].toUpperCase() + w.slice(1).toLowerCase();

/**
 * changeCase converts text. Capitalize words keeps all-caps words (acronyms)
 * and capitalises the rest; sentence case capitalises the first word of each
 * sentence (after start, a line break, . ! ?), keeps acronyms and words that
 * are already Capitalised, and lower-cases everything else.
 */
export function changeCase(text: string, mode: TextCase): string {
  switch (mode) {
    case "lower":
      return text.toLowerCase();
    case "upper":
      return text.toUpperCase();
    case "toggle":
      return [...text]
        .map((ch) => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase()))
        .join("");
  }
  const chars = text.split("");
  for (const w of words(text)) {
    const word = text.slice(w.start, w.end);
    let next = word;
    if (allUpper(word)) next = word;
    else if (mode === "capitalize") next = cap(word);
    else if (w.sentenceStart) next = cap(word);
    else if (!capitalized(word)) next = word.toLowerCase();
    if (next.length !== word.length) continue; // e.g. ß → SS; leave such words alone
    for (let k = 0; k < next.length; k++) chars[w.start + k] = next[k];
  }
  return chars.join("");
}

/** Applies changeCase across rich-text runs, keeping each run's length and format. */
export function changeRunsCase<T extends { v?: unknown }>(runs: T[], mode: TextCase): T[] {
  const texts = runs.map((r) => (r.v == null ? "" : String(r.v)));
  const whole = changeCase(texts.join(""), mode);
  let pos = 0;
  return runs.map((r, i) => {
    const len = texts[i].length;
    const v = whole.slice(pos, pos + len);
    pos += len;
    return { ...r, v };
  });
}
