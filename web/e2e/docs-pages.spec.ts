import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { BASE_URL, createDoc, trashDoc } from "./helpers";
import { openDoc } from "./docs/helpers";

// Docs M9: page layout, sections and pagination. A long document breaks
// into pages (split paragraphs, a table with a repeated header row), page
// numbers in the footer, a landscape section in two columns, a table of
// contents with exact page numbers, all after a reload and through a
// .docx download and re-import.

const SHOTS = process.env.DOCS_M9_SHOTS;
const editor = (page: Page) => page.locator(".ProseMirror:not(.margin-editor .ProseMirror)").first();

const LOREM = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ";

function longHtml(): string {
  let html = "<p></p><h1>Introduction</h1>";
  for (let i = 0; i < 14; i++) html += `<p>Intro ${i}. ${LOREM.repeat(2)}</p>`;
  html += "<h1>Methods</h1>";
  for (let i = 0; i < 14; i++) html += `<p>Method ${i}. ${LOREM.repeat(2)}</p>`;
  html += "<h2>Data</h2><table><tbody>";
  for (let i = 0; i < 26; i++) html += `<tr${i === 0 ? " data-repeat-header" : ""}><td><p>${i ? `Row ${i}` : "Item"}</p></td><td><p>${i ? i * 7 : "Value"}</p></td></tr>`;
  html += "</tbody></table>";
  html += "<h1>Wide appendix</h1>";
  for (let i = 0; i < 10; i++) html += `<p>Appendix ${i}. ${LOREM}</p>`;
  return html;
}

