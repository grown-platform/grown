import { test, expect } from "@playwright/test";
import { createDoc, trashDoc } from "./helpers";
import { openDoc } from "./docs/helpers";

// Docs M3: styles and numbering in the real app. Applies a style from the
// toolbar gallery and a numbered list (autocorrect and the list library),
// then reloads and checks both came back from the collab update log — the
// paragraph attributes (styleId / numId) and the `numbering` Yjs map that
// the labels are computed from.
//
// Set DOCS_M3_SCREENSHOT to save a screenshot of the styled document.

const editor = (page: import("@playwright/test").Page) => page.locator(".ProseMirror").first();

test.describe.serial("docs styles and numbering", () => {
  test("style and numbered list persist across reload", async ({ page }) => {
    const id = await createDoc(page.request, "e2e styles");
    try {
      await openDoc(page, id);
      await editor(page).click();

      // Title from the style gallery.
      await page.keyboard.type("Quarterly report");
      await page.getByTestId("style-gallery").click();
      await page.getByTestId("style-option-Title").click();
      await expect(editor(page).locator('p[data-style="Title"]')).toHaveText("Quarterly report");
      await expect(page.getByTestId("style-gallery")).toHaveText(/Title/);

      // Enter after a Title continues with Normal text.
      await editor(page).locator('p[data-style="Title"]').click();
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      await page.keyboard.type("Subtitle line");
      await page.getByTestId("style-gallery").click();
      await page.getByTestId("style-option-Subtitle").click();
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");

      // A Heading 1 through the gallery (a real <h1>).
      await page.keyboard.type("Highlights");
      await page.getByTestId("style-gallery").click();
      await page.getByTestId("style-option-Heading1").click();
      await expect(editor(page).locator("h1")).toHaveText("Highlights");
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");

      // Numbered list by autocorrect: "1) " starts a Word-style list.
      await page.keyboard.type("1) Revenue grew 12%");
      await page.keyboard.press("Enter");
      await page.keyboard.type("Costs fell 3%");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Tab");
      await page.keyboard.type("Mostly hosting");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");

      const nums = editor(page).locator(".doc-num");
      await expect(nums).toHaveCount(3);
      await expect(nums.nth(0)).toHaveAttribute("data-num", "1)");
      await expect(nums.nth(1)).toHaveAttribute("data-num", "2)");
      await expect(nums.nth(2)).toHaveAttribute("data-num", "a.");

      // A multilevel list from the library on a second block.
      await page.keyboard.type("Next steps");
      await page.getByTestId("style-gallery").click();
      await page.getByTestId("style-option-Heading2").click();
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      await page.keyboard.type("Hire two engineers");
      await page.getByRole("button", { name: "List library" }).click();
      await page.getByTestId("list-preset-ml-legal").click();
      await page.keyboard.press("Enter");
      await page.keyboard.type("Ship the mobile app");
      await expect(nums).toHaveCount(5);
      await expect(nums.nth(3)).toHaveAttribute("data-num", "1.");
      await expect(nums.nth(4)).toHaveAttribute("data-num", "2.");

      // A quote.
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
      await page.keyboard.type("Numbers are what they are.");
      await page.getByTestId("style-gallery").click();
      await page.getByTestId("style-option-Quote").click();

      // Let the collab updates flush, then reload.
      await page.waitForTimeout(2500);
      await page.reload();
      await expect(editor(page)).toContainText("Numbers are what they are.", { timeout: 15_000 });

      await expect(editor(page).locator('p[data-style="Title"]')).toHaveText("Quarterly report");
      await expect(editor(page).locator('p[data-style="Subtitle"]')).toHaveText("Subtitle line");
      await expect(editor(page).locator("h1")).toHaveText("Highlights");
      await expect(editor(page).locator('p[data-style="Quote"]')).toHaveText("Numbers are what they are.");
      const after = editor(page).locator(".doc-num");
      await expect(after).toHaveCount(5);
      expect(await after.evaluateAll((els) => els.map((e) => e.getAttribute("data-num")))).toEqual([
        "1)",
        "2)",
        "a.",
        "1.",
        "2.",
      ]);
      // The Title's style CSS is live (generated from the style sheet).
      const titleSize = await editor(page)
        .locator('p[data-style="Title"]')
        .evaluate((el) => getComputedStyle(el).fontSize);
      expect(parseFloat(titleSize)).toBeGreaterThan(30);

      const shot = process.env.DOCS_M3_SCREENSHOT;
      if (shot) {
        await editor(page).click({ position: { x: 5, y: 5 } });
        await page.getByTestId("doc-editor").screenshot({ path: shot });
      }
    } finally {
      await trashDoc(page.request, id);
    }
  });

  test("paragraph settings dialog sets indents and keeps; ruler follows", async ({ page }) => {
    const id = await createDoc(page.request, "e2e paragraph settings");
    try {
      await openDoc(page, id);
      await editor(page).click();
      await page.keyboard.type("An indented paragraph with a hanging first line that wraps around.");
      await page.getByRole("button", { name: "Format", exact: true }).click();
      await page.getByRole("menuitem", { name: "Paragraph settings…" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Left", { exact: true }).fill("1");
      await dialog.getByRole("combobox", { name: "Special indent" }).click();
      await page.getByRole("option", { name: "Hanging" }).click();
      await dialog.getByLabel("By", { exact: true }).fill("0.5");
      await dialog.getByRole("tab", { name: "Line & page breaks" }).click();
      await dialog.getByLabel("Keep with next").check();
      await dialog.getByTestId("dialog-apply").click();
      const p = editor(page).locator("p").first();
      await expect(p).toHaveCSS("margin-left", "96px");
      await expect(p).toHaveCSS("text-indent", "-48px");
      await expect(p).toHaveAttribute("data-keep-next", "");
      // The ruler's paragraph markers moved with the paragraph.
      await expect(page.getByTestId("ruler-marginLeft")).toBeVisible();
    } finally {
      await trashDoc(page.request, id);
    }
  });
});
