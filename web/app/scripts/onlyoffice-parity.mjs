// OnlyOffice parity scoreboard (cross-cutting plan §4, milestone CC0).
//
//   npm run parity                       # table on stdout
//   npm run parity -- --md               # Markdown table (CI step summary)
//   npm run parity -- --json             # machine-readable report
//   npm run parity -- --check            # exit 1 on regression vs baseline.json
//   npm run parity -- --write-baseline   # update docs/plans/onlyoffice-parity/baseline.json
//   options: --research <dir>   (default <repo>/research/onlyoffice)
//            --vitest-json <f>  (vitest --reporter=json output)
//            --go-json <f>      (go test -json output)
//            --pw-json <f>      (Playwright json reporter output)
//
// Counting rules
// - Manifests: every docs/plans/onlyoffice-parity/*-tests.csv (six columns, see
//   the README "Manifest CSVs"). Rows are grouped by plan (CSV name) and a
//   normalised area (onlyoffice-parity-lib.mjs normalizeArea).
// - OnlyOffice denominator: the CSV test_count (many rows count runtime/table
//   cases, more than the static QUnit.test sites). When research/onlyoffice
//   exists, a live static count is shown alongside for information: `QUnit.test(`
//   (or legacy bare `test(`) in .js, `TEST(`/`TEST_F(` in .cpp, fixture
//   documents for directories.
//   Without research/ the column reads "snapshot". research/ is gitignored and
//   absent in CI; that is never an error.
// - Grown ported: DISTINCT `oo:<path>#<case>` tags found in web/app/src,
//   web/e2e, internal and pdf/frontend (node_modules/dist skipped), plus any
//   tags that only appear at runtime in the supplied result files (it.each).
//   <path> is relative to sdkjs-tests-v9.3.1/tests/. Tags map to the most
//   specific CSV row per plan (exact file, else directory/glob prefix, else
//   the same file name in a subfolder of the tag's directory). Tags
//   matching no row are listed as "unmapped" (a warning).
// - Grown passing: only with --vitest-json/--go-json/--pw-json; a tag passes if
//   a passing test's name contains it. Otherwise "n/a".
// - Exit code is non-zero only for --check with a regression (ported/passing
//   per area or total) or a malformed CSV row.
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, basename, extname } from "node:path";
import {
  parseManifest,
  extractTags,
  matchTag,
  goMangle,
  tagsFromVitestJson,
  tagsFromPlaywrightJson,
  tagsFromGoJson,
  compareBaseline,
} from "./onlyoffice-parity-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "..", "..", "..");
const PLAN_DIR = join(REPO, "docs", "plans", "onlyoffice-parity");
const BASELINE = join(PLAN_DIR, "baseline.json");
const SCAN_ROOTS = ["web/app/src", "web/e2e", "internal", "pdf/frontend"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "test-results", "playwright-report", "coverage"]);
const SCAN_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".go", ".json", ".yaml", ".yml"]);
const DOC_EXT = new Set([
  ".docx", ".doc", ".odt", ".rtf", ".xlsx", ".xlsb", ".xls", ".ods", ".csv", ".pptx",
  ".ppt", ".odp", ".epub", ".fb2", ".pdf", ".vsdx", ".txt", ".html", ".htm", ".xps", ".djvu",
]);

function parseArgs(argv) {
  const o = { research: join(REPO, "research", "onlyoffice") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v == null) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--json") o.json = true;
    else if (a === "--md") o.md = true;
    else if (a === "--check") o.check = true;
    else if (a === "--write-baseline") o.writeBaseline = true;
    else if (a === "--research") o.research = resolve(val());
    else if (a === "--vitest-json") o.vitestJson = val();
    else if (a === "--go-json") o.goJson = val();
    else if (a === "--pw-json") o.pwJson = val();
    else if (a === "-h" || a === "--help") o.help = true;
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    // Dirent.isDirectory()/isFile() are false for symlinks, so symlinked
    // node_modules/gen are skipped too.
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name), out);
    } else if (e.isFile() && SCAN_EXT.has(extname(e.name))) out.push(join(dir, e.name));
  }
  return out;
}

function scanTags() {
  const tags = new Map(); // tag -> first file (repo-relative)
  for (const root of SCAN_ROOTS) {
    for (const f of walk(join(REPO, root), [])) {
      let text;
      try {
        if (statSync(f).size > 4 * 1024 * 1024) continue;
        text = readFileSync(f, "utf8");
      } catch {
        continue;
      }
      if (!text.includes("oo:")) continue;
      for (const t of extractTags(text)) if (!tags.has(t)) tags.set(t, f.slice(REPO.length + 1));
    }
  }
  return tags;
}

