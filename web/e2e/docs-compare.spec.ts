import { test, expect, type Page } from "@playwright/test";
import { createDoc, createSheet, saveSheet, trashDoc, trashSheet } from "./helpers";
import { openDoc } from "./docs/helpers";

// Docs M12 in the real app: Tools ▸ Compare documents against another Grown
// doc (read live through the collab hub) opens a new document with the
// differences as tracked changes; Tools ▸ Mail merge from a Grown Sheet
// inserts merge fields, previews records and merges to a new document; the
// version history highlights what changed.
//
// Set DOCS_M12_SHOTS to a path prefix to save screenshots of the compare
// result and the mail merge preview.

const editor = (page: Page) => page.locator(".ProseMirror").first();
const shots = process.env.DOCS_M12_SHOTS;

async function menu(page: Page, name: string, testId: string) {
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByTestId(testId).click();
}

async function typeDoc(page: Page, lines: string[]) {
  await editor(page).click();
  for (const [i, l] of lines.entries()) {
    if (i) await page.keyboard.press("Enter");
    await page.keyboard.type(l);
  }
  // Let the collab hub store the last updates.
  await page.waitForTimeout(600);
}

test.describe("docs compare and mail merge", () => {
  test.describe.configure({ mode: "serial" });

  test("compare two docs -> tracked changes in a new doc", async ({ page }) => {
    const stamp = Date.now();
    const revisedTitle = `e2e revised ${stamp}`;
    const orig = await createDoc(page.request, `e2e original ${stamp}`);
    const rev = await createDoc(page.request, revisedTitle);
    const made: string[] = [];
    try {
      await openDoc(page, rev);
      await typeDoc(page, ["The slow brown fox jumps.", "A second paragraph stays.", "An added paragraph."]);
      await openDoc(page, orig);
      await typeDoc(page, ["The quick brown fox.", "A second paragraph stays."]);

      await menu(page, "Tools", "tools-compare");
      await expect(page.getByTestId("compare-dialog")).toBeVisible();
      await page.getByTestId("compare-a-doc").click();
      await page.getByRole("option", { name: revisedTitle }).click();
      await page.getByTestId("compare-author").locator("input").fill("Rita Reviser");
      await page.getByTestId("compare-run").click();

      // The result opens as a new document.
      await expect(page).not.toHaveURL(new RegExp(`/docs/d/${orig}$`), { timeout: 15_000 });
      made.push(page.url().split("/").pop()!);
      await expect(editor(page)).toContainText("slow", { timeout: 15_000 });
      const del = editor(page).locator(".suggestion-delete");
      const ins = editor(page).locator(".suggestion-insert");
      await expect(del.filter({ hasText: "quick" })).toHaveCount(1);
      await expect(ins.filter({ hasText: "slow" })).toHaveCount(1);
      await expect(ins.filter({ hasText: "jumps" })).toHaveCount(1);
      await expect(ins.filter({ hasText: "An added paragraph." })).toHaveCount(1);
      await expect(editor(page).locator(".suggestion-insert[data-author='Rita Reviser']").first()).toBeVisible();

      // The review panel lists them and accepting all gives the revised text.
      await page.getByRole("button", { name: "Tools", exact: true }).click();
      await page.getByRole("menuitem", { name: "Review changes…" }).click();
      await expect(page.getByTestId("change-card").first()).toBeVisible();
      if (shots) await page.screenshot({ path: `${shots}compare.png` });
      await page.getByRole("button", { name: "Tools", exact: true }).click();
      await page.getByRole("menuitem", { name: "Accept all changes" }).click();
      await expect(editor(page).locator(".suggestion-delete, .suggestion-insert")).toHaveCount(0);
      await expect(editor(page).locator("p").first()).toHaveText("The slow brown fox jumps.");
    } finally {
      for (const id of [orig, rev, ...made]) await trashDoc(page.request, id);
    }
  });

  test("mail merge from a sheet: fields, preview, merge to a new doc", async ({ page }) => {
    const stamp = Date.now();
    const sheetTitle = `e2e merge data ${stamp}`;
    const sheet = await createSheet(page.request, sheetTitle);
    await saveSheet(page.request, sheet, [
      {
        name: "People",
        celldata: [
          { r: 0, c: 0, v: { v: "Name", m: "Name" } },
          { r: 0, c: 1, v: { v: "City", m: "City" } },
          { r: 1, c: 0, v: { v: "Ada", m: "Ada" } },
          { r: 1, c: 1, v: { v: "London", m: "London" } },
          { r: 2, c: 0, v: { v: "Grace", m: "Grace" } },
          { r: 2, c: 1, v: { v: "Arlington", m: "Arlington" } },
        ],
      },
    ]);
    const doc = await createDoc(page.request, `e2e letter ${stamp}`);
    const made: string[] = [];
    try {
      await openDoc(page, doc);
      await editor(page).click();
      await page.keyboard.type("Dear ");

      await menu(page, "Tools", "tools-mail-merge");
      const panel = page.getByTestId("mail-merge");
      await expect(panel).toBeVisible();
      await panel.getByTestId("mm-sheet").click();
      await page.getByRole("option", { name: sheetTitle }).click();
      await panel.getByTestId("mm-load").click();
      await expect(panel.getByTestId("mm-summary")).toHaveText(/2 records · 2 fields/);

      // Insert «Name», then type, then «City».
      await panel.getByTestId("mm-field-Name").click();
      await page.waitForTimeout(100);
      await page.keyboard.type(", greetings from ");
      await panel.getByTestId("mm-field-City").click();
      await page.waitForTimeout(100);
      await page.keyboard.type(".");
      await expect(editor(page).locator("p").first()).toHaveText("Dear «Name», greetings from «City».");

      // Preview records.
      await panel.getByTestId("mm-preview").check();
      await expect(editor(page).locator("p").first()).toHaveText("Dear Ada, greetings from London.");
      await expect(panel.getByTestId("mm-record")).toHaveText("1 of 2");
      await panel.getByTestId("mm-next").click();
      await expect(editor(page).locator("p").first()).toHaveText("Dear Grace, greetings from Arlington.");
      if (shots) await page.screenshot({ path: `${shots}mailmerge.png` });

      // Merge to a new document: one letter per record, a page break between.
      await panel.getByTestId("mm-merge-doc").click();
      await expect(page).not.toHaveURL(new RegExp(`/docs/d/${doc}$`), { timeout: 15_000 });
      made.push(page.url().split("/").pop()!);
      await expect(editor(page).locator("p", { hasText: "Dear Ada, greetings from London." })).toHaveCount(1, { timeout: 15_000 });
      await expect(editor(page).locator("p", { hasText: "Dear Grace, greetings from Arlington." })).toHaveCount(1);
      await expect(editor(page).locator("[data-page-break]")).toHaveCount(1);
      await expect(editor(page).locator(".doc-field")).toHaveCount(0);
    } finally {
      for (const id of [doc, ...made]) await trashDoc(page.request, id);
      await trashSheet(page.request, sheet);
    }
  });

  test("version history highlights changes since the previous version", async ({ page }) => {
    const doc = await createDoc(page.request, `e2e versions ${Date.now()}`);
    try {
      await openDoc(page, doc);
      await typeDoc(page, ["Alpha beta gamma."]);
      // Save two named versions through the API (the editor's HTML).
      const save = async (label: string) =>
        page.evaluate(
          async ({ id, label }) => {
            const html = (document.querySelector(".ProseMirror") as HTMLElement).innerHTML;
            const r = await fetch(`/api/v1/docs/d/${id}/versions`, {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content_html: html, label, is_auto: false }),
            });
            return r.ok;
          },
          { id: doc, label },
        );
      expect(await save("first")).toBe(true);
      await editor(page).click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type("Alpha gamma delta.");
      await page.waitForTimeout(300);
      expect(await save("second")).toBe(true);

      await page.getByRole("button", { name: "File", exact: true }).click();
      await page.getByRole("menuitem", { name: /Version history/ }).click();
      await page.getByText("second", { exact: true }).click();
      await page.getByTestId("version-highlight").check();
      const preview = page.getByTestId("version-preview");
      await expect(preview.locator(".suggestion-delete")).toContainText("beta");
      await expect(preview.locator(".suggestion-insert")).toContainText("delta");
      await expect(page.getByTestId("version-diff-summary")).toContainText("insertion");
    } finally {
      await trashDoc(page.request, doc);
    }
  });
});
