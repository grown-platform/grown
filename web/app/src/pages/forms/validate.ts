/**
 * Forms response validation, text-form masks/formats and section-branching
 * paths. internal/forms/validate.go mirrors this file (the server re-checks
 * every submission) and uses the same error messages.
 *
 * Masks follow OnlyOffice text-form masks (behaviour only, own code):
 *   9 = digit, a/A = letter, O = digit or letter, X = any character,
 *   \c = the literal c, anything else is a literal.
 */
import type {
  AnswerMap,
  AnswerValue,
  Form,
  FormQuestion,
  FormValidation,
  GridAnswer,
  TextFormat,
} from "./types";
import { GRID_KEY_SEP, SUBMIT_TARGET } from "./types";

// ---------------------------------------------------------------- masks ----

type MaskItem =
  | { kind: "digit" }
  | { kind: "letter" }
  | { kind: "digitOrLetter" }
  | { kind: "any" }
  | { kind: "literal"; ch: string };

const isDigitCh = (c: string) => c >= "0" && c <= "9";
const isLetterCh = (c: string) => /^\p{L}$/u.test(c);

export function parseMask(mask: string): MaskItem[] {
  const out: MaskItem[] = [];
  const cs = Array.from(mask);
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c === "\\") {
      if (i + 1 < cs.length) out.push({ kind: "literal", ch: cs[++i] });
    } else if (c === "9") out.push({ kind: "digit" });
    else if (c === "a" || c === "A") out.push({ kind: "letter" });
    else if (c === "O") out.push({ kind: "digitOrLetter" });
    else if (c === "X") out.push({ kind: "any" });
    else out.push({ kind: "literal", ch: c });
  }
  return out;
}

function accepts(it: MaskItem, c: string): boolean {
  switch (it.kind) {
    case "digit":
      return isDigitCh(c);
    case "letter":
      return isLetterCh(c);
    case "digitOrLetter":
      return isDigitCh(c) || isLetterCh(c);
    case "any":
      return true;
    case "literal":
      return it.ch === c;
  }
}

/** Number of characters a complete value has (OnlyOffice "max characters"). */
export function maskLength(mask: string): number {
  return parseMask(mask).length;
}

/** Does `s` fit `mask`? With `full` every position must be filled; without
 *  it a prefix is enough (the respondent is still typing). */
export function maskCheck(mask: string, s: string, full = false): boolean {
  const items = parseMask(mask);
  const cs = Array.from(s);
  if (full && cs.length !== items.length) return false;
  if (cs.length > items.length) return false;
  return cs.every((c, i) => accepts(items[i], c));
}

/** Fit typed text into `mask`, inserting literals the respondent skipped
 *  ("9991231122" → "(999) 123-1122"). Text that can't be fitted comes back
 *  unchanged; input longer than the mask is cut at the mask length. */
export function maskCorrect(mask: string, s: string): string {
  const items = parseMask(mask);
  const input = Array.from(s);
  if (!items.length || !input.length) return s;
  const out: string[] = [];
  let pos = 0;
  for (const it of items) {
    if (pos < input.length && accepts(it, input[pos])) {
      out.push(input[pos++]);
    } else if (it.kind === "literal") {
      out.push(it.ch);
    } else break;
  }
  if (pos === input.length || out.length === items.length) return out.join("");
  return s;
}

/** A mask as the respondent should read it (escapes removed). */
export function maskDisplay(mask: string): string {
  return mask.replace(/\\(.)/gu, "$1");
}

/** The mask behind a text format ("" = no mask). */
export function formatMask(format: TextFormat | undefined, mask?: string): string {
  switch (format) {
    case "phone":
      return "(999) 999-9999";
    case "zip":
      return "99999";
    case "credit_card":
      return "9999 9999 9999 9999";
    case "mask":
      return mask ?? "";
    default:
      return "";
  }
}

export const TEXT_FORMAT_LABELS: Record<TextFormat, string> = {
  "": "None",
  digits: "Digits only",
  letters: "Letters only",
  phone: "Phone (999) 999-9999",
  zip: "ZIP code 99999",
  credit_card: "Credit card 9999 9999 9999 9999",
  mask: "Custom mask",
};