async function paste(page: Page, html: string) {
  await editor(page).click();
  await page.evaluate((h) => {
    const dt = new DataTransfer();
    dt.setData("text/html", h);
    dt.setData("text/plain", "x");
    document
      .querySelector(".ProseMirror")!
      .dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, html);
}

const pageCount = (page: Page) => page.locator(".doc-pages .doc-page").count();

/** The (1-based) page whose sheet holds an element's top. */
async function pageOf(page: Page, selector: string, text: string): Promise<number> {
  return page.evaluate(
    ([sel, t]) => {
      const el = Array.from(document.querySelectorAll(sel)).find((x) => x.textContent?.trim() === t) as HTMLElement | undefined;
      if (!el) return -1;
      const y = el.getBoundingClientRect().top + 2;
      const pages = Array.from(document.querySelectorAll(".doc-pages .doc-page")) as HTMLElement[];
      const i = pages.findIndex((p) => {
        const r = p.getBoundingClientRect();
        return y >= r.top && y < r.bottom;
      });
      return i + 1;
    },
    [selector, text] as const,
  );
}

async function layoutMenu(page: Page, testid: string) {
  await page.getByTestId("menu-layout").click();
  await page.getByTestId(testid).click();
  await page.waitForTimeout(300);
}

test.describe.serial("docs pages (M9)", () => {
  test("pagination, footer page numbers, landscape columns, exact TOC, reload, docx", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const ids: string[] = [];
    const id = await createDoc(page.request, "e2e pages");
    ids.push(id);
    try {
      await openDoc(page, id);
      await paste(page, longHtml());
      await expect(page.getByTestId("doc-editor")).toHaveAttribute("data-paged", "true");
      await expect.poll(() => pageCount(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(4);

      // The table breaks across pages and repeats its header row.
      await expect(editor(page).locator("tr.pg-repeat").first()).toBeAttached();
      await expect(editor(page).locator("tr.pg-repeat td").first()).toHaveText("Item");
      // Nothing of the text body sits in a page gap: every paragraph line
      // box is inside some page's text area.
      const outside = await page.evaluate(() => {
        const pages = Array.from(document.querySelectorAll(".doc-pages .doc-page")).map((p) => p.getBoundingClientRect());
        const bad: string[] = [];
        document.querySelectorAll(".ProseMirror:not(.margin-editor .ProseMirror) p").forEach((p) => {
          // Text only (our spacer spans do cross page gaps).
          const walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
          const rects: DOMRect[] = [];
          for (let n = walk.nextNode(); n; n = walk.nextNode()) {
            const range = document.createRange();
            range.selectNodeContents(n);
            rects.push(...Array.from(range.getClientRects()));
          }
          for (const r of rects) {
            if (r.height < 1) continue;
            if (!pages.some((pg) => r.top >= pg.top + 40 && r.bottom <= pg.bottom - 40)) {
              bad.push(`${Math.round(r.top)}-${Math.round(r.bottom)} ${p.textContent?.slice(0, 30)} pages ${JSON.stringify(pages.map((x) => [Math.round(x.top), Math.round(x.bottom)]))}`);
            }
          }
        });
        return bad;
      });
      expect(outside).toEqual([]);

      // Page numbers in the footer: "Page X of Y", centred.
      await page.getByRole("button", { name: "Insert", exact: true }).first().click();
      await page.getByTestId("insert-page-numbers").click();
      await page.getByTestId("pn-center").click();
      await page.getByTestId("pn-of-total").click();
      await page.getByTestId("pn-ok").click();
      const footer2 = page.locator('.doc-hf--footer[data-page="2"]');
      await expect(footer2).toContainText("Page");
      await expect(footer2.locator('.hf-field[data-field="PAGE"]')).toHaveCount(1);
      await expect(footer2).toHaveCSS("counter-reset", /hfpage 2 hfpages \d+/);
      // A header typed on page 1 shows on every page.
      await page.locator(".doc-header-region .ProseMirror").click();
      await page.keyboard.type("Quarterly report");
      await expect(page.locator('.doc-hf--header[data-page="3"]')).toContainText("Quarterly report");

      // A landscape section in two columns from "Wide appendix" on.
      await editor(page).locator("h1", { hasText: "Wide appendix" }).click({ position: { x: 1, y: 8 } });
      await page.keyboard.press("Home");
      await page.waitForTimeout(100);
      await layoutMenu(page, "layout-break-nextPage");
      await layoutMenu(page, "layout-landscape");
      await layoutMenu(page, "layout-columns-two");
      await expect(page.locator('.doc-pages .doc-page[data-orient="landscape"]').first()).toBeAttached();
      await expect(editor(page).locator(".pg-shift").first()).toBeAttached();
      const portrait = await page.locator('.doc-pages .doc-page[data-orient="portrait"]').count();
      expect(portrait).toBeGreaterThanOrEqual(3);

      // A table of contents at the top with exact page numbers.
      await editor(page).locator("p").first().click();
      await page.keyboard.press("Control+Home");
      await page.waitForTimeout(100);
      await page.getByRole("button", { name: "References", exact: true }).click();
      await page.getByTestId("ref-insert-toc").click();
      await page.waitForTimeout(1500);
      const checkToc = async () => {
        await expect(editor(page).locator(".doc-toc-entry")).toHaveCount(4);
        for (const h of ["Introduction", "Methods", "Wide appendix"]) {
          const want = await pageOf(page, ".ProseMirror:not(.margin-editor .ProseMirror) > h1", h);
          expect(want).toBeGreaterThan(0);
          const got = await page.evaluate((title) => {
            const rows = Array.from(document.querySelectorAll(".ProseMirror .doc-toc-entry")) as HTMLElement[];
            const row = rows.find((r) => r.textContent?.includes(title));
            return row?.getAttribute("data-page") ?? null;
          }, h);
          expect(got, `TOC page of ${h}`).toBe(String(want));
        }
      };
      await checkToc();
      if (SHOTS) {
        await page.getByTestId("status-zoom").scrollIntoViewIfNeeded().catch(() => {});
        await page.locator(".doc-pages .doc-page").first().scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${SHOTS}/docs-m9-toc-page1.png` });
        await page.locator('.doc-hf--footer[data-page="2"]').scrollIntoViewIfNeeded();
        await page.mouse.wheel(0, 300);
        await page.screenshot({ path: `${SHOTS}/docs-m9-page-break-footer.png` });
        await page.locator('.doc-pages .doc-page[data-orient="landscape"]').first().scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${SHOTS}/docs-m9-landscape-columns.png` });
        await page.setViewportSize({ width: 1400, height: 900 });
        await page.getByTestId("status-zoom").click();
        await page.getByRole("option", { name: "50%", exact: true }).click();
        await page.waitForTimeout(400);
        await page.locator(".doc-pages .doc-page").nth(2).scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${SHOTS}/docs-m9-overview-50.png` });
        await page.locator('.doc-pages .doc-page[data-orient="landscape"]').first().scrollIntoViewIfNeeded();
        await page.mouse.wheel(0, -250);
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${SHOTS}/docs-m9-sections-50.png` });
        await page.getByTestId("status-zoom").click();
        await page.getByRole("option", { name: "100%", exact: true }).click();
      }
      const pages = await pageCount(page);
      await expect(page.getByTestId("status-page")).toContainText(`of ${pages}`);

      // Reload: sections, footer and TOC are all in the document.
      await page.waitForTimeout(1000);
      await openDoc(page, id);
      await expect.poll(() => pageCount(page), { timeout: 10_000 }).toBe(pages);
      await expect(page.locator('.doc-pages .doc-page[data-orient="landscape"]').first()).toBeAttached();
      await expect(page.locator('.doc-hf--footer[data-page="2"]')).toContainText("Page");
      await checkToc();

      // .docx download and re-import keep the sections and the footer.
      await page.getByRole("button", { name: "File", exact: true }).click();
      await page.getByText("Download", { exact: true }).click();
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("menuitem", { name: "Microsoft Word (.docx)" }).click(),
      ]);
      const bytes = await readFile((await download.path())!);
      const text = bytes.toString("latin1");
      expect(text.includes("word/footer")).toBe(true);
      await testInfo.attach("pages.docx", { body: bytes, contentType: "application/octet-stream" });

      await page.goto(`${BASE_URL}/`);
      await page.getByTestId("tile-docs").click();
      await expect(page.getByTestId("docs-import")).toBeVisible();
      await page.getByTestId("docs-import-input").setInputFiles({
        name: "pages.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: bytes,
      });
      await page.waitForURL(/\/docs\/d\/[^/]+$/, { timeout: 20_000 });
      ids.push(page.url().split("/").pop()!);
      await expect(page.getByTestId("collab-status")).toHaveText("connected", { timeout: 15_000 });
      await expect.poll(() => pageCount(page), { timeout: 10_000 }).toBe(pages);
      await expect(page.locator('.doc-pages .doc-page[data-orient="landscape"]').first()).toBeAttached();
      await expect(page.locator('.doc-hf--footer[data-page="2"]')).toContainText("Page");
      await expect(page.locator('.doc-hf--footer[data-page="2"] .hf-field[data-field="PAGE"]')).toHaveCount(1);
    } finally {
      for (const d of ids) await trashDoc(page.request, d);
    }
  });

  test("print preview with a page range; pageless view", async ({ page }) => {
    const id = await createDoc(page.request, "e2e print");
    try {
      await openDoc(page, id);
      await paste(page, longHtml());
      await expect.poll(() => pageCount(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(4);
      const total = await pageCount(page);
      await page.keyboard.press("Control+p");
      await expect(page.getByTestId("print-preview")).toBeVisible();
      await expect(page.locator(".print-preview-page")).toHaveCount(total);
      await page.getByTestId("print-range").fill("2-3");
      await expect(page.locator(".print-preview-page")).toHaveCount(2);
      await expect(page.getByTestId("print-count")).toContainText(`2 of ${total}`);
      // The second page's clone shows the second page's text.
      await expect(page.locator(".print-preview-page").first()).toContainText("Intro");
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/docs-m9-print-preview.png` });
      await page.keyboard.press("Escape");

      // Pageless keeps the continuous look: no page sheets, no spacers.
      await page.getByTestId("status-pageless").click();
      await expect(page.getByTestId("doc-editor")).toHaveAttribute("data-paged", "false");
      await expect(editor(page).locator(".pg-spacer")).toHaveCount(0);
      await page.getByTestId("status-pageless").click();
      await expect(page.getByTestId("doc-editor")).toHaveAttribute("data-paged", "true");
    } finally {
      await trashDoc(page.request, id);
    }
  });
});
