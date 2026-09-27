/* eslint-disable @typescript-eslint/no-explicit-any -- FortuneSheet verification entries are loosely typed. */

// Data validation: rules with applies-to ranges (Excel/OnlyOffice model),
// kept on each sheet as `grownDV`. FortuneSheet stores validation per cell
// (`dataVerification["r_c"]`); that map is derived from the rules so the grid
// keeps its in-cell dropdowns, checkboxes and input hints, while the checks
// themselves (whole/decimal/list/date/time/length/custom, alert styles) run
// here through the grid's beforeUpdateCell hook.
//
// Range algebra follows the OnlyOffice API: adding over an existing rule's
// cells fails, deleting trims rules (splitting their ranges), and modifying
// carves the area out of every rule it touches and adds the new rule there.

import type { CellRect } from "./cellRange";
import { rectIntersection, rectsSubtract } from "./cellRange";
import {
  cellScalar,
  colToLetters,
  isError,
  parseDateTimeText,
  parseInput,
  parseNumberText,
  parseTimeText,
  serialToParts,
  type Grid,
  type Scalar,
} from "./cellValue";
import { evaluateFormula, evaluateToValues, formulaIsTrue, toText, type EvalContext } from "./sheetFormula";

export type DvType = "any" | "whole" | "decimal" | "list" | "date" | "time" | "textLength" | "custom" | "checkbox";
export type DvOperator =
  | "between"
  | "notBetween"
  | "equal"
  | "notEqual"
  | "greaterThan"
  | "lessThan"
  | "greaterThanOrEqual"
  | "lessThanOrEqual";
export type DvAlertStyle = "stop" | "warning" | "information";

export interface DvRule {
  id: string;
  type: DvType;
  operator: DvOperator;
  /** Stored like Excel: numbers as text, dates/times as serials, lists as "a,b" or "=$A$1:$A$3", formulas with "=". */
  formula1: string;
  formula2: string;
  allowBlank: boolean;
  showDropdown: boolean;
  showInput: boolean;
  promptTitle: string;
  prompt: string;
  showError: boolean;
  errorStyle: DvAlertStyle;
  errorTitle: string;
  error: string;
  ranges: CellRect[];
  /** Checkbox values (checked/unchecked). */
  checked?: string;
  unchecked?: string;
}

export type DvProps = Partial<Omit<DvRule, "id" | "ranges" | "formula1" | "formula2">> & {
  type: DvType;
  formula1?: FormulaInput;
  formula2?: FormulaInput;
};

/** A validation operand: text, a number, a list of items, or a range. */
export type FormulaInput = string | number | string[] | number[] | { range: CellRect; sheet?: string } | null | undefined;

export const DV_TYPES: DvType[] = ["any", "whole", "decimal", "list", "date", "time", "textLength", "custom", "checkbox"];

let idSeq = 0;
function newId(): string {
  idSeq += 1;
  return `dv-${Date.now().toString(36)}-${idSeq.toString(36)}`;
}

function absRef(r: CellRect): string {
  const a = `$${colToLetters(Math.min(r.c1, r.c2))}$${Math.min(r.r1, r.r2) + 1}`;
  const b = `$${colToLetters(Math.max(r.c1, r.c2))}$${Math.max(r.r1, r.r2) + 1}`;
  return a === b ? a : `${a}:${b}`;
}