/**
 * TextFormFormat is the OnlyOffice-style text-form format: an optional
 * allowed-symbol set combined with one base format (digits, letters, a mask
 * or a regular expression).
 */
export class TextFormFormat {
  private base: "none" | "digit" | "letter" | "mask" | "regexp" = "none";
  private symbols: Set<string> | null = null;
  private mask = "";
  private regexp = "";

  setSymbols(symbols?: string) {
    this.symbols = symbols ? new Set(Array.from(symbols)) : null;
  }
  getSymbols(): string {
    return this.symbols ? Array.from(this.symbols).join("") : "";
  }
  setNone() {
    this.base = "none";
  }
  setDigit() {
    this.base = "digit";
  }
  setLetter() {
    this.base = "letter";
  }
  setMask(mask: string) {
    this.base = "mask";
    this.mask = mask;
  }
  setRegExp(re: string) {
    this.base = "regexp";
    this.regexp = re;
  }
  /** Maximum characters: the mask length, or -1 when unlimited. */
  maxCharacters(): number {
    return this.base === "mask" ? maskLength(this.mask) : -1;
  }

  private checkSymbols(cs: string[]): boolean {
    const sym = this.symbols;
    return !sym || cs.every((c) => sym.has(c));
  }

  private checkBase(text: string, full: boolean): boolean {
    const cs = Array.from(text);
    switch (this.base) {
      case "digit":
        return cs.every(isDigitCh);
      case "letter":
        return cs.every(isLetterCh);
      case "mask":
        return maskCheck(this.mask, text, full);
      case "regexp":
        return fullMatch(this.regexp, text) ?? true;
      default:
        return true;
    }
  }

  /** Validate a value. `full` requires a complete mask. */
  check(text: string | number[], full = false): boolean {
    const s = typeof text === "string" ? text : String.fromCodePoint(...text);
    return this.checkSymbols(Array.from(s)) && this.checkBase(s, full);
  }

  /** Keystroke check while typing: symbols always; digits/letters filter
   *  immediately; masks only limit the length (checked again on blur). */
  checkOnFly(text: string): boolean {
    const cs = Array.from(text);
    if (!this.checkSymbols(cs)) return false;
    if (this.base === "digit" || this.base === "letter")
      return this.checkBase(text, false);
    if (this.base === "mask") return cs.length <= maskLength(this.mask);
    return true;
  }
}

/**
 * TextFormInput simulates a text form being filled key by key: rejected
 * keystrokes are dropped, and leaving the field reverts a value that no
 * longer fits the mask to the last one that did.
 */
export class TextFormInput {
  value = "";
  private lastValid = "";
  constructor(public format: TextFormFormat) {}
  type(chars: string) {
    for (const c of Array.from(chars)) {
      const next = this.value + c;
      if (this.format.checkOnFly(next)) this.value = next;
    }
  }
  backspace(n = 1) {
    this.value = Array.from(this.value).slice(0, -n).join("");
  }
  blur() {
    if (this.format.check(this.value)) this.lastValid = this.value;
    else this.value = this.lastValid;
  }
}

/** Keystroke handler for a short-answer input with a text format: returns
 *  the value to show, or `prev` to reject the keystroke. Deleting is always
 *  allowed; typing into a mask inserts literals as needed. */
export function applyTextFormat(
  q: Pick<FormQuestion, "text_format" | "mask">,
  prev: string,
  next: string,
): string {
  const fmt = q.text_format ?? "";
  if (fmt === "digits") return Array.from(next).every(isDigitCh) ? next : prev;
  if (fmt === "letters")
    return Array.from(next).every(isLetterCh) ? next : prev;
  const mask = formatMask(fmt, q.mask);
  if (!mask) return next;
  if (next.length < prev.length) return next; // deleting
  const corrected = maskCorrect(mask, next);
  return maskCheck(mask, corrected) ? corrected : prev;
}

// ----------------------------------------------------------- validation ----

