import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Flagship cross-feature regression: build a rich, multi-page document using a
 * broad slice of the editor (text, shape + rotation, highlight, typed
 * signature, sticky note, preset stamp, form field, document metadata), then
 * "Save editable copy" and REOPEN it. The embedded editor sidecar must restore
 * the WHOLE editable model — every annotation kind comes back as an editable
 * object, the comment sidebar re-lists the note, the rectangle keeps its
 * rotation, and a subsequent flattened Download still carries the live form
 * field value and the document metadata.
 *
 * This proves the end-to-end round-trip that ties the feature set together.
 *
 * Requires a browser. On NixOS, run within `nix develop`.
 */
test.describe("PDF Editor - cross-feature integration round-trip", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      // Bypass the SSO redirect (editor needs no backend).
      sessionStorage.setItem("lastLoginAttempt", String(Date.now()));
      // Clear the autosave draft DB on EVERY navigation so the restore-draft
      // prompt never interferes with the editable-sidecar reopen.
      try {
        indexedDB.deleteDatabase("pdf-editor-drafts");
      } catch {
        /* ignore */
      }
    });
  });

  const box = async (page: Page) => (await page.getByTestId("editor-canvas").boundingBox())!;
  const clickCanvas = async (page: Page, fx: number, fy: number) => {
    const b = await box(page);
    await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
  };

  // Reload → empty state, dismissing the draft prompt if it ever appears.
  async function resetToEmpty(page: Page) {
    await page.reload();
    const noBtn = page.getByTestId("restore-draft-no");
    if (await noBtn.isVisible().catch(() => false)) await noBtn.click();
    await expect(page.getByTestId("editor-dropzone")).toBeVisible();
  }

  test("build → save editable → reopen restores the full model; flattened download keeps the field", async ({ page }) => {
    test.setTimeout(90_000);

    // ---- New blank + a second page --------------------------------------
    await page.goto("/editor");
    await page.getByTestId("editor-new-blank").click();
    const canvas = page.getByTestId("editor-canvas");
    await expect(canvas).toBeVisible();
    await expect(page.locator(".react-pdf__Page")).toBeVisible();

    const indicator = page.getByTestId("editor-page-indicator");
    await page.getByTestId("page-add").click();
    await expect(indicator).toContainText("/ 2");
    // Work on page 1 so a reopen (which lands on page 1) shows everything.
    const jump = page.getByTestId("editor-page-jump");
    await jump.fill("1");
    await jump.press("Enter");
    await expect(indicator).toContainText("1 / 2");

    // ---- Text box "INTEG" -----------------------------------------------
    await page.getByTestId("tool-text").click();
    await clickCanvas(page, 0.2, 0.15);
    const ta = page.getByTestId("editor-textarea");
    await expect(ta).toBeVisible();
    await ta.fill("INTEG");
    await ta.press("Escape");
    await expect(page.locator('[data-annot-kind="text"]')).toContainText("INTEG");

    // ---- Rectangle, rotated ~30° ----------------------------------------
    await page.getByTestId("tool-rect").click();
    let b = await box(page);
    await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.15);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.75, b.y + b.height * 0.28, { steps: 8 });
    await page.mouse.up();
    // Set an exact 30° via the numeric rotation input (robust vs. handle drag).
    const rotInput = page.getByTestId("rotate-input");
    await expect(rotInput).toBeVisible();
    await rotInput.fill("30");
    await expect(page.locator('[data-annot-rotation="30"]')).toHaveCount(1);

    // ---- Highlight (green) ----------------------------------------------
    await page.getByTestId("tool-highlight").click();
    await page.getByTestId("highlight-color-green").click();
    b = await box(page);
    await page.mouse.move(b.x + b.width * 0.15, b.y + b.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.45, b.y + b.height * 0.44, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('[data-annot-kind="highlight"]')).toHaveCount(1);

    // ---- Typed signature "Sig" ------------------------------------------
    await page.getByTestId("tool-signature").click();
    await expect(page.getByTestId("sig-dialog")).toBeVisible();
    await page.getByTestId("sig-tab-type").click();
    await page.getByTestId("sig-type-input").fill("Sig");
    await page.getByTestId("sig-confirm").click();
    await expect(page.getByTestId("sig-dialog")).toBeHidden();
    await clickCanvas(page, 0.6, 0.45);
    await expect(canvas.locator("div[data-annot-id] img")).toHaveCount(1);

    // ---- Sticky note "hello" --------------------------------------------
    await page.getByTestId("tool-note").click();
    await clickCanvas(page, 0.3, 0.62);
    await expect(page.getByTestId("note-popover")).toBeVisible();
    await page.getByTestId("note-input").fill("hello");
    await expect(page.locator('[data-annot-kind="note"]')).toHaveCount(1);

    // ---- APPROVED stamp -------------------------------------------------
    await page.getByTestId("tool-stamp").click();
    await expect(page.getByTestId("stamp-dialog")).toBeVisible();
    await page.getByTestId("stamp-preset-approved").click();
    await page.getByTestId("stamp-confirm").click();
    await expect(page.getByTestId("stamp-dialog")).toBeHidden();
    await clickCanvas(page, 0.62, 0.72);
    await expect(canvas.locator('[data-annot-kind="stamp"]')).toContainText("APPROVED");

    // ---- Text field "nm" = "Bob" ----------------------------------------
    await page.getByTestId("tool-field-text").click();
    await clickCanvas(page, 0.2, 0.82);
    await expect(page.getByTestId("field-name")).toBeVisible();
    await page.getByTestId("field-name").fill("nm");
    await page.getByTestId("field-value").fill("Bob");

    // ---- Document metadata: title "Integration" -------------------------
    await page.getByTestId("metadata-open").click();
    await expect(page.getByTestId("metadata-dialog")).toBeVisible();
    await page.getByTestId("meta-title").fill("Integration");
    await page.getByTestId("metadata-apply").click();
    await expect(page.getByTestId("metadata-dialog")).toHaveCount(0);

    // Everything is placed on page 1: text, rect, highlight, signature, note,
    // stamp, and form field = 7 editable objects.
    await expect(page.locator("[data-annot-id]")).toHaveCount(7);

    // ---- Save editable copy, persist to a temp file ---------------------
    await page.getByTestId("editor-docname").fill("integration-doc");
    await expect(page.getByTestId("download-editable")).toBeEnabled();
    const [dl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("download-editable").click(),
    ]);
    const savedBytes = await fs.promises.readFile(await dl.path());
    expect(savedBytes.byteLength).toBeGreaterThan(0);
    const tmp = path.join(os.tmpdir(), `integration-${Date.now()}.pdf`);
    await fs.promises.writeFile(tmp, savedBytes);

    // ---- Reopen: the whole editable model round-trips -------------------
    await resetToEmpty(page);
    await page.getByTestId("editor-file-input").setInputFiles(tmp);

    await expect(page.getByTestId("editable-restored")).toBeVisible();
    await expect(page.locator(".react-pdf__Page").first()).toBeVisible();
    await expect(indicator).toContainText("/ 2"); // page count preserved

    // Text, rectangle rotation, stamp all restored as editable objects.
    await expect(page.locator('[data-annot-kind="text"]')).toContainText("INTEG");
    await expect(page.locator('[data-annot-rotation="30"]')).toHaveCount(1);
    await expect(page.getByTestId("editor-canvas").locator('[data-annot-kind="stamp"]')).toContainText("APPROVED");

    // The note is re-listed in the comment sidebar with its text.
    await page.getByTestId("comment-toggle").click();
    await expect(page.getByTestId("comment-sidebar")).toBeVisible();
    await expect(page.locator('[data-testid^="comment-item-"]')).toHaveCount(1);
    await expect(page.getByTestId("comment-sidebar")).toContainText("hello");

    // The form field is restored (renders on page 1 with its field-type hook).
    await expect(page.locator('[data-field-type="text"]')).toHaveCount(1);
    await expect(page.locator("[data-annot-id]")).toHaveCount(7);

    // ---- Flattened Download keeps the live form field + metadata --------
    // The standard Download flattens ANNOTATIONS into static content but leaves
    // AcroForm fields live (flatten-forms is OFF), so the field value survives.
    await expect(page.getByTestId("editor-download")).toBeEnabled();
    const [dl2] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("editor-download").click(),
    ]);
    const finalBytes = await fs.promises.readFile(await dl2.path());
    const out = await PDFDocument.load(finalBytes);
    expect(out.getPageCount()).toBe(2);
    const form = out.getForm();
    expect(form.getFields().map((f) => f.getName())).toContain("nm");
    expect(form.getTextField("nm").getText()).toBe("Bob");
    // Metadata round-tripped through the sidecar too.
    expect(out.getTitle()).toBe("Integration");

    await fs.promises.unlink(tmp).catch(() => {});
  });
});