/** Live static count for one row, or null when not countable / research absent. */
function liveCount(research, row) {
  const p = join(research, row.researchPath);
  if (!existsSync(p)) return null;
  try {
    const st = statSync(p);
    if (st.isDirectory()) return countDocs(p);
    const text = readFileSync(p, "utf8");
    if (p.endsWith(".js")) {
      const q = (text.match(/\bQUnit\.test\s*\(/g) || []).length;
      // legacy suites use the global test("name", fn)
      return q || (text.match(/^[ \t]*test\s*\(\s*["'`]/gm) || []).length;
    }
    if (p.endsWith(".cpp")) return (text.match(/^\s*TEST(_F)?\(/gm) || []).length;
  } catch {
    return null;
  }
  return null;
}

function countDocs(dir) {
  let n = 0;
  const rec = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) rec(join(d, e.name));
      else if (DOC_EXT.has(extname(e.name).toLowerCase())) n++;
    }
  };
  rec(dir);
  return n;
}

function loadResults(o) {
  const res = { passed: new Set(), goPassed: new Set(), seen: new Set(), goSeen: new Set(), any: false };
  if (o.vitestJson) {
    const r = tagsFromVitestJson(JSON.parse(readFileSync(o.vitestJson, "utf8")));
    r.passed.forEach((t) => res.passed.add(t));
    r.seen.forEach((t) => res.seen.add(t));
    res.any = true;
  }
  if (o.pwJson) {
    const r = tagsFromPlaywrightJson(JSON.parse(readFileSync(o.pwJson, "utf8")));
    r.passed.forEach((t) => res.passed.add(t));
    r.seen.forEach((t) => res.seen.add(t));
    res.any = true;
  }
  if (o.goJson) {
    const r = tagsFromGoJson(readFileSync(o.goJson, "utf8"));
    r.passed.forEach((t) => res.goPassed.add(t));
    r.seen.forEach((t) => res.goSeen.add(t));
    res.any = true;
  }
  return res;
}

function buildReport(o) {
  const csvs = readdirSync(PLAN_DIR).filter((f) => f.endsWith("-tests.csv")).sort();
  const rows = [];
  const errors = [];
  for (const f of csvs) {
    const r = parseManifest(readFileSync(join(PLAN_DIR, f), "utf8"), f);
    rows.push(...r.rows);
    errors.push(...r.errors);
  }
  const researchPresent = existsSync(o.research);
  const results = loadResults(o);

  // All tags: static scan plus runtime-only names from result files.
  const tagFiles = scanTags();
  const allTags = new Set(tagFiles.keys());
  const staticMangled = new Set([...allTags].map(goMangle));
  results.seen.forEach((t) => allTags.add(t));
  results.goSeen.forEach((t) => {
    if (!staticMangled.has(t)) allTags.add(t);
  });
  const isPassing = (t) => results.passed.has(t) || results.goPassed.has(goMangle(t));

  const perRow = new Map(rows.map((r) => [r, { ported: new Set(), passing: new Set() }]));
  const unmapped = [];
  const mapped = new Set();
  const passingAll = new Set();
  for (const t of [...allTags].sort()) {
    const hits = matchTag(t, rows);
    if (!hits.length) {
      unmapped.push({ tag: t, file: tagFiles.get(t) || "(result file)" });
      continue;
    }
    mapped.add(t);
    if (isPassing(t)) passingAll.add(t);
    for (const r of hits) {
      perRow.get(r).ported.add(t);
      if (isPassing(t)) perRow.get(r).passing.add(t);
    }
  }

  const areas = new Map();
  const ooByPath = new Map(); // dedupe shared rows for the grand total
  const liveByPath = new Map();
  for (const r of rows) {
    const plan = basename(r.file).replace(/-tests\.csv$/, "");
    const key = `${plan}/${r.area}`;
    const a =
      areas.get(key) ||
      { key, plan, area: r.area, rows: 0, oo: 0, portable: 0, live: researchPresent ? 0 : null, ported: 0, passing: results.any ? 0 : null };
    const live = researchPresent ? liveCount(o.research, r) : null;
    const pr = perRow.get(r);
    a.rows++;
    a.oo += r.testCount;
    if (r.portable) a.portable += r.testCount;
    if (live != null && a.live != null) {
      a.live += live;
      a.liveRows = (a.liveRows || 0) + 1;
    }
    a.ported += pr.ported.size;
    if (a.passing != null) a.passing += pr.passing.size;
    areas.set(key, a);
    ooByPath.set(r.researchPath, Math.max(ooByPath.get(r.researchPath) || 0, r.testCount));
    if (live != null) liveByPath.set(r.researchPath, live);
    r.live = live;
    r.ported = pr.ported.size;
    r.passing = results.any ? pr.passing.size : null;
  }
  for (const a of areas.values()) {
    if (a.live != null && !a.liveRows) a.live = "-";
    delete a.liveRows;
  }
  const areaList = [...areas.values()].sort((x, y) => x.key.localeCompare(y.key));
  const sum = (m) => [...m.values()].reduce((s, n) => s + n, 0);
  const total = {
    rows: rows.length,
    files: ooByPath.size,
    oo: sum(ooByPath),
    live: researchPresent ? sum(liveByPath) : null,
    ported: mapped.size,
    passing: results.any ? passingAll.size : null,
  };
  return {
    research: researchPresent ? o.research : null,
    manifests: csvs,
    errors,
    areas: areaList,
    total,
    unmapped,
    rows: rows.map((r) => ({
      manifest: r.file,
      line: r.line,
      onlyoffice_path: r.researchPath,
      area: r.area,
      portability: r.portability,
      test_count: r.testCount,
      live: r.live,
      ported: r.ported,
      passing: r.passing,
      targets: r.targets,
      milestones: r.milestones,
    })),
  };
}

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : "-");
const fmt = (v, snapshot) => (v == null ? (snapshot ? "snapshot" : "n/a") : String(v));

function tableRows(rep) {
  const snap = !rep.research;
  const head = ["Plan/area", "Rows", "OO tests (CSV)", "OO live", "Portable", "Ported", "Passing", "Ported %"];
  const body = rep.areas.map((a) => [
    a.key, String(a.rows), String(a.oo), fmt(a.live, snap), String(a.portable),
    String(a.ported), fmt(a.passing), pct(a.ported, a.oo),
  ]);
  const t = rep.total;
  body.push([
    `TOTAL (${t.files} distinct files)`, String(t.rows), String(t.oo), fmt(t.live, snap), "",
    String(t.ported), fmt(t.passing), pct(t.ported, t.oo),
  ]);
  return { head, body };
}

function renderText(rep) {
  const { head, body } = tableRows(rep);
  const w = head.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)));
  const line = (r) => r.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join("  ");
  const out = [
    `OnlyOffice parity scoreboard — OO side: ${rep.research ? `live from ${rep.research}` : "snapshot (research/ absent)"}`,
    "",
    line(head),
    w.map((n) => "-".repeat(n)).join("  "),
    ...body.slice(0, -1).map(line),
    w.map((n) => "-".repeat(n)).join("  "),
    line(body[body.length - 1]),
  ];
  return out.join("\n") + "\n" + renderWarnings(rep, "text");
}