const NUMBER_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?([/?#]\S*)?$/i;

function parseNumber(s: string): number | null {
  const t = s.trim();
  return NUMBER_RE.test(t) ? Number(t) : null;
}

/** Whole-string regex match; null when the pattern doesn't compile. */
function fullMatch(re: string, s: string): boolean | null {
  try {
    return new RegExp(`^(?:${re})$`, "u").test(s);
  } catch {
    try {
      return new RegExp(`^(?:${re})$`).test(s);
    } catch {
      return null;
    }
  }
}

function findMatch(re: string, s: string): boolean | null {
  try {
    return new RegExp(re).test(s);
  } catch {
    return null;
  }
}

/** Ops offered per validation kind, in menu order (Google Forms wording). */
export const VALIDATION_OPS: Record<
  "number" | "text" | "length" | "regex" | "checkbox",
  { op: string; label: string; args: 0 | 1 | 2 }[]
> = {
  number: [
    { op: "gt", label: "Greater than", args: 1 },
    { op: "gte", label: "Greater than or equal to", args: 1 },
    { op: "lt", label: "Less than", args: 1 },
    { op: "lte", label: "Less than or equal to", args: 1 },
    { op: "eq", label: "Equal to", args: 1 },
    { op: "neq", label: "Not equal to", args: 1 },
    { op: "between", label: "Between", args: 2 },
    { op: "not_between", label: "Not between", args: 2 },
    { op: "is_number", label: "Is number", args: 0 },
    { op: "whole_number", label: "Whole number", args: 0 },
  ],
  text: [
    { op: "contains", label: "Contains", args: 1 },
    { op: "not_contains", label: "Doesn't contain", args: 1 },
    { op: "email", label: "Email", args: 0 },
    { op: "url", label: "URL", args: 0 },
  ],
  length: [
    { op: "max_chars", label: "Maximum character count", args: 1 },
    { op: "min_chars", label: "Minimum character count", args: 1 },
  ],
  regex: [
    { op: "contains", label: "Contains", args: 1 },
    { op: "not_contains", label: "Doesn't contain", args: 1 },
    { op: "matches", label: "Matches", args: 1 },
    { op: "not_matches", label: "Doesn't match", args: 1 },
  ],
  checkbox: [
    { op: "at_least", label: "Select at least", args: 1 },
    { op: "at_most", label: "Select at most", args: 1 },
    { op: "exactly", label: "Select exactly", args: 1 },
  ],
};

function ruleMessage(
  v: FormValidation,
  s: string,
  sel: string[],
): string | null {
  const a = (v.value ?? "").trim();
  const b = (v.value2 ?? "").trim();
  switch (v.kind) {
    case "number": {
      const n = parseNumber(s);
      if (n === null) return "Must be a number";
      const x = Number(a);
      const y = Number(b);
      const lo = Math.min(x, y);
      const hi = Math.max(x, y);
      switch (v.op) {
        case "gt":
          return n > x ? null : `Must be a number greater than ${a}`;
        case "gte":
          return n >= x
            ? null
            : `Must be a number greater than or equal to ${a}`;
        case "lt":
          return n < x ? null : `Must be a number less than ${a}`;
        case "lte":
          return n <= x ? null : `Must be a number less than or equal to ${a}`;
        case "eq":
          return n === x ? null : `Must be a number equal to ${a}`;
        case "neq":
          return n !== x ? null : `Must be a number not equal to ${a}`;
        case "between":
          return n >= lo && n <= hi
            ? null
            : `Must be a number between ${a} and ${b}`;
        case "not_between":
          return n < lo || n > hi
            ? null
            : `Must be a number not between ${a} and ${b}`;
        case "whole_number":
          return Number.isInteger(n) && !s.includes(".")
            ? null
            : "Must be a whole number";
      }
      return null;
    }
    case "text": {
      const raw = v.value ?? "";
      switch (v.op) {
        case "contains":
          return s.includes(raw) ? null : `Must contain "${raw}"`;
        case "not_contains":
          return raw && s.includes(raw) ? `Must not contain "${raw}"` : null;
        case "email":
          return EMAIL_RE.test(s.trim()) ? null : "Must be an email address";
        case "url":
          return URL_RE.test(s.trim()) ? null : "Must be a URL";
      }
      return null;
    }
    case "length": {
      const n = parseInt(a, 10) || 0;
      const l = Array.from(s).length;
      if (v.op === "max_chars" && l > n) return `Must be at most ${n} characters`;
      if (v.op === "min_chars" && l < n)
        return `Must be at least ${n} characters`;
      return null;
    }
    case "regex": {
      const re = v.value ?? "";
      switch (v.op) {
        case "contains":
          return findMatch(re, s) === false
            ? `Must contain a match for ${re}`
            : null;
        case "not_contains":
          return findMatch(re, s) ? `Must not contain a match for ${re}` : null;
        case "matches":
          return fullMatch(re, s) === false
            ? `Must match the pattern ${re}`
            : null;
        case "not_matches":
          return fullMatch(re, s) ? `Must not match the pattern ${re}` : null;
      }
      return null;
    }
    case "checkbox": {
      const n = parseInt(a, 10) || 0;
      const c = sel.length;
      if (v.op === "at_least" && c < n)
        return `Must select at least ${n} options`;
      if (v.op === "at_most" && c > n) return `Must select at most ${n} options`;
      if (v.op === "exactly" && c !== n)
        return `Must select exactly ${n} options`;
      return null;
    }
  }
  return null;
}

function withCustom(v: FormValidation, msg: string | null): string | null {
  if (msg && v.error_text?.trim()) return v.error_text.trim();
  return msg;
}

function textFormatMessage(q: FormQuestion, s: string): string | null {
  const fmt = q.text_format ?? "";
  if (fmt === "digits")
    return Array.from(s).every(isDigitCh) ? null : "Must contain only digits";
  if (fmt === "letters")
    return Array.from(s).every(isLetterCh) ? null : "Must contain only letters";
  const mask = formatMask(fmt, q.mask);
  if (mask && !maskCheck(mask, s, true))
    return `Must match the format ${maskDisplay(mask)}`;
  return null;
}

export function isGridType(t: FormQuestion["type"]): boolean {
  return t === "multiple_choice_grid" || t === "checkbox_grid";
}

/** Grid answer as row → selected columns (empty rows dropped). */
export function gridSelections(v: AnswerValue | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [row, cell] of Object.entries(v as GridAnswer)) {
    const cols = (Array.isArray(cell) ? cell : [cell]).filter(
      (c) => typeof c === "string" && c !== "",
    );
    if (cols.length) out[row] = cols;
  }
  return out;
}

export function ratingLevels(q: Pick<FormQuestion, "scale_max">): number {
  return q.scale_max >= 3 && q.scale_max <= 10 ? q.scale_max : 5;
}

function gridMessage(q: FormQuestion, v: AnswerValue | undefined): string | null {
  if (v !== undefined && (typeof v !== "object" || Array.isArray(v)))
    return "Invalid grid answer";
  const ans = gridSelections(v);
  const rows = new Set(q.rows ?? []);
  const cols = new Set(q.options);
  const used = new Set<string>();
  for (const [row, sel] of Object.entries(ans)) {
    if (!rows.has(row)) return `Unknown row "${row}"`;
    if (q.type === "multiple_choice_grid" && sel.length > 1)
      return "Select one response per row";
    for (const c of sel) {
      if (!cols.has(c)) return `Unknown column "${c}"`;
      if (q.limit_one_per_column) {
        if (used.has(c))
          return "Please don't select more than one response per column";
        used.add(c);
      }
    }
  }
  const answeredRows = Object.keys(ans).length;
  if (q.required && answeredRows > 0 && answeredRows < rows.size)
    return "This question requires one response per row";
  return null;
}

/** The validation message for an answer, or null when it's acceptable.
 *  Empty answers pass (the required check is separate). */
export function validateAnswer(
  q: FormQuestion,
  v: AnswerValue | undefined,
): string | null {
  switch (q.type) {
    case "short_answer":
    case "paragraph": {
      const s = typeof v === "string" ? v : "";
      if (!s) return null;
      if (q.type === "short_answer") {
        const m = textFormatMessage(q, s);
        if (m) return m;
      }
      return q.validation?.kind
        ? withCustom(q.validation, ruleMessage(q.validation, s, []))
        : null;
    }
    case "checkboxes": {
      const sel = Array.isArray(v) ? v : [];
      if (!sel.length || !q.validation?.kind) return null;
      return withCustom(q.validation, ruleMessage(q.validation, "", sel));
    }
    case "multiple_choice_grid":
    case "checkbox_grid":
      return gridMessage(q, v);
    case "rating": {
      if (typeof v !== "string" || !v) return null;
      const n = Number(v);
      const max = ratingLevels(q);
      return Number.isInteger(n) && n >= 1 && n <= max
        ? null
        : `Must be a rating from 1 to ${max}`;
    }
  }
  return null;
}

/** Has the question been answered at all? */
export function isAnswered(q: FormQuestion, v: AnswerValue | undefined): boolean {
  if (isGridType(q.type)) return Object.keys(gridSelections(v)).length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return typeof v === "string" && v.trim() !== "";
}

/** The message to show under a question, or null: required first, then
 *  validation. */
export function questionError(
  q: FormQuestion,
  v: AnswerValue | undefined,
): string | null {
  if (q.required && !isAnswered(q, v)) {
    return isGridType(q.type)
      ? "This question requires one response per row"
      : "This is a required question";
  }
  return validateAnswer(q, v);
}

// ------------------------------------------------------ sections / paths ----

/** One respondent page: the section divider (null for the first, implicit
 *  section) and the questions on it. */
export interface FormPage {
  section: FormQuestion | null;
  questions: FormQuestion[];
}

export function buildPages(questions: FormQuestion[]): FormPage[] {
  const pages: FormPage[] = [{ section: null, questions: [] }];
  for (const q of questions) {
    if (q.is_section) pages.push({ section: q, questions: [] });
    else pages[pages.length - 1].questions.push(q);
  }
  return pages;
}

/** Where the respondent goes after page `idx` (-1 = submit). The last
 *  go-to-section answer on the page wins, then the section's "after
 *  section" setting, then the next page. */
export function nextPage(
  form: Pick<Form, "settings">,
  pages: FormPage[],
  idx: number,
  answers: AnswerMap,
): number {
  let target = "";
  for (const q of pages[idx].questions) {
    if (q.type !== "multiple_choice" && q.type !== "dropdown") continue;
    const a = answers[q.id];
    if (typeof a === "string" && q.go_to_section?.[a]) target = q.go_to_section[a];
  }
  if (!target) {
    target =
      (pages[idx].section
        ? pages[idx].section!.after_section
        : form.settings?.after_first_section) ?? "";
  }
  if (target === SUBMIT_TARGET) return -1;
  if (target) {
    const i = pages.findIndex((p) => p.section?.id === target);
    if (i >= 0) return i;
  }
  return idx + 1 >= pages.length ? -1 : idx + 1;
}

/** The page indices a respondent with these answers walks through. A jump
 *  back to a page already visited ends the walk. */
export function pagePath(
  form: Pick<Form, "settings" | "questions">,
  answers: AnswerMap,
): number[] {
  const pages = buildPages(form.questions);
  const path: number[] = [];
  for (let i = 0; i >= 0 && !path.includes(i); i = nextPage(form, pages, i, answers))
    path.push(i);
  return path;
}

/** Ids of the questions the respondent reaches. */
export function visitedQuestionIds(
  form: Pick<Form, "settings" | "questions">,
  answers: AnswerMap,
): Set<string> {
  const pages = buildPages(form.questions);
  const out = new Set<string>();
  for (const i of pagePath(form, answers))
    for (const q of pages[i].questions) out.add(q.id);
  return out;
}

/** Drop answers to questions on sections the respondent never reached. */
export function pruneSkipped(
  form: Pick<Form, "settings" | "questions">,
  answers: AnswerMap,
): AnswerMap {
  const seen = visitedQuestionIds(form, answers);
  const out: AnswerMap = {};
  for (const [k, v] of Object.entries(answers)) if (seen.has(k)) out[k] = v;
  return out;
}

/** Are all required questions on the respondent's path answered and valid? */
export function isAllRequiredFilled(
  form: Pick<Form, "settings" | "questions">,
  answers: AnswerMap,
): boolean {
  const seen = visitedQuestionIds(form, answers);
  return form.questions.every(
    (q) => q.is_section || !seen.has(q.id) || questionError(q, answers[q.id]) === null,
  );
}

// ------------------------------------------------- form data get / set ----

export interface FormFieldData {
  key: string;
  title: string;
  type: FormQuestion["type"];
  value: AnswerValue;
  options?: string[];
  rows?: string[];
}

/** Every answerable question with its current value (OnlyOffice
 *  GetAllFormsData analogue; pre-filled links and exports use it). */
export function getAllFormsData(
  form: Pick<Form, "questions">,
  answers: AnswerMap,
): FormFieldData[] {
  return form.questions
    .filter((q) => !q.is_section)
    .map((q) => {
      const empty: AnswerValue =
        q.type === "checkboxes" ? [] : isGridType(q.type) ? {} : "";
      const d: FormFieldData = {
        key: q.id,
        title: q.title,
        type: q.type,
        value: answers[q.id] ?? empty,
      };
      if (q.options.length) d.options = [...q.options];
      if (isGridType(q.type)) d.rows = [...(q.rows ?? [])];
      return d;
    });
}

/** Apply `{key, value}` pairs (key = question id or title) to answers;
 *  unknown keys and values outside a choice question's options are ignored. */
export function setAllFormsData(
  form: Pick<Form, "questions">,
  answers: AnswerMap,
  data: { key: string; value: AnswerValue }[],
): AnswerMap {
  const out: AnswerMap = { ...answers };
  for (const { key, value } of data) {
    const q =
      form.questions.find((x) => !x.is_section && x.id === key) ??
      form.questions.find((x) => !x.is_section && x.title === key);
    if (!q) continue;
    if (
      (q.type === "multiple_choice" || q.type === "dropdown") &&
      (typeof value !== "string" || !q.options.includes(value))
    )
      continue;
    if (
      q.type === "checkboxes" &&
      (!Array.isArray(value) || !value.every((x) => q.options.includes(x)))
    )
      continue;
    out[q.id] = value;
  }
  return out;
}

/** An answer as display text ("Mon: AM; Tue: PM" for grids). */
export function formatAnswer(
  q: Pick<FormQuestion, "type" | "rows">,
  v: AnswerValue | undefined,
): string {
  if (v === undefined || v === null) return "";
  if (isGridType(q.type)) {
    const sel = gridSelections(v);
    const order = q.rows ?? Object.keys(sel);
    return order
      .filter((r) => sel[r])
      .map((r) => `${r}: ${sel[r].join(", ")}`)
      .join("; ");
  }
  if (Array.isArray(v)) return v.join(", ");
  return typeof v === "string" ? v : "";
}

/** Grid answer key as row → keyed columns (from correct_answers). */
export function gridKey(q: Pick<FormQuestion, "correct_answers">): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const e of q.correct_answers ?? []) {
    const i = e.indexOf(GRID_KEY_SEP);
    if (i < 0) continue;
    (out[e.slice(0, i)] ??= []).push(e.slice(i + GRID_KEY_SEP.length));
  }
  return out;
}

/** Fraction (0..1) of keyed grid rows answered exactly right; mirrors
 *  gradeGrid in internal/forms/service.go. */
export function gridScoreFraction(
  q: Pick<FormQuestion, "correct_answers">,
  v: AnswerValue | undefined,
): number {
  const key = gridKey(q);
  const rows = Object.keys(key);
  if (!rows.length) return 0;
  const sel = gridSelections(v);
  const ok = rows.filter((r) => {
    const got = sel[r] ?? [];
    return got.length === key[r].length && got.every((c) => key[r].includes(c));
  }).length;
  return ok / rows.length;
}
