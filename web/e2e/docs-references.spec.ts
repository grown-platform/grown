import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { BASE_URL, createDoc, trashDoc } from "./helpers";
import { openDoc } from "./docs/helpers";

// Docs M8: references and fields in the real app. Types headings, inserts
// a table of contents, a caption, a bookmark and cross-references from
// the menus, edits a heading and updates the table with F9, reloads, then
// downloads the doc as .docx and imports the download.
//
// Set DOCS_M8_SCREENSHOT to save a screenshot of the TOC, the caption and
// the cross-references.

const editor = (page: Page) => page.locator(".ProseMirror").first();
const tocEntries = (page: Page) => editor(page).locator(".doc-toc p.doc-toc-entry .toc-text");
const fields = (page: Page) => editor(page).locator(".doc-field");

async function menu(page: Page, name: string, testId: string) {
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByTestId(testId).click();
}

/** Put the caret at the end (or start) of the top-level `tag` block whose
 *  text contains `text`, through the DOM selection: Home/End and
 *  Ctrl+Home follow the host OS (no-ops on macOS). */
async function caretAfter(page: Page, text: string, tag = "p", atStart = false) {
  await editor(page).click();
  await page.evaluate(
    ([t, tg, start]) => {
      const root = document.querySelector(".ProseMirror")!;
      const blocks = [...root.querySelectorAll(`:scope > ${tg}`)].filter((b) => b.textContent!.includes(t as string));
      const b = blocks[blocks.length - 1];
      const r = document.createRange();
      r.selectNodeContents(b);
      r.collapse(!!start);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(r);
    },
    [text, tag, atStart] as const,
  );
  await page.waitForTimeout(150);
}

/** Select `word` in the document through the DOM selection (as a mouse
 *  drag would). */
async function selectWord(page: Page, word: string) {
  await editor(page).click();
  await page.evaluate((w) => {
    const root = document.querySelector(".ProseMirror")!;
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = it.nextNode(); n; n = it.nextNode()) {
      const i = n.textContent!.indexOf(w);
      if (i >= 0) {
        window.getSelection()!.setBaseAndExtent(n, i, n, i + w.length);
        return;
      }
    }
  }, word);
  await page.waitForTimeout(150);
}

