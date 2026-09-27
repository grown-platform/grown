import { expect, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Checks for the PDFs Docs and Sheets build in the browser (lib/pdf): a
// minimal reader for their uncompressed structure (page sizes and the
// invisible text layer), and a pdf.js render of a page in the browser to
// prove the page picture isn't blank.

export interface PdfInfo {
  /** Page sizes in points, in page order. */
  pages: { w: number; h: number; text: string }[];
  /** Whole text layer. */
  text: string;
  producer: string;
}

function unescapeLiteral(s: string): string {
  return s.replace(/\\([0-7]{3}|.)/g, (_, c: string) => {
    if (/^[0-7]{3}$/.test(c)) return String.fromCharCode(parseInt(c, 8));
    return ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" } as Record<string, string>)[c] ?? c;
  });
}

/** readPdf reads a PDF written by lib/pdf/pdfWriter.ts. */
export function readPdf(bytes: Buffer): PdfInfo {
  const s = bytes.toString("latin1");
  expect(s.startsWith("%PDF-"), "PDF header").toBe(true);
  expect(s.trimEnd().endsWith("%%EOF"), "PDF trailer").toBe(true);
  const objAt = (n: number) => {
    const m = new RegExp(`(?:^|\\n)${n} 0 obj\\n`).exec(s);
    if (!m) throw new Error(`object ${n} missing`);
    return m.index + m[0].length;
  };
  const kids = /\/Type \/Pages \/Kids \[([^\]]*)\]/.exec(s)?.[1] ?? "";
  const pageNums = [...kids.matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
  const pages = pageNums.map((num) => {
    const at = objAt(num);
    const dict = s.slice(at, s.indexOf("endobj", at));
    const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(dict)!;
    const contents = Number(/\/Contents (\d+) 0 R/.exec(dict)![1]);
    const cAt = objAt(contents);
    const len = Number(/\/Length (\d+)/.exec(s.slice(cAt, cAt + 200))![1]);
    const start = s.indexOf("stream\n", cAt) + 7;
    const stream = s.slice(start, start + len);
    const runs = [...stream.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => unescapeLiteral(m[1]));
    return { w: Number(box[1]), h: Number(box[2]), text: runs.join(" ") };
  });
  const producerHex = /\/Producer <FEFF([0-9A-F]*)>/.exec(s)?.[1] ?? "";
  let producer = "";
  for (let i = 0; i + 4 <= producerHex.length; i += 4) producer += String.fromCharCode(parseInt(producerHex.slice(i, i + 4), 16));
  return { pages, text: pages.map((p) => p.text).join("\n"), producer };
}

const PDFJS = join(dirname(fileURLToPath(import.meta.url)), "../../app/node_modules/pdfjs-dist/build");

/**
 * renderPdfPage draws page `n` (1-based) of the PDF with pdf.js inside the
 * app's origin, saves it as a PNG (when `out` is given) and returns the
 * share of pixels that aren't white.
 */
export async function renderPdfPage(page: Page, bytes: Buffer, n = 1, out?: string): Promise<number> {
  await page.route("**/__pdfjs/*", async (route) => {
    const file = route.request().url().split("/__pdfjs/")[1].split("?")[0];
    route.fulfill({ body: await readFile(join(PDFJS, file)), contentType: "text/javascript" });
  });
  const res = await page.evaluate(
    async ({ b64, n }) => {
      const src = "/__pdfjs/pdf.min.mjs";
      const pdfjs = await import(/* @vite-ignore */ src);
      pdfjs.GlobalWorkerOptions.workerSrc = "/__pdfjs/pdf.worker.min.mjs";
      const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const doc = await pdfjs.getDocument({ data }).promise;
      const pg = await doc.getPage(n);
      const vp = pg.getViewport({ scale: 1.5 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext("2d")!;
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] < 240 || px[i + 1] < 240 || px[i + 2] < 240) ink++;
      const text = (await pg.getTextContent()).items.map((it: { str?: string }) => it.str ?? "").join(" ");
      return { png: canvas.toDataURL("image/png"), ink: ink / (px.length / 4), pages: doc.numPages, text };
    },
    { b64: bytes.toString("base64"), n },
  );
  await page.unroute("**/__pdfjs/*");
  if (out) await writeFile(out, Buffer.from(res.png.split(",")[1], "base64"));
  expect(res.text.length, "pdf.js reads a text layer").toBeGreaterThan(0);
  return res.ink;
}

/** Where rendered pages are saved for a human to look at. */
export const PDF_SHOT_DIR = process.env.GROWN_PDF_SHOTS ?? "test-results";
