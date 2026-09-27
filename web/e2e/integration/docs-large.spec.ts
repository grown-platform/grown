import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, createDoc, trashDoc } from "../helpers";
import { editor, pasteHtml, selectText } from "./docs-helpers";

// Large-content smoke for Docs: a ~50-page document (print layout, so the
// paginator runs) loads, scrolls and takes edits within generous bounds.
// Timings are printed as `[timing] docs-50pages …` lines.

const LOREM =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ";

function bigHtml(): string {
  let html = "";
  for (let s = 1; s <= 25; s++) {
    html += `<h1>Section ${s}</h1>`;
    for (let i = 1; i <= 16; i++) html += `<p>S${s}.${i} ${LOREM.repeat(2)}</p>`;
  }
  return html + "<p>THE END</p>";
}

const pageCount = (page: Page) => page.locator(".doc-pages .doc-page").count();

/** Opens the doc and returns ms until it is interactive: collab connected,
 *  the whole body replayed, and the paginator done (≥ 50 pages). */
async function timedOpen(page: Page, id: string): Promise<number> {
  const t0 = Date.now();
  await page.goto(`${BASE_URL}/docs/d/${id}`);
  await expect(page.getByTestId("collab-status")).toHaveText("connected", { timeout: 20_000 });
  await expect(editor(page)).toContainText("THE END", { timeout: 20_000 });
  await expect.poll(() => pageCount(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(50);
  return Date.now() - t0;
}

test.describe.serial("docs integration: large content", () => {
  test("~50-page document loads, scrolls and edits in time", async ({ page }) => {
    test.setTimeout(180_000);
    const id = await createDoc(page.request, "e2e docs 50 pages");
    try {
      // Build it (setup, not timed against a bound).
      await page.goto(`${BASE_URL}/docs/d/${id}`);
      await expect(page.getByTestId("collab-status")).toHaveText("connected", { timeout: 15_000 });
      const tBuild = Date.now();
      await pasteHtml(page, bigHtml());
      await expect(page.getByTestId("doc-editor")).toHaveAttribute("data-paged", "true");
      await expect.poll(() => pageCount(page), { timeout: 30_000 }).toBeGreaterThanOrEqual(50);
      const build = Date.now() - tBuild;
      await page.waitForTimeout(3000); // let the collab log persist

      // Load (cold reload) to interactive.
      const load = await timedOpen(page, id);
      const pages = await pageCount(page);

      // Scroll to the end.
      const tScroll = Date.now();
      await editor(page).locator("p", { hasText: "THE END" }).scrollIntoViewIfNeeded();
      await expect(editor(page).locator("p", { hasText: "THE END" })).toBeInViewport();
      await expect(editor(page).locator("h1", { hasText: "Section 25" })).toBeAttached();
      const scroll = Date.now() - tScroll;

      // Edit at the end and in the middle: time until the text is on screen.
      const tEdit = Date.now();
      await selectText(page, "THE END", "end");
      await page.keyboard.type(" Appended.");
      await expect(editor(page).locator("p", { hasText: "THE END Appended." })).toBeVisible();
      await selectText(page, "S13.10 ", "start");
      await page.keyboard.type("Inserted mid-document. ");
      await expect(editor(page).locator("p", { hasText: "Inserted mid-document. S13.10" })).toBeVisible();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(100);
      const edit = Date.now() - tEdit;
      // Pagination still holds after the edits.
      await expect.poll(() => pageCount(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(pages);

      // Edits persisted: reload again, still within the bound.
      await page.waitForTimeout(2000);
      const reload = await timedOpen(page, id);
      await expect(editor(page)).toContainText("THE END Appended.");
      await expect(editor(page)).toContainText("Inserted mid-document. ");

      console.log(
        `[timing] docs-50pages pages=${pages} build=${build}ms load=${load}ms scroll=${scroll}ms edit=${edit}ms reload=${reload}ms`,
      );
      test.info().annotations.push({
        type: "timing",
        description: `docs-50pages pages=${pages} load=${load}ms scroll=${scroll}ms edit=${edit}ms reload=${reload}ms`,
      });
      expect(pages).toBeGreaterThanOrEqual(50);
      expect(load, "load to interactive").toBeLessThan(10_000);
      expect(reload, "reload to interactive").toBeLessThan(10_000);
      expect(scroll, "scroll to end").toBeLessThan(5_000);
      expect(edit, "two edits on screen").toBeLessThan(5_000);
    } finally {
      await trashDoc(page.request, id);
    }
  });
});
