// Change case: the five modes word processors offer (Sentence case,
// lowercase, UPPERCASE, Capitalize Each Word, tOGGLE cASE). Pure string
// logic shared by Docs (textCase.ts, on ProseMirror nodes) and Slides
// (textOps.ts, on text runs).

export type CaseMode = "sentence" | "lower" | "upper" | "capitalize" | "toggle";

export const CASE_MODES: { mode: CaseMode; label: string }[] = [
  { mode: "sentence", label: "Sentence case." },
  { mode: "lower", label: "lowercase" },
  { mode: "upper", label: "UPPERCASE" },
  { mode: "capitalize", label: "Capitalize Each Word" },
  { mode: "toggle", label: "tOGGLE cASE" },
];

const isLetter = (c: string) => c.toLowerCase() !== c.toUpperCase();
export const isWordChar = (c: string) => isLetter(c) || /[0-9_]/.test(c);
const isSpace = (c: string) => /\s/.test(c);
const isSentenceEnd = (c: string) => c === "." || c === "!" || c === "?";

/**
 * caseChars transforms `chars` (one entry per code point) under `mode`.
 * `before` is the text that precedes chars[0] in the same textblock; it
 * decides whether the first characters start a word or a sentence. Returns one
 * output string per input character, so callers can map results back onto the
 * nodes they came from even when a character changes length (ß -> SS).
 */
export function caseChars(chars: string[], mode: CaseMode, before = ""): string[] {
  const out: string[] = [];
  // Word state: have we seen a word character since the last whitespace?
  let inWord = false;
  // Sentence state: are we waiting for the first letter of a sentence?
  let sentenceStart = true;
  let afterTerminator = false;
  const feed = (c: string) => {
    if (isSpace(c)) {
      inWord = false;
      if (afterTerminator) sentenceStart = true;
      afterTerminator = false;
      return;
    }
    if (isWordChar(c)) inWord = true;
    if (isLetter(c)) sentenceStart = false;
    afterTerminator = isSentenceEnd(c) ? true : afterTerminator && !isWordChar(c);
  };
  for (const c of Array.from(before)) feed(c);

  for (const c of chars) {
    let r = c;
    switch (mode) {
      case "upper":
        r = c.toUpperCase();
        break;
      case "lower":
        r = c.toLowerCase();
        break;
      case "toggle":
        r = c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase();
        break;
      case "capitalize":
        if (isLetter(c)) r = inWord ? c.toLowerCase() : c.toUpperCase();
        break;
      case "sentence":
        if (isLetter(c)) r = sentenceStart ? c.toUpperCase() : c.toLowerCase();
        break;
    }
    out.push(r);
    feed(c);
  }
  return out;
}

/** changeCaseText applies `mode` to a whole string (no preceding context). */
export function changeCaseText(text: string, mode: CaseMode, before = ""): string {
  return caseChars(Array.from(text), mode, before).join("");
}