function quoteSheet(name: string): string {
  return /^[A-Za-z_][\w.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

/** Normalises an operand for storage (see DvRule.formula1). */
export function normalizeFormula(type: DvType, x: FormulaInput): string {
  if (x == null) return "";
  if (typeof x === "object" && !Array.isArray(x)) {
    return "=" + (x.sheet ? quoteSheet(x.sheet) + "!" : "") + absRef(x.range);
  }
  if (Array.isArray(x)) return x.map(String).join(",");
  if (typeof x === "number") return String(x);
  const s = x.trim();
  if (s.startsWith("=")) return s;
  if (type === "date") {
    const d = parseDateTimeText(s);
    if (d) return String(d.serial);
  }
  if (type === "time") {
    const t = parseTimeText(s) ?? parseDateTimeText(s)?.serial ?? null;
    if (t !== null) return String(t);
  }
  if (type === "whole" || type === "decimal" || type === "textLength" || type === "date" || type === "time") {
    const n = parseNumberText(s);
    if (n) return String(n.v);
  }
  return s;
}

export function makeRule(ranges: CellRect[], props: DvProps): DvRule {
  const type = props.type;
  return {
    id: newId(),
    type,
    operator: props.operator ?? "between",
    formula1: normalizeFormula(type, props.formula1),
    formula2: normalizeFormula(type, props.formula2),
    allowBlank: props.allowBlank ?? true,
    showDropdown: props.showDropdown ?? true,
    showInput: props.showInput ?? true,
    promptTitle: props.promptTitle ?? "",
    prompt: props.prompt ?? "",
    showError: props.showError ?? true,
    errorStyle: props.errorStyle ?? "stop",
    errorTitle: props.errorTitle ?? "",
    error: props.error ?? "",
    ranges,
    ...(type === "checkbox" ? { checked: props.checked ?? "TRUE", unchecked: props.unchecked ?? "FALSE" } : {}),
  };
}

function isValidType(t: unknown): t is DvType {
  return typeof t === "string" && (DV_TYPES as string[]).includes(t);
}

// ---- range algebra -------------------------------------------------------------------

export function rulesIntersecting(rules: DvRule[], rect: CellRect): DvRule[] {
  return rules.filter((r) => r.ranges.some((x) => rectIntersection(x, rect)));
}

export function validationAt(rules: DvRule[], r: number, c: number): DvRule | null {
  return (
    rules.find((x) =>
      x.ranges.some((g) => r >= Math.min(g.r1, g.r2) && r <= Math.max(g.r1, g.r2) && c >= Math.min(g.c1, g.c2) && c <= Math.max(g.c1, g.c2)),
    ) ?? null
  );
}

/** Adds a rule on `rect`; null (no change) for an unknown type or an overlap with existing rules. */
export function addValidation(rules: DvRule[], rect: CellRect, props: DvProps): { rules: DvRule[]; rule: DvRule } | null {
  if (!isValidType(props.type)) return null;
  if (rulesIntersecting(rules, rect).length) return null;
  const rule = makeRule([rect], props);
  return { rules: [...rules, rule], rule };
}

/** Removes validation from `rect`: rules inside go, overlapping rules are trimmed. */
export function deleteValidation(rules: DvRule[], rect: CellRect): DvRule[] {
  return rules
    .map((r) => (r.ranges.some((x) => rectIntersection(x, rect)) ? { ...r, ranges: rectsSubtract(r.ranges, rect) } : r))
    .filter((r) => r.ranges.length > 0);
}

/** Replaces validation on `rect` (null when nothing there to modify). */
export function modifyValidation(rules: DvRule[], rect: CellRect, props: DvProps): { rules: DvRule[]; rule: DvRule } | null {
  if (!isValidType(props.type)) return null;
  if (!rulesIntersecting(rules, rect).length) return null;
  const rule = makeRule([rect], props);
  return { rules: [...deleteValidation(rules, rect), rule], rule };
}

/** Sets validation on `rect` whether or not something was there (the dialog's Apply). */
export function setValidation(rules: DvRule[], rect: CellRect, props: DvProps): { rules: DvRule[]; rule: DvRule } {
  const rule = makeRule([rect], props);
  return { rules: [...deleteValidation(rules, rect), rule], rule };
}

// ---- checking values --------------------------------------------------------------------

export interface DvContext {
  grid: Grid;
  sheets?: Record<string, Grid>;
  names?: Record<string, string>;
  now?: Date;
}

function evalCtx(rule: DvRule, r: number, c: number, ctx: DvContext): EvalContext {
  const first = rule.ranges[0] ?? { r1: r, c1: c, r2: r, c2: c };
  const tr = Math.min(first.r1, first.r2);
  const tc = Math.min(first.c1, first.c2);
  return { grid: ctx.grid, sheets: ctx.sheets, names: ctx.names, dr: r - tr, dc: c - tc, row: r, col: c, now: ctx.now };
}

function operand(src: string, ectx: EvalContext): Scalar {
  const s = (src ?? "").trim();
  if (s === "") return null;
  if (s.startsWith("=")) return evaluateFormula(s, ectx);
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  const p = parseInput(s);
  if (p.t === "n" || p.t === "d") return p.v as number;
  return s;
}

/** The allowed items of a list rule. */
export function listItems(rule: DvRule, ctx: DvContext, r = 0, c = 0): string[] {
  const f = rule.formula1 ?? "";
  if (f.startsWith("=")) {
    return evaluateToValues(f, evalCtx(rule, r, c, ctx))
      .filter((v) => v !== null && !isError(v))
      .map((v) => toText(v) as string)
      .filter((s, i, a) => s !== "" && a.indexOf(s) === i);
  }
  return f
    .split(/[,;]/)
    .map((s) => s.trim().replace(/^"(.*)"$/, "$1"))
    .filter((s) => s !== "");
}

function compareOp(op: DvOperator, v: number, a: number, b: number | null): boolean {
  switch (op) {
    case "between":
      return b !== null && v >= Math.min(a, b) && v <= Math.max(a, b);
    case "notBetween":
      return b !== null && (v < Math.min(a, b) || v > Math.max(a, b));
    case "equal":
      return v === a;
    case "notEqual":
      return v !== a;
    case "greaterThan":
      return v > a;
    case "lessThan":
      return v < a;
    case "greaterThanOrEqual":
      return v >= a;
    case "lessThanOrEqual":
      return v <= a;
  }
}

/** Converts typed input text into the value the cell would hold. */
export function inputValue(text: unknown): Scalar {
  if (text == null) return null;
  if (typeof text === "number" || typeof text === "boolean") return text;
  const p = parseInput(String(text));
  return p.v as Scalar;
}

/**
 * Checks a value against a rule. `value` is the cell's value (typed input is
 * converted with inputValue first). Custom formulas read the grid, so the
 * caller passes a grid that already holds the new value.
 */
export function checkValue(rule: DvRule, value: Scalar, r: number, c: number, ctx: DvContext): boolean {
  const blank = value === null || value === "";
  if (rule.type === "any") return true;
  if (blank) return rule.allowBlank;
  const ectx = evalCtx(rule, r, c, ctx);
  const bounds = (): [number, number | null] | null => {
    const a = operand(rule.formula1, ectx);
    const b = operand(rule.formula2, ectx);
    if (typeof a !== "number") return null;
    return [a, typeof b === "number" ? b : null];
  };
  switch (rule.type) {
    case "whole":
    case "decimal":
    case "date":
    case "time": {
      const raw = typeof value === "string" ? inputValue(value) : value;
      if (typeof raw !== "number") return false;
      let v = raw;
      if (rule.type === "whole" && !Number.isInteger(v)) return false;
      if (rule.type === "time" && (v < 0 || v >= 1)) v = v - Math.floor(v);
      const bd = bounds();
      if (!bd) return false;
      return compareOp(rule.operator, v, bd[0], bd[1]);
    }
    case "textLength": {
      const len = String(toText(value)).length;
      const bd = bounds();
      if (!bd) return false;
      return compareOp(rule.operator, len, bd[0], bd[1]);
    }
    case "list": {
      const text = String(toText(value)).toLowerCase();
      return listItems(rule, ctx, r, c).some((x) => x.toLowerCase() === text);
    }
    case "checkbox": {
      const text = String(toText(value)).toLowerCase();
      return [rule.checked ?? "TRUE", rule.unchecked ?? "FALSE"].some((x) => x.toLowerCase() === text);
    }
    case "custom":
      return formulaIsTrue(rule.formula1 ?? "", ectx);
  }
  return true;
}

/** Checks the value currently in (r, c). */
export function checkCell(rules: DvRule[], r: number, c: number, ctx: DvContext): boolean {
  const rule = validationAt(rules, r, c);
  if (!rule) return true;
  return checkValue(rule, cellScalar(ctx.grid[r]?.[c]), r, c, ctx);
}

/** Cells holding a value their rule rejects ("Circle invalid data"). */
export function invalidCells(rules: DvRule[], ctx: DvContext): { r: number; c: number }[] {
  const out: { r: number; c: number }[] = [];
  const rows = ctx.grid.length;
  for (const rule of rules) {
    if (rule.type === "any") continue;
    for (const g of rule.ranges) {
      const r2 = Math.min(Math.max(g.r1, g.r2), rows - 1);
      for (let r = Math.min(g.r1, g.r2); r <= r2; r++) {
        const row = ctx.grid[r] ?? [];
        const c2 = Math.min(Math.max(g.c1, g.c2), row.length - 1);
        for (let c = Math.min(g.c1, g.c2); c <= c2; c++) {
          const v = cellScalar(row[c]);
          if (v === null || v === "") continue;
          if (validationAt(rules, r, c) !== rule) continue;
          if (!checkValue(rule, v, r, c, ctx)) out.push({ r, c });
        }
      }
    }
  }
  return out;
}

export type InputDecision = "accept" | "reject" | "confirm" | "inform";

/** What entering an invalid value does: stop rejects, warning asks, information tells. */
export function inputDecision(rule: DvRule | null, valid: boolean): InputDecision {
  if (!rule || valid || !rule.showError) return "accept";
  if (rule.errorStyle === "warning") return "confirm";
  if (rule.errorStyle === "information") return "inform";
  return "reject";
}

export function errorMessage(rule: DvRule): { title: string; message: string } {
  return {
    title: rule.errorTitle || (rule.errorStyle === "stop" ? "Invalid value" : rule.errorStyle === "warning" ? "Warning" : "Information"),
    message: rule.error || describeCriteria(rule),
  };
}

const OP_TEXT: Record<DvOperator, string> = {
  between: "between",
  notBetween: "not between",
  equal: "equal to",
  notEqual: "not equal to",
  greaterThan: "greater than",
  lessThan: "less than",
  greaterThanOrEqual: "greater than or equal to",
  lessThanOrEqual: "less than or equal to",
};

function shown(rule: DvRule, f: string): string {
  if (f.startsWith("=")) return f;
  const n = Number(f);
  if (rule.type === "date" && Number.isFinite(n)) {
    const p = serialToParts(n);
    return `${p.m}/${p.d}/${p.y}`;
  }
  if (rule.type === "time" && Number.isFinite(n)) {
    const p = serialToParts(n);
    return `${p.hh}:${String(p.mm).padStart(2, "0")}`;
  }
  return f;
}

/** "The value must be a whole number between 1 and 10." */
export function describeCriteria(rule: DvRule): string {
  const two = rule.operator === "between" || rule.operator === "notBetween";
  const bounds = `${OP_TEXT[rule.operator]} ${shown(rule, rule.formula1)}${two ? ` and ${shown(rule, rule.formula2)}` : ""}`;
  switch (rule.type) {
    case "whole":
      return `Enter a whole number ${bounds}.`;
    case "decimal":
      return `Enter a number ${bounds}.`;
    case "date":
      return `Enter a date ${bounds}.`;
    case "time":
      return `Enter a time ${bounds}.`;
    case "textLength":
      return `Enter text with a length ${bounds}.`;
    case "list":
      return "Choose a value from the list.";
    case "checkbox":
      return "Use the checkbox.";
    case "custom":
      return `The value must satisfy ${rule.formula1}.`;
    default:
      return "";
  }
}

// ---- FortuneSheet bridge ------------------------------------------------------------------

const FS_OP: Record<DvOperator, string> = {
  between: "between",
  notBetween: "notBetween",
  equal: "equal",
  notEqual: "notEqualTo",
  greaterThan: "moreThanThe",
  lessThan: "lessThan",
  greaterThanOrEqual: "greaterOrEqualTo",
  lessThanOrEqual: "lessThanOrEqualTo",
};
const FS_DATE_OP: Record<DvOperator, string> = {
  between: "between",
  notBetween: "notBetween",
  equal: "equal",
  notEqual: "notEqualTo",
  greaterThan: "laterThan",
  lessThan: "earlierThan",
  greaterThanOrEqual: "noEarlierThan",
  lessThanOrEqual: "noLaterThan",
};

function isoDate(f: string): string {
  const n = Number(f);
  if (!Number.isFinite(n)) return f;
  const p = serialToParts(n);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

function fsEntry(rule: DvRule): any {
  const base = {
    grownRule: rule.id,
    type2: "",
    rangeTxt: rule.ranges.map((g) => absRef(g).replace(/\$/g, "")).join(","),
    value1: "",
    value2: "",
    validity: "",
    remote: false,
    // Grown's input hook enforces the rule, with the chosen alert style.
    prohibitInput: false,
    hintShow: rule.showInput && !!(rule.prompt || rule.promptTitle),
    hintValue: [rule.promptTitle, rule.prompt].filter(Boolean).join(": "),
  };
  switch (rule.type) {
    case "list": {
      if (!rule.showDropdown) return { ...base, type: "grown" };
      const f = rule.formula1;
      const value1 = f.startsWith("=") ? f.slice(1).replace(/\$/g, "") : f;
      return { ...base, type: "dropdown", value1 };
    }
    case "checkbox":
      return { ...base, type: "checkbox", value1: rule.checked ?? "TRUE", value2: rule.unchecked ?? "FALSE" };
    case "whole":
    case "decimal":
    case "textLength":
      if (rule.formula1.startsWith("=") || rule.formula2.startsWith("=")) return { ...base, type: "grown" };
      return {
        ...base,
        type: rule.type === "whole" ? "number_integer" : rule.type === "decimal" ? "number" : "text_length",
        type2: FS_OP[rule.operator],
        value1: rule.formula1,
        value2: rule.formula2,
      };
    case "date":
      if (rule.formula1.startsWith("=") || rule.formula2.startsWith("=")) return { ...base, type: "grown" };
      return { ...base, type: "date", type2: FS_DATE_OP[rule.operator], value1: isoDate(rule.formula1), value2: isoDate(rule.formula2) };
    default:
      // time, custom, any: FortuneSheet has no such type; it treats the entry
      // as always valid and only shows the hint.
      return { ...base, type: "grown" };
  }
}

/** FortuneSheet's per-cell `dataVerification` map for a rule list (grid cells only). */
export function toFortuneVerification(rules: DvRule[], maxRows = 10000, maxCols = 1000): Record<string, any> {
  const out: Record<string, any> = {};
  for (const rule of rules) {
    if (rule.type === "any") continue;
    const entry = fsEntry(rule);
    for (const g of rule.ranges) {
      const r2 = Math.min(Math.max(g.r1, g.r2), maxRows - 1);
      const c2 = Math.min(Math.max(g.c1, g.c2), maxCols - 1);
      for (let r = Math.min(g.r1, g.r2); r <= r2; r++) {
        for (let c = Math.min(g.c1, g.c2); c <= c2; c++) {
          if (!out[`${r}_${c}`]) out[`${r}_${c}`] = entry;
        }
      }
    }
  }
  return out;
}

const FS_OP_BACK: Record<string, DvOperator> = {
  between: "between",
  notBetween: "notBetween",
  equal: "equal",
  notEqualTo: "notEqual",
  moreThanThe: "greaterThan",
  lessThan: "lessThan",
  greaterOrEqualTo: "greaterThanOrEqual",
  lessThanOrEqualTo: "lessThanOrEqual",
  laterThan: "greaterThan",
  earlierThan: "lessThan",
  noEarlierThan: "greaterThanOrEqual",
  noLaterThan: "lessThanOrEqual",
};

function looksLikeRange(s: string): boolean {
  return /^(('[^']+'|[\w.]+)!)?\$?[A-Za-z]{1,3}\$?\d+(:\$?[A-Za-z]{1,3}\$?\d+)?$/.test(s.trim());
}

/** Groups cells into rectangles: runs along rows, then equal runs stacked down. */
function cellsToRects(cells: { r: number; c: number }[]): CellRect[] {
  const byRow = new Map<number, number[]>();
  for (const { r, c } of cells) {
    const list = byRow.get(r) ?? [];
    list.push(c);
    byRow.set(r, list);
  }
  const runs: CellRect[] = [];
  for (const [r, cols] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
    cols.sort((a, b) => a - b);
    let start = cols[0];
    let prev = cols[0];
    for (let i = 1; i <= cols.length; i++) {
      const c = cols[i];
      if (c === prev + 1) {
        prev = c;
        continue;
      }
      runs.push({ r1: r, r2: r, c1: start, c2: prev });
      start = c;
      prev = c;
    }
  }
  const out: CellRect[] = [];
  for (const run of runs) {
    const above = out.find((o) => o.c1 === run.c1 && o.c2 === run.c2 && o.r2 + 1 === run.r1);
    if (above) above.r2 = run.r2;
    else out.push({ ...run });
  }
  return out;
}

/**
 * Converts FortuneSheet per-cell entries that Grown did not derive (older
 * sheets, or the grid's own toolbar) into rules.
 */
export function fromFortuneVerification(map: Record<string, any> | null | undefined): DvRule[] {
  if (!map || typeof map !== "object") return [];
  const groups = new Map<string, { item: any; cells: { r: number; c: number }[] }>();
  for (const [key, item] of Object.entries(map)) {
    if (!item || item.grownRule) continue;
    const m = key.match(/^(\d+)_(\d+)$/);
    if (!m) continue;
    const sig = JSON.stringify({ ...item, rangeTxt: undefined });
    const g = groups.get(sig) ?? { item, cells: [] };
    g.cells.push({ r: Number(m[1]), c: Number(m[2]) });
    groups.set(sig, g);
  }
  const out: DvRule[] = [];
  for (const { item, cells } of groups.values()) {
    const ranges = cellsToRects(cells);
    const common = {
      showError: true,
      errorStyle: (item.prohibitInput === false ? "warning" : "stop") as DvAlertStyle,
      showInput: !!item.hintShow,
      prompt: item.hintShow ? String(item.hintValue ?? "") : "",
    };
    const op = FS_OP_BACK[item.type2] ?? "between";
    let props: DvProps | null = null;
    switch (item.type) {
      case "dropdown": {
        const v = String(item.value1 ?? "");
        props = { ...common, type: "list", formula1: looksLikeRange(v) ? "=" + v : v };
        break;
      }
      case "checkbox":
        props = { ...common, type: "checkbox", checked: String(item.value1 ?? "TRUE"), unchecked: String(item.value2 ?? "FALSE") };
        break;
      case "number":
      case "number_decimal":
        props = { ...common, type: "decimal", operator: op, formula1: String(item.value1 ?? ""), formula2: String(item.value2 ?? "") };
        break;
      case "number_integer":
        props = { ...common, type: "whole", operator: op, formula1: String(item.value1 ?? ""), formula2: String(item.value2 ?? "") };
        break;
      case "text_length":
        props = { ...common, type: "textLength", operator: op, formula1: String(item.value1 ?? ""), formula2: String(item.value2 ?? "") };
        break;
      case "date":
        props = { ...common, type: "date", operator: op, formula1: String(item.value1 ?? ""), formula2: String(item.value2 ?? "") };
        break;
      case "text_content": {
        const first = ranges[0];
        const ref = `${colToLetters(first.c1)}${first.r1 + 1}`;
        const needle = `"${String(item.value1 ?? "").replace(/"/g, '""')}"`;
        const f =
          item.type2 === "exclude"
            ? `=ISERROR(SEARCH(${needle},${ref}))`
            : item.type2 === "equal"
              ? `=EXACT(${ref},${needle})`
              : item.type2 === "notEqualTo"
                ? `=NOT(EXACT(${ref},${needle}))`
                : `=ISNUMBER(SEARCH(${needle},${ref}))`;
        props = { ...common, type: "custom", formula1: f };
        break;
      }
      default:
        props = null;
    }
    if (props) out.push(makeRule(ranges, props));
  }
  return out;
}
