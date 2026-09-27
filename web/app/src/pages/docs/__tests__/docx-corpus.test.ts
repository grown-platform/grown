// Local-only corpus run for the direct DOCX reader/writer (Docs M6).
//
// Walks GROWN_CONVERSION_CORPUS (the same variable CC2's Go corpus runner
// uses) for .docx files and runs each through
//   docx -> Grown -> docx -> Grown
// checking that the import succeeds, keeps the source's words, that the
// export is a well-formed package, and that the second import equals the
// first (model equality). Skipped when the variable is unset (CI); the
// files are never committed. Prints a pass rate:
//
//   GROWN_CONVERSION_CORPUS=$PWD/research/onlyoffice/core npx vitest run docx-corpus
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import JSZip from "jszip";
import { Editor } from "@tiptap/core";
import { buildExtensions } from "../extensions";
import { readDocx } from "../docx/read";
import { writeDocx } from "../docx/write";
import { applyDocxImport, collectDocxInput } from "../docx/apply";
import { getDocModel } from "../docModel";
import { parseXml } from "../docx/xml";


const root = process.env.GROWN_CONVERSION_CORPUS;

function findDocx(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = nodePath.join(dir, e.name);
    if (e.isDirectory()) findDocx(p, out);
    else if (/\.docx$/i.test(e.name) && fs.statSync(p).size < 32 << 20) out.push(p);
  }
  return out;
}

function editorFor() {
  const element = document.createElement("div");
  return new Editor({ element, extensions: buildExtensions({ collab: false }) });
}

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

async function sourceWords(bytes: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return [];
  // Runs split words ("20" + "22"), so join a paragraph's text first.
  // (String scanning: jsdom's live collections are too slow for books.)
  return xml
    .split(/<\/w:p>/)
    .map((para) =>
      [...para.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(?:br|tab|cr)\b[^>]*\/>/g)].map((m) => m[1] ?? " ").join(""),
    )
    .flatMap((t) => words(t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(x?)([0-9a-f]+);/gi, (_, x: string, n: string) => String.fromCodePoint(parseInt(n, x ? 16 : 10))).replace(/&amp;/g, "&")));
}

/** Deep equality without vitest's diffing (fast on book-sized models). */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function modelOf(editor: Editor) {
  const { sheet, numbering } = getDocModel(editor);
  return { doc: editor.getJSON(), styles: sheet.map.toJSON(), numbering: numbering.map.toJSON() };
}

describe.skipIf(!root)("docx corpus (GROWN_CONVERSION_CORPUS)", () => {
  it("round-trips every .docx in the corpus", async () => {
    const files = findDocx(root!);
    const failures: string[] = [];
    const notDocs: string[] = [];
    for (const f of files) {
      const rel = nodePath.relative(root!, f);
      const editors: Editor[] = [];
      try {
        const bytes = new Uint8Array(fs.readFileSync(f));
        const imp = await readDocx(bytes);
        const a = editorFor();
        editors.push(a);
        applyDocxImport(a, imp);
        const src = await sourceWords(bytes);
        const got = new Set(words(a.state.doc.textBetween(0, a.state.doc.content.size, " ", " ")));
        const missing = src.filter((w) => !got.has(w));
        if (src.length && missing.length / src.length > 0.02)
          throw new Error(`lost ${missing.length}/${src.length} words (e.g. ${missing.slice(0, 5).join(", ")})`);
        const input = collectDocxInput(a, { title: rel });
        input.comments = imp.comments;
        input.now = new Date(0);
        const out = await writeDocx(input);
        const zip = await JSZip.loadAsync(out);
        for (const name of Object.keys(zip.files)) if (/\.(xml|rels)$/.test(name)) parseXml(await zip.file(name)!.async("string"));
        const imp2 = await readDocx(out);
        const b = editorFor();
        editors.push(b);
        applyDocxImport(b, imp2);
        if (!same(modelOf(b), modelOf(a))) throw new Error("second import differs from the first");
        console.log(`ok   ${rel} (${src.length} words${imp.warnings.length ? `; dropped: ${imp.warnings.join(", ")}` : ""})`);
      } catch (e) {
        if (/no main document part/.test(String(e))) {
          // A .docx-named package without a document (e.g. a template
          // fragment): correctly refused, not counted.
          notDocs.push(rel);
          console.log(`n/a  ${rel}: no main document part`);
          continue;
        }
        failures.push(`${rel}: ${String((e as Error).message).split("\n")[0]}`);
        console.log(`FAIL ${rel}: ${String((e as Error).message).slice(0, 300)}`);
      } finally {
        for (const e of editors) e.destroy();
      }
    }
    const total = files.length - notDocs.length;
    const passed = total - failures.length;
    console.log(
      `docx corpus: ${passed}/${total} passed (${total ? Math.round((passed / total) * 100) : 100} %)` +
        (notDocs.length ? `; ${notDocs.length} not a document` : ""),
    );
    expect(failures).toEqual([]);
  }, 600_000);
});
