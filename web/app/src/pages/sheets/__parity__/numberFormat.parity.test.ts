// @vitest-environment node
// Number formats (M6): OnlyOffice NumFormatParse.js, testsForFWB.html.js and
// CellFormatTests.js, replayed from the shared fixtures in
// internal/sheets/testdata/numfmt/ (the Go port in internal/sheets/numfmt.go
// runs the same files). Each fixture case id is its `oo:` tag.
//
// Set NUMFMT_REPORT=<file> to write failing checks as JSON lines instead of
// failing (used to triage), and NUMFMT_INCLUDE_PENDING=1 to also run pending
// checks and report the ones that now pass.
import { readFileSync, appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  formatRuns,
  runsText,
  parseInput,
  parseDatePDF,
  isLeapYear,
  isValidDay,
  isValidDate,
  isValidDatePDF,
  strcmp,
  isLocaleNumber,
  parseLocaleNumber,
} from "../numberFormat";

const dir = new URL("../../../../../../internal/sheets/testdata/numfmt/", import.meta.url);
const load = (name: string) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));

const REPORT = process.env.NUMFMT_REPORT;
const INCLUDE_PENDING = !!process.env.NUMFMT_INCLUDE_PENDING;

interface FormatCheck {
  format: string;
  value?: number | string;
  values?: (number | string)[];
  expect: string | string[];
  pending?: string;
}

interface ParseExpect {
  value?: number;
  tol?: number;
  format?: string;
  percent?: boolean;
  currency?: boolean;
  date?: boolean;
  time?: boolean;
  lt?: number;
  gt?: number;
  ifParsed?: boolean;
}

interface ParseCheck {
  fn?: string;
  args?: unknown[];
  input?: string;
  pdf?: boolean;
  culture?: { decimal: string; group: string };
  cellFormat?: string;
  date1904?: boolean;
  expect: ParseExpect | boolean | number | null;
  pending?: string;
}

function report(id: string, detail: object) {
  if (REPORT) appendFileSync(REPORT, JSON.stringify({ id, ...detail }) + "\n");
}

// Returns a failure description, or null when the check passes.
function runFormat(c: FormatCheck, defaults: (number | string)[] | undefined): string | null {
  const values = c.values ?? (c.value !== undefined ? [c.value] : defaults) ?? [];
  const want = Array.isArray(c.expect) ? c.expect : [c.expect];
  const bad: string[] = [];
  values.forEach((v, i) => {
    const got = runsText(formatRuns(v, c.format));
    if (got !== want[i]) bad.push(`${JSON.stringify(v)}: want ${JSON.stringify(want[i])} got ${JSON.stringify(got)}`);
  });
  return bad.length ? bad.join("; ") : null;
}

const FNS: Record<string, (...a: never[]) => unknown> = {
  isLeapYear,
  isValidDay,
  isValidDate,
  isValidDatePDF,
  strcmp,
  isLocaleNumber,
  parseLocaleNumber,
};

function runParse(c: ParseCheck, year: number): string | null {
  if (c.fn) {
    const got = (FNS[c.fn] as (...a: unknown[]) => unknown)(...(c.args ?? []));
    return got === c.expect ? null : `${c.fn}(${JSON.stringify(c.args)}): want ${JSON.stringify(c.expect)} got ${JSON.stringify(got)}`;
  }
  const input = c.input ?? "";
  const opts = { cellFormat: c.cellFormat, culture: c.culture, date1904: c.date1904, year };
  const got = c.pdf ? parseDatePDF(input, opts) : parseInput(input, opts);
  const e = c.expect as ParseExpect | null;
  const tag = JSON.stringify(input) + (c.cellFormat ? ` in ${JSON.stringify(c.cellFormat)}` : "");
  if (e === null) return got === null ? null : `${tag}: want text, got ${JSON.stringify(got)}`;
  if (got === null) return e.ifParsed ? null : `${tag}: want ${JSON.stringify(e)}, got text`;
  const g = got as Record<string, unknown>;
  if (e.format !== undefined && g.format !== e.format) return `${tag}: format want ${JSON.stringify(e.format)} got ${JSON.stringify(g.format)}`;
  if (e.value !== undefined) {
    const ok = e.tol !== undefined ? Math.abs((g.value as number) - e.value) < e.tol : g.value === e.value;
    if (!ok) return `${tag}: value want ${e.value} got ${g.value}`;
  }
  for (const k of ["percent", "currency", "date", "time"] as const) {
    if (e[k] && !g[k]) return `${tag}: want ${k}`;
  }
  if (e.lt !== undefined && !((g.value as number) < e.lt)) return `${tag}: want < ${e.lt}, got ${g.value}`;
  if (e.gt !== undefined && !((g.value as number) > e.gt)) return `${tag}: want > ${e.gt}, got ${g.value}`;
  return null;
}

function suite<C extends { pending?: string }>(
  file: string,
  run: (c: C, kase: Record<string, unknown>) => string | null,
) {
  const doc = load(file);
  describe(file, () => {
    for (const kase of doc.cases as { id: string; checks: C[] }[]) {
      const live = kase.checks.filter((c) => !c.pending);
      const test = live.length === 0 && !INCLUDE_PENDING ? it.skip : it;
      test(kase.id, () => {
        const failures: string[] = [];
        kase.checks.forEach((c, i) => {
          if (c.pending && !INCLUDE_PENDING) return;
          const err = run(c, kase as unknown as Record<string, unknown>);
          if (c.pending) {
            if (!err) report(kase.id, { check: i, nowPassing: true });
            return;
          }
          if (err) {
            if (REPORT) report(kase.id, { check: i, err });
            else failures.push(`#${i} ${err}`);
          }
        });
        expect(failures).toEqual([]);
      });
    }
  });
  return doc;
}

const parseDoc = load("parse.json");
suite<FormatCheck>("format.json", (c, kase) => runFormat(c, kase.values as (number | string)[] | undefined));
suite<ParseCheck>("parse.json", (c) => runParse(c, parseDoc.year));
