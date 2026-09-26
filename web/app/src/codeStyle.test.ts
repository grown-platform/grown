// @vitest-environment node
// Portable subset of OnlyOffice's tests/code-style/check.py, applied to the
// web app sources: LF line endings and a final newline (see /.editorconfig).
// Its other two checks (AGPL licence header, vendor address) don't apply.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP = fileURLToPath(new URL("..", import.meta.url));
const EXT = /\.(?:[cm]?[jt]sx?|css|html|json)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.test(e.name)) out.push(p);
  }
  return out;
}

const files = ["src", "scripts"].flatMap((d) => walk(join(APP, d)));

describe("code style", () => {
  it("oo:code-style/check.py#check_file_without_lf_ending", () => {
    const crlf = files.filter((f: string) => readFileSync(f).includes(13));
    expect(crlf.map((f: string) => relative(APP, f))).toEqual([]);
  });

  it("oo:code-style/check.py#check_file_without_newline", () => {
    const bad = files.filter((f: string) => {
      const b = readFileSync(f);
      return b.length > 0 && b[b.length - 1] !== 10;
    });
    expect(bad.map((f: string) => relative(APP, f))).toEqual([]);
  });
});
