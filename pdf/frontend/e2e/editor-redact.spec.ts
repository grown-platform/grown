import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Wave 5b — TRUE REDACTION. Unlike whiteout (which merely covers), a redaction
 * mark flattens its whole page to a raster image on export, DESTROYING the
 * underlying text/vector layer. We prove genuine removal by extracting the
 * exported page's text with pdfjs and asserting the redacted word (and the
 * page's text layer) is gone — a covered-but-present text layer would still
 * extract, so this only passes when the text is truly rasterized away.
 *
 * Non-redacted pages stay vector, so their text layer must survive.
 *
 * Requires a browser. On NixOS, run within `nix develop`.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_PDF = path.resolve(__dirname, "../../test/pdfs/sample-contract.pdf");
const MULTI_PDF = path.resolve(__dirname, "../../test/pdfs/multi-party-agreement.pdf");

// pdfjs in Node needs its worker resolved from node_modules (self-hosted).
const require = createRequire(import.meta.url);
GlobalWorkerOptions.workerSrc = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");

// Extract the concatenated text of a single (0-based) page via pdfjs. A fresh
// byte copy is passed each call because pdfjs detaches the buffer it's given.
async function pageText(bytes: Uint8Array | Buffer, pageIndex: number): Promise<string> {
  const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const page = await pdf.getPage(pageIndex + 1);
  const tc = await page.getTextContent();
  const text = tc.items.map((i) => ("str" in i ? i.str : "")).join(" ");
  await pdf.cleanup();
  return text;
}

test.describe("PDF Editor - true redaction (Wave 5b)", () => {
  // The /editor route is auth-guarded; seed the redirect-loop breaker so the
  // editor renders without a backend.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem("lastLoginAttempt", String(Date.now()));
    });
  });

  async function loadPdf(page: Page, file: string) {
    await page.goto("/editor");
    await page.getByTestId("editor-file-input").setInputFiles(file);
    const canvas = page.getByTestId("editor-canvas");
    await expect(canvas).toBeVisible();
    await expect(page.locator(".react-pdf__Page")).toBeVisible();
    return { canvas, box: () => canvas.boundingBox().then((b) => b!) };
  }

  // Drag a rectangle in normalized page coords with the given tool.
  async function dragRect(
    page: Page,
    box: () => Promise<{ x: number; y: number; width: number; height: number }>,
    toolId: string,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ) {
    await page.getByTestId(toolId).click();
    const b = await box();
    await page.mouse.move(b.x + b.width * x0, b.y + b.height * y0);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * x1, b.y + b.height * y1, { steps: 12 });
    await page.mouse.up();
  }

  async function download(page: Page): Promise<Uint8Array> {
    const [dl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("editor-download").click(),
    ]);
    return new Uint8Array(await fs.promises.readFile(await dl.path()));
  }

  test("(a) redaction rasterizes the page and removes the underlying text", async ({ page }) => {
    // The source PDF really contains the word we will redact.
    const sourceBytes = await fs.promises.readFile(CONTRACT_PDF);
    const srcText = await pageText(sourceBytes, 0);
    expect(srcText).toContain("Agreement");
    expect(srcText).toContain("Party");

    const { box } = await loadPdf(page, CONTRACT_PDF);

    // Draw a redaction mark over (essentially) the whole page.
    await dragRect(page, box, "tool-redact", 0.03, 0.03, 0.97, 0.97);
    await expect(page.locator('[data-annot-kind="redact"]')).toHaveCount(1);
    // The export-time flatten notice appears once a redaction exists.
    await expect(page.getByTestId("redact-notice")).toBeVisible();

    await page.getByTestId("editor-docname").fill("redacted-contract");
    const outBytes = await download(page);

    // Page count is preserved…
    const out = await PDFDocument.load(outBytes);
    expect(out.getPageCount()).toBe(1);

    // …but the page is now a raster image with NO text layer: the redacted
    // word — and all page text — is genuinely gone (not merely covered).
    const outText = (await pageText(outBytes, 0)).trim();
    expect(outText).not.toContain("Agreement");
    expect(outText).not.toContain("Party");
    expect(outText).toBe("");
  });

  test("(b) only redacted pages are rasterized; other pages keep their text", async ({ page }) => {
    const sourceBytes = await fs.promises.readFile(MULTI_PDF);
    const src0 = await pageText(sourceBytes, 0);
    const src1 = await pageText(sourceBytes, 1);
    expect(src0).toContain("Multi-Party");
    expect(src1).toContain("Signatures");

    const { box } = await loadPdf(page, MULTI_PDF);
    await expect(page.getByTestId("editor-page-indicator")).toHaveText("1 / 2");

    // Redact page 1 only (a partial mark still flattens the whole page).
    await dragRect(page, box, "tool-redact", 0.1, 0.1, 0.9, 0.5);
    await expect(page.locator('[data-annot-kind="redact"]')).toHaveCount(1);

    await page.getByTestId("editor-docname").fill("redacted-multi");
    const outBytes = await download(page);

    const out = await PDFDocument.load(outBytes);
    expect(out.getPageCount()).toBe(2);

    // Page 1: rasterized → text destroyed.
    const p0 = (await pageText(outBytes, 0)).trim();
    expect(p0).not.toContain("Multi-Party");
    expect(p0).toBe("");

    // Page 2: untouched vector page → its text layer survives intact.
    const p1 = await pageText(outBytes, 1);
    expect(p1).toContain("Signatures");
    expect(p1).toContain("PARTY");
  });
});
