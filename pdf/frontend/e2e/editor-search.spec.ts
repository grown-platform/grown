import { expect, test, type Page } from "@playwright/test";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Wave 5d — TEXT SEARCH / FIND across pages. A read-only viewer feature: the
 * editor extracts every page's text with a raw pdfjs document (NOT react-pdf's
 * <Page>, so no extra .react-pdf__Page DOM), substring-matches the query, draws
 * highlight boxes over matches on the current page, and lets you cycle matches
 * across all pages.
 *
 * Data hooks (added in EditorPage.tsx):
 *   - editor-search-open   toggle button (also Ctrl/Cmd+F)
 *   - search-bar           the revealed find bar container
 *   - editor-search-input  the query input
 *   - search-count         "<active> / <total>" (or "0 / 0" when none)
 *   - search-prev / search-next / search-close / search-case  controls
 *   - search-highlights    the per-page highlight overlay container
 *   - search-hit           one per match on the current page
 *   - search-hit-active    the emphasized active match (when on this page)
 *
 * Requires a browser. On NixOS, run within `nix develop`.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_PDF = path.resolve(__dirname, "../../test/pdfs/sample-contract.pdf");

// pdfjs in Node needs its worker resolved from node_modules (self-hosted).
const require = createRequire(import.meta.url);
GlobalWorkerOptions.workerSrc = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");

// Extract page-0 text so the test picks a query the PDF really contains.
async function pageText(bytes: Uint8Array | Buffer, pageIndex: number): Promise<string> {
  const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const page = await pdf.getPage(pageIndex + 1);
  const tc = await page.getTextContent();
  const text = tc.items.map((i) => ("str" in i ? i.str : "")).join(" ");
  await pdf.cleanup();
  return text;
}

test.describe("PDF Editor - text search (Wave 5d)", () => {
  // The /editor route is auth-guarded; with no backend, UserContext would
  // redirect to SSO login. Seed the redirect-loop breaker so the editor renders.
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
    return canvas;
  }

  test("(a) finds a real word, highlights it, and navigates matches", async ({ page }) => {
    // The source PDF really contains the word we will search for.
    const sourceBytes = await fs.promises.readFile(CONTRACT_PDF);
    const srcText = await pageText(sourceBytes, 0);
    expect(srcText).toContain("Agreement");

    await loadPdf(page, CONTRACT_PDF);

    // Open the find bar (via the toggle button) and type a known word.
    await page.getByTestId("editor-search-open").click();
    await expect(page.getByTestId("search-bar")).toBeVisible();
    await page.getByTestId("editor-search-input").fill("Agreement");

    // Matches appear: the counter shows a positive total and highlight boxes
    // are drawn on the page (the raw-pdfjs extraction adds no extra pages).
    await expect(page.getByTestId("search-count")).not.toHaveText("0 / 0", { timeout: 10_000 });
    const count = page.getByTestId("search-count");
    const total = Number((await count.textContent())!.split("/")[1].trim());
    expect(total).toBeGreaterThanOrEqual(1);

    await expect(page.getByTestId("search-hit").first()).toBeVisible();
    expect(await page.getByTestId("search-hit").count()).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("search-hit-active")).toBeVisible();

    // The counter starts at match 1.
    await expect(count).toHaveText(`1 / ${total}`);

    // Next advances the active index (wraps to 1 when there is a single match).
    await page.getByTestId("search-next").click();
    const expectedNext = total > 1 ? 2 : 1;
    await expect(count).toHaveText(`${expectedNext} / ${total}`);

    // Prev moves back.
    await page.getByTestId("search-prev").click();
    await expect(count).toHaveText(`1 / ${total}`);

    // Only one .react-pdf__Page node exists — text extraction used raw pdfjs.
    expect(await page.locator(".react-pdf__Page").count()).toBe(1);
  });

  test("(b) a nonsense query yields zero matches and no highlights", async ({ page }) => {
    await loadPdf(page, CONTRACT_PDF);

    await page.getByTestId("editor-search-open").click();
    await page.getByTestId("editor-search-input").fill("zzxqwvnotpresent");

    // Count shows zero and no highlight overlays are drawn.
    await expect(page.getByTestId("search-count")).toHaveText("0 / 0");
    await expect(page.getByTestId("search-hit")).toHaveCount(0);
    await expect(page.getByTestId("search-highlights")).toHaveCount(0);
  });

  test("(c) Ctrl+F opens the find bar and Escape closes it", async ({ page }) => {
    await loadPdf(page, CONTRACT_PDF);

    await page.locator("body").click();
    await page.keyboard.press("Control+f");
    await expect(page.getByTestId("search-bar")).toBeVisible();
    await expect(page.getByTestId("editor-search-input")).toBeFocused();

    await page.getByTestId("editor-search-input").fill("Agreement");
    await expect(page.getByTestId("search-count")).not.toHaveText("0 / 0", { timeout: 10_000 });

    // Escape from the input closes the bar and clears results.
    await page.getByTestId("editor-search-input").press("Escape");
    await expect(page.getByTestId("search-bar")).toHaveCount(0);
    await expect(page.getByTestId("search-hit")).toHaveCount(0);
  });
});