function renderMd(rep) {
  const { head, body } = tableRows(rep);
  const esc = (s) => s.replace(/\|/g, "\\|");
  const out = [
    "## OnlyOffice parity scoreboard",
    "",
    `OnlyOffice side: ${rep.research ? "live static counts shown for information" : "snapshot (research/ absent)"}; denominator is the manifest \`test_count\`.`,
    "",
    `| ${head.join(" | ")} |`,
    `|${head.map((_, i) => (i === 0 ? "---" : "---:")).join("|")}|`,
    ...body.map((r, i) => `| ${r.map((c) => (i === body.length - 1 && c ? `**${esc(c)}**` : esc(c))).join(" | ")} |`),
  ];
  return out.join("\n") + "\n" + renderWarnings(rep, "md");
}

function renderWarnings(rep, mode) {
  const out = [];
  const bullet = mode === "md" ? "- " : "  ";
  if (rep.unmapped.length) {
    out.push("", `Warning: ${rep.unmapped.length} unmapped oo: tag(s) (no manifest row matches the path):`);
    for (const u of rep.unmapped) out.push(`${bullet}${mode === "md" ? `\`oo:${u.tag}\`` : `oo:${u.tag}`} (${u.file})`);
  }
  if (rep.errors.length) {
    out.push("", "Malformed manifest rows:");
    for (const e of rep.errors) out.push(`${bullet}${e}`);
  }
  return out.length ? out.join("\n") + "\n" : "";
}

function baselineOf(rep) {
  const areas = {};
  for (const a of rep.areas) areas[a.key] = { ported: a.ported, passing: a.passing };
  return { version: 1, areas, total: { ported: rep.total.ported, passing: rep.total.passing } };
}

function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(2);
  }
  if (o.help) {
    const src = readFileSync(fileURLToPath(import.meta.url), "utf8");
    console.log(src.split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
    return;
  }
  const rep = buildReport(o);
  if (o.json) process.stdout.write(JSON.stringify(rep, null, 2) + "\n");
  else if (o.md) process.stdout.write(renderMd(rep));
  else process.stdout.write(renderText(rep));

  if (o.writeBaseline) {
    writeFileSync(BASELINE, JSON.stringify(baselineOf(rep), null, 2) + "\n");
    console.error(`wrote ${BASELINE.slice(REPO.length + 1)}`);
  }
  if (o.check) {
    const problems = [...rep.errors];
    if (!existsSync(BASELINE)) problems.push(`missing ${BASELINE.slice(REPO.length + 1)} (run --write-baseline)`);
    else problems.push(...compareBaseline(baselineOf(rep), JSON.parse(readFileSync(BASELINE, "utf8"))));
    if (problems.length) {
      console.error("parity check FAILED:\n  " + problems.join("\n  "));
      console.error("If a drop is intended (e.g. an area was renamed), re-run with --write-baseline.");
      process.exit(1);
    }
    console.error("parity check OK (no regression vs baseline.json)");
  }
}

main();
