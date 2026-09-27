import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { BASE_URL, createDoc, trashDoc } from "./helpers";
import { openDoc } from "./docs/helpers";

// Docs M11: equations in the real app. Types equations in the linear format
// (math autocorrect as you type) through the equation panel — opened with
// Ctrl+Alt+= and from Insert ▸ Equation — checks the KaTeX rendering,
// changes one from the context menu, reloads to check the Yjs log kept the
// model, then downloads the doc as .docx and imports the download.
//
// Set DOCS_M11_SCREENSHOT to save a screenshot of the rendered equations.

const editor = (page: Page) => page.locator(".ProseMirror").first();
const maths = (page: Page) => editor(page).locator(".doc-math");

/** Type an equation into the open equation panel and finish it. */
async function typeEquation(page: Page, linear: string, display = false) {
  const panel = page.getByTestId("equation-editor");
  await expect(panel).toBeVisible();
  const input = page.getByTestId("equation-input");
  await input.focus();
  // "→" stands for the Right arrow (leaves the current argument).
  for (const [i, part] of linear.split("→").entries()) {
    if (i) await page.keyboard.press("ArrowRight");
    await page.keyboard.type(part, { delay: 5 });
  }
  if (display) await page.getByTestId("eq-display").locator("input").check();
  await expect(page.getByTestId("equation-preview").locator(".katex").first()).toBeVisible();
  await input.focus();
  await page.keyboard.press("Enter");
  await expect(panel).toBeHidden();
}

async function insertFromMenu(page: Page) {
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByTestId("insert-equation").click();
}

async function endOfDoc(page: Page) {
  await editor(page).click();
  await page.keyboard.press("Control+End");
  await page.waitForTimeout(100);
}

async function expectEquations(page: Page) {
  await expect(maths(page)).toHaveCount(4);
  const quad = maths(page).nth(0);
  await expect(quad).toHaveAttribute("data-linear", "x=(-b±√(b^2-4ac))/2a");
  await expect(quad.locator(".katex .mfrac")).toHaveCount(1);
  await expect(quad.locator(".katex .sqrt")).toHaveCount(1);
  const matrix = maths(page).nth(1);
  await expect(matrix).toHaveAttribute("data-linear", "A=[■(a&b@c&d)]");
  await expect(matrix.locator(".katex .mtable")).toHaveCount(1);
  const sum = maths(page).nth(2);
  await expect(sum).toHaveClass(/doc-math-display/);
  await expect(sum).toHaveAttribute("data-linear", "∑_(i=1)^n▒〖i^2〗=(n(n+1) (2n+1))/6");
  await expect(sum.locator(".katex-display .mop.op-symbol.large-op")).toHaveCount(1);
  const integral = maths(page).nth(3);
  await expect(integral).toHaveAttribute("data-linear", "∫_0^1▒〖x^2 dx〗=1/3");
  await expect(integral.locator(".katex .mop.op-symbol")).toHaveCount(1);
}

test.describe.serial("docs equations", () => {
  test("type equations in linear format, render, reload, docx round trip", async ({ page }) => {
    const ids: string[] = [];
    const id = await createDoc(page.request, "M11 equations");
    ids.push(id);
    try {
      await openDoc(page, id);
      await editor(page).click();
      await page.keyboard.type("The quadratic formula ");
      await page.waitForTimeout(100);

      // 1. Ctrl+Alt+= opens a new equation; \pm and \sqrt autocorrect on space.
      await page.keyboard.press("Control+Alt+Equal");
      await typeEquation(page, "x=(-b\\pm \\sqrt (b^2-4ac))/2a");
      await expect(maths(page)).toHaveCount(1);

      // 2. Insert ▸ Equation: a matrix in brackets.
      await page.keyboard.type(" and a matrix ");
      await page.waitForTimeout(100);
      await insertFromMenu(page);
      await typeEquation(page, "A=[■(a&b@c&d)]");

      // 3. A display equation: sum with limits.
      await endOfDoc(page);
      await page.keyboard.press("Enter");
      await insertFromMenu(page);
      await typeEquation(page, "\\sum _(i=1)^n i^2 →=(n(n+1)(2n+1))/6", true);

      // 4. An integral, then make it a display equation from the context menu.
      await endOfDoc(page);
      await page.keyboard.type("Area: ");
      await insertFromMenu(page);
      await typeEquation(page, "\\int _0^1 x^2 dx→=1/3");
      await maths(page).nth(3).click({ button: "right" });
      await page.getByTestId("eq-display-menu").click();
      await expect(maths(page).nth(3)).toHaveClass(/doc-math-display/);

      await expectEquations(page);
      const shot = process.env.DOCS_M11_SCREENSHOT;
      if (shot) {
        await page.mouse.click(5, 5);
        await page.screenshot({ path: shot, fullPage: false });
      }

      // Reload: the Yjs log kept every equation.
      await page.waitForTimeout(1000);
      await openDoc(page, id);
      await expectEquations(page);

      // Edit one in place: click it, change it, finish.
      await maths(page).nth(0).click();
      await expect(page.getByTestId("equation-editor")).toBeVisible();
      await expect(page.getByTestId("equation-input")).toHaveValue("x=(-b±√(b^2-4ac))/2a");
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("equation-editor")).toBeHidden();

      // Download as .docx (OMML) and import the download.
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
        name: "M11 equations.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: bytes,
      });
      await page.waitForURL(/\/docs\/d\/[^/]+$/, { timeout: 20_000 });
      ids.push(page.url().split("/").pop()!);
      await expect(page.getByTestId("collab-status")).toHaveText("connected", { timeout: 15_000 });
      await expectEquations(page);
    } finally {
      for (const d of ids) await trashDoc(page.request, d);
    }
  });
});