async function pickOption(page: Page, selectTestId: string, option: string) {
  await page.getByTestId(selectTestId).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function expectModel(page: Page, scope = "Scope and limits") {
  await expect(tocEntries(page)).toHaveText(["Introduction", scope, "Results"]);
  await expect(editor(page).locator(".doc-toc .toc-page").first()).toHaveText("1");
  const caption = editor(page).locator("p", { hasText: "Growth chart" });
  await expect(caption).toHaveText("Figure 1: Growth chart");
  await expect(editor(page).locator("p", { hasText: "See " })).toHaveText(`See Figure 1 and “${scope}”.`);
  await expect(editor(page).locator('[data-bookmark="GrowthWord"]')).toHaveText("growth");
}

test.describe.serial("docs references", () => {
  test("TOC, caption, bookmark, cross-reference; update; reload; docx round trip", async ({ page }) => {
    const ids: string[] = [];
    const id = await createDoc(page.request, "M8 references");
    ids.push(id);
    try {
      await openDoc(page, id);
      await editor(page).click();
      // Headings and body text.
      await page.keyboard.press("Control+Alt+Digit1");
      await page.keyboard.type("Introduction");
      await page.keyboard.press("Enter");
      await page.keyboard.type("Some text about growth over time.");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Control+Alt+Digit2");
      await page.keyboard.type("Scope");
      await page.keyboard.press("Enter");
      await page.keyboard.type("A chart goes here.");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Control+Alt+Digit1");
      await page.keyboard.type("Results");
      await page.keyboard.press("Enter");
      await page.keyboard.type("See ");
      await page.waitForTimeout(100);

      // Table of contents at the top (References ▸ Insert table of contents).
      await caretAfter(page, "Introduction", "h1", true);
      await menu(page, "References", "ref-insert-toc");
      await expect(tocEntries(page)).toHaveText(["Introduction", "Scope", "Results"]);
      await expect(editor(page).locator(".doc-toc .toc-text a").first()).toHaveAttribute("href", /^#_Toc\d+$/);

      // Caption under the chart paragraph (Insert ▸ Caption).
      await caretAfter(page, "A chart goes here.");
      await menu(page, "Insert", "insert-caption");
      await page.getByTestId("caption-text").fill(": Growth chart");
      await page.getByTestId("caption-insert").click();
      await expect(editor(page).locator("p", { hasText: "Growth chart" })).toHaveText("Figure 1: Growth chart");

      // Bookmark on the word "growth".
      await selectWord(page, "growth");
      await menu(page, "Insert", "insert-bookmark");
      await page.getByTestId("bookmark-name").fill("GrowthWord");
      await page.getByTestId("bookmark-add").click();
      await expect(editor(page).locator('[data-bookmark="GrowthWord"]')).toHaveText("growth");

      // Cross-references after "See ": the figure's label and number, then
      // the Scope heading's text.
      await caretAfter(page, "See");
      await menu(page, "References", "ref-crossref");
      await pickOption(page, "crossref-type", "Figure");
      await pickOption(page, "crossref-kind", "Only label and number");
      await page.getByTestId("crossref-insert").click();
      await page.keyboard.type(" and “");
      await menu(page, "References", "ref-crossref");
      await pickOption(page, "crossref-type", "Heading");
      await page.getByTestId("crossref-list").getByText("Scope", { exact: true }).click();
      await page.getByTestId("crossref-insert").click();
      await page.keyboard.type("”.");
      await expect(editor(page).locator("p", { hasText: "See " })).toHaveText("See Figure 1 and “Scope”.");

      // Edit the heading; F9 in the table updates it, Ctrl+F9 everything.
      await caretAfter(page, "Scope", "h2");
      await page.keyboard.type(" and limits");
      await expect(tocEntries(page).nth(1)).toHaveText("Scope");
      await tocEntries(page).first().click();
      await page.waitForTimeout(100);
      await page.keyboard.press("F9");
      await expect(tocEntries(page)).toHaveText(["Introduction", "Scope and limits", "Results"]);
      await caretAfter(page, "See");
      await page.keyboard.press("Control+F9");
      await expectModel(page);

      // Ctrl+click on the heading reference goes to the heading.
      await fields(page).last().click({ modifiers: ["Control"] });
      await page.waitForTimeout(100);
      const selected = await page.evaluate(() => window.getSelection()?.toString());
      expect(selected).toBe("Scope and limits");

      const shot = process.env.DOCS_M8_SCREENSHOT;
      if (shot) {
        await page.mouse.click(5, 5);
        await page.screenshot({ path: shot, fullPage: false });
      }

      // Reload: the Yjs log kept everything.
      await page.waitForTimeout(1000);
      await openDoc(page, id);
      await expectModel(page);

      // Download as .docx and import the download.
      await page.getByRole("button", { name: "File", exact: true }).click();
      await page.getByText("Download", { exact: true }).click();
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("menuitem", { name: "Microsoft Word (.docx)" }).click(),
      ]);
      const bytes = await readFile((await download.path())!);
      expect(bytes.subarray(0, 2).toString()).toBe("PK");
      await page.goto(`${BASE_URL}/`);
      await page.getByTestId("tile-docs").click();
      await page.getByTestId("docs-import-input").setInputFiles({
        name: "M8 references.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: bytes,
      });
      await page.waitForURL(/\/docs\/d\/[^/]+$/, { timeout: 20_000 });
      ids.push(page.url().split("/").pop()!);
      await expect(page.getByTestId("collab-status")).toHaveText("connected", { timeout: 15_000 });
      await expectModel(page);
      await expect(fields(page)).toHaveCount(3);
    } finally {
      for (const d of ids) await trashDoc(page.request, d);
    }
  });

  // Regression: text typed straight after Insert in the cross-reference
  // dialog was sometimes lost (the modal's focus trap left the DOM caret
  // at the start of the document until TipTap's next-frame focus).
  test("text typed right after a dialog insert lands after the reference", async ({ page }) => {
    const id = await createDoc(page.request, "M8 crossref typing");
    try {
      await openDoc(page, id);
      await editor(page).click();
      await page.keyboard.press("Control+Alt+Digit2");
      await page.keyboard.type("Scope");
      await page.keyboard.press("Enter");
      for (let i = 0; i < 6; i++) {
        await page.keyboard.type(`Item ${i} “`);
        await menu(page, "References", "ref-crossref");
        await page.getByTestId("crossref-list").getByText("Scope", { exact: true }).click();
        await page.getByTestId("crossref-insert").click();
        await page.keyboard.type("”.");
        await expect(editor(page).locator(":scope > p").last()).toHaveText(`Item ${i} “Scope”.`);
        await page.keyboard.press("Enter");
      }
      await expect(editor(page).locator("h2")).toHaveText("Scope");
    } finally {
      await trashDoc(page.request, id);
    }
  });
});
