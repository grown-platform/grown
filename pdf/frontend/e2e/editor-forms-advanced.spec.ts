import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import fs from "node:fs";

/**
 * Wave 4a (advanced) — AcroForm export edge cases that the base editor-forms
 * spec doesn't cover:
 *   (a) A radio GROUP: two radio-button fields that share a `groupName` export
 *       as ONE PDFRadioGroup whose options are the union of the buttons and
 *       whose selected value is the one picked in the editor.
 *   (b) A dropdown flattened on export leaves ZERO live form fields.
 *
 * Verified by re-parsing the exported bytes with pdf-lib (introspecting the
 * real AcroForm), not by inspecting on-screen graphics.
 *
 * Requires a browser. On NixOS, run within `nix develop`.
 */
test.describe("PDF Editor - AcroForm advanced (radio groups, flatten)", () => {
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

  test("(a) two radios sharing a group export as ONE radio group with the picked value", async ({ page }) => {
    await openBlank(page);

    // Radio button #1 → group "confirm", single option "Yes", select it.
    // (Options within one radio group must be unique, so each button owns a
    // distinct option name — the export joins them via the shared group name.)
    await placeField(page, "tool-field-radio", 0.25, 0.2);
    await page.getByTestId("field-group").fill("confirm");
    await page.getByTestId("field-options").fill("Yes");
    // The default-value select is repopulated from the options above.
    await page.getByTestId("field-value").selectOption("Yes");

    // Radio button #2 → same group "confirm", option "No", left unselected.
    await placeField(page, "tool-field-radio", 0.25, 0.55);
    await page.getByTestId("field-group").fill("confirm");
    await page.getByTestId("field-options").fill("No");

    const bytes = await downloadBytes(page);
    const out = await PDFDocument.load(bytes);
    const form = out.getForm();

    // Exactly one AcroForm field exists, and it is the shared radio group.
    const fields = form.getFields();
    expect(fields.map((f) => f.getName())).toEqual(["confirm"]);

    const rg = form.getRadioGroup("confirm");
    expect(rg.getSelected()).toBe("Yes");
    expect(rg.getOptions()).toEqual(expect.arrayContaining(["Yes", "No"]));
  });

  test("(b) dropdown + flatten ON leaves zero live form fields", async ({ page }) => {
    await openBlank(page);

    await placeField(page, "tool-field-dropdown", 0.25, 0.3);
    await page.getByTestId("field-name").fill("country");
    await page.getByTestId("field-options").fill("US, CA");
    await page.getByTestId("field-value").selectOption("CA");

    // Turn on flattening, then export → the dropdown bakes into static content.
    await page.getByTestId("flatten-forms").check();
    const bytes = await downloadBytes(page);

    const out = await PDFDocument.load(bytes);
    expect(out.getForm().getFields().length).toBe(0);
    expect(out.getPageCount()).toBe(1);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});
