import { expect, test, type Page } from "@playwright/test";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument } from "pdf-lib";
import { createRequire } from "node:module";
import fs from "node:fs";

/**
 * Wave 6d — UNICODE TEXT via font embedding.
 *
 * pdf-lib's Standard-14 fonts can only encode WinAnsi (Latin-1). Text with
 * characters outside that (Cyrillic, Greek, …) used to throw / drop on export.
 * On export, buildFinalPdf now embeds a bundled Noto Sans (SIL OFL) subset via
 * fontkit ONLY for strings that aren't pure-WinAnsi; pure-ASCII/Latin-1 text
 * keeps the Standard-14 fonts (existing behavior unchanged).
 *
 * These specs place text boxes, download the baked PDF, and use a raw pdfjs
 * document (NOT react-pdf's <Page>) to extract page-1 text and prove:
 *   (a) a Cyrillic/Greek/accented string round-trips through the export, and
 *   (b) a pure-ASCII string still exports and extracts (control — no regression).
 *
 * Requires a browser. On NixOS, run within `nix develop`.
 */

// pdfjs in Node needs its worker resolved from node_modules (self-hosted).
const require = createRequire(import.meta.url);
GlobalWorkerOptions.workerSrc = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");

async function pageText(bytes: Uint8Array | Buffer, pageIndex: number): Promise<string> {
  const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const page = await pdf.getPage(pageIndex + 1);
  const tc = await page.getTextContent();
  const text = tc.items.map((i) => ("str" in i ? i.str : "")).join(" ");
  await pdf.cleanup();
  return text;
}

test.describe("PDF Editor - Unicode text embedding (Wave 6d)", () => {
  // The /editor route is auth-guarded; with no backend, UserContext would
  // redirect to SSO login. Seed the redirect-loop breaker so the editor renders.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem("lastLoginAttempt", String(Date.now()));
    });
  });

  async function newBlank(page: Page) {
    await page.goto("/editor");
    await page.getByTestId("editor-new-blank").click();
    const canvas = page.getByTestId("editor-canvas");
    await expect(canvas).toBeVisible();
    await expect(page.locator(".react-pdf__Page")).toBeVisible();
    return canvas;
  }

  async function placeText(page: Page, canvas: ReturnType<Page["getByTestId"]>, yFrac: number, value: string) {
    const b = (await canvas.boundingBox())!;
    await page.getByTestId("tool-text").click();
    await page.mouse.click(b.x + b.width * 0.2, b.y + b.height * yFrac);
    const ta = page.getByTestId("editor-textarea");
    await expect(ta).toBeVisible();
    await ta.fill(value);
    await ta.press("Escape");
  }

  async function download(page: Page): Promise<Buffer> {
    await expect(page.getByTestId("editor-download")).toBeEnabled();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("editor-download").click()]);
    return fs.promises.readFile(await dl.path());
  }

  test("(a) a Cyrillic/Greek/accented text box round-trips through the export", async ({ page }) => {
    const UNICODE = "Привет Ωμега café";
    const canvas = await newBlank(page);
    await placeText(page, canvas, 0.2, UNICODE);
    await expect(canvas.getByText(UNICODE)).toBeVisible();

    const bytes = await download(page);

    // The export produced a real, single-page PDF (did not throw).
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(1);
    expect(bytes.byteLength).toBeGreaterThan(500);

    // The embedded Noto subset carries a ToUnicode map, so pdfjs recovers the
    // original characters — proving the Unicode text really made it into the PDF.
    const text = await pageText(bytes, 0);
    expect(text).toContain("Привет");
    expect(text).toContain("Ωμега");
    expect(text).toContain("café");
  });

  test("(b) a pure-ASCII text box still exports and extracts (Standard-14, control)", async ({ page }) => {
    const ASCII = "Hello Standard Fonts";
    const canvas = await newBlank(page);
    await placeText(page, canvas, 0.2, ASCII);
    await expect(canvas.getByText(ASCII)).toBeVisible();

    const bytes = await download(page);

    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(1);
    expect(bytes.byteLength).toBeGreaterThan(500);

    const text = await pageText(bytes, 0);
    expect(text).toContain("Hello Standard Fonts");
  });
});
