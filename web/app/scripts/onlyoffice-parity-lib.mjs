// Pure helpers for the OnlyOffice parity scoreboard (onlyoffice-parity.mjs).
// No filesystem access here, so everything is unit-testable
// (see onlyoffice-parity.test.mjs). Plain ESM, zero dependencies.

export const TESTS_ROOT = "sdkjs-tests-v9.3.1/tests/";
export const CSV_COLUMNS = [
  "onlyoffice_path",
  "test_count",
  "area",
  "portability",
  "target_grown_path",
  "milestone",
];

// ---------------------------------------------------------------- CSV

/** RFC-4180-ish CSV: quoted fields, "" escapes, commas/newlines inside quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let lineNo = 1;
  let rowLine = 1;
  const pushRow = () => {
    row.push(field);
    field = "";
    if (!(row.length === 1 && row[0].trim() === "")) rows.push({ line: rowLine, fields: row });
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else {
        if (c === "\n") lineNo++;
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      // swallow; \n ends the row
    } else if (c === "\n") {
      pushRow();
      lineNo++;
      rowLine = lineNo;
    } else field += c;
  }
  if (field !== "" || row.length) pushRow();
  return rows;
}

/**
 * Parse a manifest CSV into normalised rows. Returns {rows, errors}; a row with
 * the wrong column count, empty path or non-integer test_count is an error.
 */
export function parseManifest(text, file = "manifest.csv") {
  const records = parseCsv(text);
  const errors = [];
  const rows = [];
  if (!records.length) return { rows, errors: [`${file}: empty`] };
  const header = records[0].fields.map((h) => h.trim());
  if (header.join(",") !== CSV_COLUMNS.join(",")) {
    errors.push(`${file}:1: header must be ${CSV_COLUMNS.join(",")}`);
    return { rows, errors };
  }
  for (const { line, fields } of records.slice(1)) {
    if (fields.length !== CSV_COLUMNS.length) {
      errors.push(`${file}:${line}: expected ${CSV_COLUMNS.length} fields, got ${fields.length}`);
      continue;
    }
    const [path, count, area, portability, target, milestone] = fields.map((f) => f.trim());
    if (!path) {
      errors.push(`${file}:${line}: empty onlyoffice_path`);
      continue;
    }
    if (!/^\d+$/.test(count)) {
      errors.push(`${file}:${line}: test_count ${JSON.stringify(count)} is not a non-negative integer`);
      continue;
    }
    const researchPath = normalizeResearchPath(path);
    const port = normalizePortability(portability);
    rows.push({
      file,
      line,
      onlyofficePath: path,
      researchPath,
      testsPath: testsRelative(researchPath),
      testCount: Number(count),
      areaRaw: area,
      area: normalizeArea(area),
      portability: port.value,
      portable: port.portable,
      naCount: port.portable ? Math.min(naCount(portability), Number(count)) : 0,
      targets: splitTargets(target),
      milestones: parseMilestones(milestone),
    });
  }
  return { rows, errors };
}

