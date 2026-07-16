import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import fs from "node:fs";

/**
 * Wave 4a — interactive AcroForm fields. Place text/checkbox/dropdown fields,
 * name + fill them, export, and re-parse the exported bytes with pdf-lib to
 * prove REAL AcroForm fields (not static graphics). Also verifies the
 * "Flatten forms" export toggle bakes fields into static content.
 *
 * Requires a browser. On NixOS, run within `nix develop`.
 */
test.describe("PDF Editor - AcroForm fields", () => {
  // The /editor route is auth-guarded; with no backend, UserContext would
  // redirect to SSO login. Seed the redirect-loop breaker so the editor renders.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem("lastLoginAttempt", String(Date.now()));
    });
  });

  async function openBlank(page: Page) {
    await page.goto("/editor");
    await page.getByTestId("editor-new-blank").click();
    await expect(page.getByTestId("editor-canvas")).toBeVisible();
    await expect(page.locator(".react-pdf__Page")).toBeVisible();
  }

  // Select a field tool and click the canvas at a normalized point to place a
  // default-sized field (which becomes selected, opening the properties panel).
  async function placeField(page: Page, tool: string, fx: number, fy: number) {
    await page.getByTestId(tool).click();
    const canvas = page.getByTestId("editor-canvas");
    const b = (await canvas.boundingBox())!;
    await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
    await expect(page.getByTestId("field-name")).toBeVisible();
  }

  async function downloadBytes(page: Page): Promise<Buffer> {
    await expect(page.getByTestId("editor-download")).toBeEnabled();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("editor-download").click(),
    ]);
    return fs.promises.readFile(await download.path());
  }

  test("(a) text + checkbox export as live, filled AcroForm fields", async ({ page }) => {
    await openBlank(page);

    // Text field named "full_name" filled with "Jane Doe".
    await placeField(page, "tool-field-text", 0.25, 0.2);
    await page.getByTestId("field-name").fill("full_name");
    await page.getByTestId("field-value").fill("Jane Doe");

    // Checkbox named "agree", checked.
    await placeField(page, "tool-field-check", 0.25, 0.55);
    await page.getByTestId("field-name").fill("agree");
    await page.getByTestId("field-value").check();

    const bytes = await downloadBytes(page);
    const out = await PDFDocument.load(bytes);
    const form = out.getForm();
    const names = form.getFields().map((f) => f.getName());
    expect(names).toContain("full_name");
    expect(names).toContain("agree");
    expect(form.getTextField("full_name").getText()).toBe("Jane Doe");
    expect(form.getCheckBox("agree").isChecked()).toBe(true);
  });

  test("(b) flatten-forms ON bakes fields into static content", async ({ page }) => {
    await openBlank(page);

    await placeField(page, "tool-field-text", 0.25, 0.25);
    await page.getByTestId("field-name").fill("full_name");
    await page.getByTestId("field-value").fill("Jane Doe");

    // Turn on flattening, then export.
    await page.getByTestId("flatten-forms").check();
    const bytes = await downloadBytes(page);

    const out = await PDFDocument.load(bytes);
    // Flattened → no live form fields remain, but the page + bytes survive.
    expect(out.getForm().getFields().length).toBe(0);
    expect(out.getPageCount()).toBe(1);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  test("(c) dropdown exports with its options and selected value", async ({ page }) => {
    await openBlank(page);

    await placeField(page, "tool-field-dropdown", 0.25, 0.3);
    await page.getByTestId("field-name").fill("country");
    await page.getByTestId("field-options").fill("US, CA");
    // The default-value select is populated from the options above.
    await page.getByTestId("field-value").selectOption("CA");

    const bytes = await downloadBytes(page);
    const out = await PDFDocument.load(bytes);
    const form = out.getForm();
    expect(form.getFields().map((f) => f.getName())).toContain("country");
    const dd = form.getDropdown("country");
    expect(dd.getSelected()).toContain("CA");
    expect(dd.getOptions()).toEqual(expect.arrayContaining(["US", "CA"]));
  });
});