/** Plans spell onlyoffice_path several ways; make it relative to research/onlyoffice/. */
export function normalizeResearchPath(p) {
  let s = p.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  s = s.replace(/^research\/onlyoffice\//, "");
  if (s.startsWith("tests/")) s = "sdkjs-tests-v9.3.1/" + s;
  return s.replace(/\/+$/, "");
}

/** Path relative to sdkjs-tests-v9.3.1/tests/ (the tag namespace), or null. */
export function testsRelative(researchPath) {
  return researchPath.startsWith(TESTS_ROOT) ? researchPath.slice(TESTS_ROOT.length) : null;
}

const NOT_PORTABLE = new Set(["none", "n/a", "na", "helper", "-", ""]);

/**
 * Key portability on its first word, case-insensitively:
 * "High (as key-map table)" -> high, "n/a (harness)" -> n/a, "go (28) + n/a" -> go.
 * Editor plans use harness names (vitest/go/playwright/mixed); those count as portable.
 */
export function normalizePortability(s) {
  const first = (s || "").trim().toLowerCase().split(/[\s(]/)[0].replace(/[,;:]+$/, "");
  const value = first === "na" ? "n/a" : first || "-";
  return { value, portable: !NOT_PORTABLE.has(value) };
}

/**
 * Cases of a mixed row that are not portable, from its portability note:
 * the sum of every "<n> n/a" ("mixed (4 vitest / 1 n/a ParaId)" -> 1).
 * They leave the row's portable count; the rest of the row stays portable.
 */
export function naCount(s) {
  let n = 0;
  for (const m of (s || "").matchAll(/(\d+)\s*n\/a\b/gi)) n += Number(m[1]);
  return n;
}

/**
 * Areas are free text; group on a short key: text before the first
 * " (", ":", ";", " + ", then before the first "/" (sheets uses
 * "formulas/math-trig" etc.), trimmed and lower-cased.
 */
export function normalizeArea(s) {
  let a = (s || "").trim();
  for (const sep of [" (", ":", ";", " + "]) {
    const i = a.indexOf(sep);
    if (i > 0) a = a.slice(0, i);
  }
  const slash = a.indexOf("/");
  if (slash > 0) a = a.slice(0, slash);
  a = a.trim().toLowerCase();
  return a || "(none)";
}

/** target_grown_path: ";"-separated (or comma list), trailing "(note)" dropped, "-" = none. */
export function splitTargets(s) {
  return (s || "")
    .split(/[;,]/)
    .map((t) => t.replace(/\s*\(.*\)\s*$/, "").trim())
    .filter((t) => t && t !== "-");
}

/** "M0 (14) + M1 (3)" -> ["M0","M1"]; "exception" kept; "-"/"none" -> []. */
export function parseMilestones(s) {
  const out = [];
  for (const m of (s || "").matchAll(/\b(M\d+|CC\d+|exception)\b/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

// ---------------------------------------------------------------- tags

// oo:<path>#<case>; <path> has no whitespace/quotes/#; <case> ends at a
// closing quote, backtick, "]" or end of line.
const TAG_RE = /\boo:([^\s#"'`\]]+)#([^"'`\]\r\n]*)/g;

/** Extract distinct tags ("path#case") from source text. */
export function extractTags(text) {
  const out = new Set();
  for (const m of text.matchAll(TAG_RE)) {
    const path = m[1].replace(/^\.\//, "");
    const kase = m[2].trim();
    if (!kase) continue;
    out.add(`${path}#${kase}`);
  }
  return [...out];
}

export function splitTag(tag) {
  const i = tag.indexOf("#");
  return { path: tag.slice(0, i), kase: tag.slice(i + 1) };
}

/** `go test` rewrites subtest names (spaces -> "_"); compare in that form. */
export function goMangle(tag) {
  return tag.replace(/\s/g, "_");
}

function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$");
}

/**
 * How specifically `rowPath` (a manifest path) covers `tagPath`. 0 = no match.
 * Exact file > directory prefix (deeper = better) > glob > same file name
 * in a subfolder of the tag's directory.
 */
export function matchScore(rowPath, tagPath) {
  if (!rowPath) return 0;
  if (rowPath === tagPath) return 1e6;
  if (/[*?]/.test(rowPath)) {
    const re = globToRegExp(rowPath);
    if (re.test(tagPath)) return 1000 + rowPath.length;
    // glob on a directory: allow files below a matching dir
    const dir = rowPath.replace(/\/[^/]*$/, "");
    if (!/[*?]/.test(dir) && tagPath.startsWith(dir + "/")) return 500 + dir.length;
    return 0;
  }
  if (tagPath.startsWith(rowPath + "/")) return 2000 + rowPath.length;
  // Tag names the file but skips intermediate folders, e.g.
  // cell/spreadsheet-calculation/FormulaTests.js for the row
  // cell/spreadsheet-calculation/formula-tests/FormulaTests.js.
  const cut = (p) => {
    const i = p.lastIndexOf("/");
    return [i < 0 ? "" : p.slice(0, i), p.slice(i + 1)];
  };
  const [rowDir, rowBase] = cut(rowPath);
  const [tagDir, tagBase] = cut(tagPath);
  if (rowBase === tagBase && tagDir && rowDir.startsWith(tagDir + "/")) return 100 + tagDir.length;
  return 0;
}

/**
 * Map a tag to its best row in each manifest (a file can be listed by several
 * plans, e.g. color-mods.js in common + slides). Tag paths are relative to
 * sdkjs-tests-v9.3.1/tests/; as a fallback a tag may use the full
 * research-relative path (for sdkjs/… or core/… rows).
 */
export function matchTag(tag, rows) {
  const { path } = splitTag(tag);
  const best = new Map(); // manifest file -> {row, score}
  for (const row of rows) {
    const score = Math.max(
      matchScore(row.testsPath, path),
      matchScore(row.researchPath, path),
    );
    if (!score) continue;
    const cur = best.get(row.file);
    if (!cur || score > cur.score) best.set(row.file, { row, score });
  }
  return [...best.values()].map((b) => b.row);
}

// ---------------------------------------------------------------- results

/** Tag names from vitest --reporter=json that passed / all seen. */
export function tagsFromVitestJson(json) {
  const passed = new Set();
  const seen = new Set();
  for (const file of json?.testResults || []) {
    for (const a of file.assertionResults || []) {
      const name = [a.fullName, a.title, ...(a.ancestorTitles || [])].filter(Boolean).join(" ");
      for (const t of extractTags(name)) {
        seen.add(t);
        if (a.status === "passed") passed.add(t);
      }
    }
  }
  return { passed, seen };
}

/** Playwright json reporter: suites[].specs[] (nested suites). */
export function tagsFromPlaywrightJson(json) {
  const passed = new Set();
  const seen = new Set();
  const walk = (suite, titles) => {
    const t2 = suite.title ? [...titles, suite.title] : titles;
    for (const spec of suite.specs || []) {
      for (const t of extractTags([...t2, spec.title].join(" "))) {
        seen.add(t);
        if (spec.ok) passed.add(t);
      }
    }
    for (const s of suite.suites || []) walk(s, t2);
  };
  for (const s of json?.suites || []) walk(s, []);
  return { passed, seen };
}

/** `go test -json` output (newline-delimited events). Tags stay go-mangled. */
export function tagsFromGoJson(text) {
  const passed = new Set();
  const seen = new Set();
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (!ev.Test || !ev.Action) continue;
    for (const t of extractTags(ev.Test)) {
      const m = goMangle(t);
      seen.add(m);
      if (ev.Action === "pass") passed.add(m);
      if (ev.Action === "fail") passed.delete(m);
    }
  }
  return { passed, seen, mangled: true };
}

// ---------------------------------------------------------------- baseline

/**
 * Compare a report's {areas, total} to a baseline; returns regression messages.
 * `passing` is compared only when both sides have a number.
 */
export function compareBaseline(current, baseline) {
  const msgs = [];
  const cmp = (key, cur, base) => {
    if (!base) return;
    const c = cur || { ported: 0, passing: null };
    if (c.ported < base.ported) msgs.push(`${key}: ported ${base.ported} -> ${c.ported}`);
    if (base.passing != null && c.passing != null && c.passing < base.passing)
      msgs.push(`${key}: passing ${base.passing} -> ${c.passing}`);
  };
  for (const [key, base] of Object.entries(baseline?.areas || {})) cmp(key, current.areas[key], base);
  cmp("TOTAL", current.total, baseline?.total);
  return msgs;
}
