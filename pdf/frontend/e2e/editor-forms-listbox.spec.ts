import { expect, test, type Page } from "@playwright/test";
import { AnnotationFlags, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createRequire } from "node:module";
import fs from "node:fs";

/**
 * CC3 — list box (single/multi-select) and push button fields.
 *
 *   (a) A multi-select list box is filled on the canvas and exports as a real
 *       PDFOptionList with multiselect + both picks.
 *   (b) A single-select list box keeps exactly one pick.
 *   (c) A reset push button (Fill & Sign) clears the form and exports a native
 *       /ResetForm action.
 *   (d) A hide button hides its target; the export carries /Hide + the hidden
 *       flag, and a flattened export doesn't bake the hidden field.
 *   (e) Submit is disabled: clicking shows a message and exports no action.
 *   (f) List boxes and buttons in an existing PDF import as editable fields.
 *
 * Requires a browser. On NixOS, run within `nix develop`.
 */

const require = createRequire(import.meta.url);
GlobalWorkerOptions.workerSrc = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");

async function pageText(bytes: Uint8Array | Buffer): Promise<string> {
  const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const page = await pdf.getPage(1);
  const tc = await page.getTextContent();
  const text = tc.items.map((i) => ("str" in i ? i.str : "")).join(" ");
  await pdf.cleanup();
  return text;
}

// The /A action dictionary on a button's first widget.
function buttonAction(doc: PDFDocument, name: string): PDFDict | undefined {
  const w = doc.getForm().getButton(name).acroField.getWidgets()[0];
  const a = w.dict.lookup(PDFName.of("A"));
  return a instanceof PDFDict ? a : undefined;
}

test.describe("PDF Editor - list box + push button fields (CC3)", () => {
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

  // Place a field with a tool; it stays selected so the properties panel is open.
  async function placeField(page: Page, tool: string, fx: number, fy: number, name: string) {
    await page.getByTestId(tool).click();
    const canvas = page.getByTestId("editor-canvas");
    const b = (await canvas.boundingBox())!;
    await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
    await expect(page.getByTestId("field-name")).toBeVisible();
    await page.getByTestId("field-name").fill(name);
  }

  const field = (page: Page, name: string) => page.locator(`[data-field-name="${name}"]`);
  const option = (page: Page, name: string, label: string) => field(page, name).getByRole("option", { name: label, exact: true });

  async function download(page: Page): Promise<Buffer> {
    await expect(page.getByTestId("editor-download")).toBeEnabled();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("editor-download").click()]);
    return fs.promises.readFile(await dl.path());
  }

  test("(a) multi-select list box fills on the canvas and exports both picks", async ({ page }) => {
    await openBlank(page);
    await placeField(page, "tool-field-listbox", 0.2, 0.15, "colors");
    await page.getByTestId("field-options").fill("Red, Green, Blue");
    await page.getByTestId("field-multiselect").check();
    await page.getByTestId("tool-select").click();

    await option(page, "colors", "Red").click();
    await option(page, "colors", "Blue").click();
    await expect(option(page, "colors", "Red")).toHaveAttribute("aria-selected", "true");
    await expect(option(page, "colors", "Green")).toHaveAttribute("aria-selected", "false");
    await expect(option(page, "colors", "Blue")).toHaveAttribute("aria-selected", "true");
    // Clicking a picked option again un-picks it (multi-select toggles).
    await option(page, "colors", "Red").click();
    await expect(option(page, "colors", "Red")).toHaveAttribute("aria-selected", "false");
    await option(page, "colors", "Green").click();

    const out = await PDFDocument.load(await download(page));
    const lb = out.getForm().getOptionList("colors");
    expect(lb.isMultiselect()).toBe(true);
    expect(lb.getOptions()).toEqual(["Red", "Green", "Blue"]);
    expect([...lb.getSelected()].sort()).toEqual(["Blue", "Green"]);
    expect(lb.acroField.getWidgets()).toHaveLength(1);
  });

  test("(b) single-select list box keeps exactly one pick", async ({ page }) => {
    await openBlank(page);
    await placeField(page, "tool-field-listbox", 0.2, 0.15, "size");
    await page.getByTestId("field-options").fill("S, M, L");
    await page.getByTestId("tool-select").click();
    await option(page, "size", "M").click();
    await option(page, "size", "L").click();
    await expect(option(page, "size", "M")).toHaveAttribute("aria-selected", "false");
    await expect(option(page, "size", "L")).toHaveAttribute("aria-selected", "true");

    const out = await PDFDocument.load(await download(page));
    const lb = out.getForm().getOptionList("size");
    expect(lb.isMultiselect()).toBe(false);
    expect(lb.getSelected()).toEqual(["L"]);
  });

  test("(c) reset button clears the form in Fill & Sign and exports /ResetForm", async ({ page }) => {
    await openBlank(page);
    await placeField(page, "tool-field-text", 0.2, 0.1, "name");
    await page.getByTestId("field-value").fill("Jane");
    await placeField(page, "tool-field-check", 0.2, 0.2, "agree");
    await page.getByTestId("field-value").check();
    await placeField(page, "tool-field-listbox", 0.2, 0.3, "pick");
    await page.getByTestId("field-value").selectOption("Option 2");
    await placeField(page, "tool-field-button", 0.2, 0.5, "resetBtn");
    await expect(page.getByTestId("field-button-action")).toHaveValue("reset");
    await page.getByTestId("field-label").fill("Clear all");
    await page.getByTestId("tool-select").click();
    await expect(field(page, "resetBtn")).toContainText("Clear all");

    // Outside Fill & Sign a click only selects the button.
    await field(page, "resetBtn").click();
    await expect(field(page, "name").locator("input")).toHaveValue("Jane");

    await page.getByTestId("toggle-fillsign").click();
    await field(page, "resetBtn").click();
    await expect(page.getByTestId("form-action-message")).toContainText("Form reset");
    await expect(field(page, "name").locator("input")).toHaveValue("");
    await expect(field(page, "agree")).not.toContainText("✓");
    await expect(option(page, "pick", "Option 2")).toHaveAttribute("aria-selected", "false");

    const out = await PDFDocument.load(await download(page));
    const btn = out.getForm().getButton("resetBtn");
    expect(btn.acroField.getWidgets()[0].getAppearanceCharacteristics()?.getCaptions()?.normal).toBe("Clear all");
    const a = buttonAction(out, "resetBtn")!;
    expect(a.lookup(PDFName.of("S"))).toEqual(PDFName.of("ResetForm"));
  });

  test("(d) hide button hides its target; export carries /Hide + hidden flag; flatten skips it", async ({ page }) => {
    await openBlank(page);
    await placeField(page, "tool-field-text", 0.2, 0.1, "secret");
    await page.getByTestId("field-value").fill("TOPSECRETVALUE");
    await placeField(page, "tool-field-text", 0.2, 0.2, "visible");
    await page.getByTestId("field-value").fill("PLAINVALUE");
    await placeField(page, "tool-field-button", 0.2, 0.4, "hider");
    await page.getByTestId("field-button-action").selectOption("hide");
    await page.getByTestId("field-button-targets").fill("secret");
    await page.getByTestId("tool-select").click();
    await page.getByTestId("toggle-fillsign").click();
    await field(page, "hider").click();
    await expect(field(page, "secret")).toHaveAttribute("data-field-hidden", "true");
    await expect(field(page, "visible")).not.toHaveAttribute("data-field-hidden", "true");

    const out = await PDFDocument.load(await download(page));
    const a = buttonAction(out, "hider")!;
    expect(a.lookup(PDFName.of("S"))).toEqual(PDFName.of("Hide"));
    const t = a.lookup(PDFName.of("T"), PDFArray);
    expect((t.lookup(0) as PDFHexString | PDFString).decodeText()).toBe("secret");
    const w = out.getForm().getTextField("secret").acroField.getWidgets()[0];
    expect(w.hasFlag(AnnotationFlags.Hidden)).toBe(true);

    await page.getByTestId("flatten-forms").check();
    const text = await pageText(await download(page));
    expect(text).toContain("PLAINVALUE");
    expect(text).not.toContain("TOPSECRETVALUE");
  });

  test("(e) submit is disabled: a message, and no action on export", async ({ page }) => {
    await openBlank(page);
    await placeField(page, "tool-field-button", 0.2, 0.3, "send");
    await page.getByTestId("field-button-action").selectOption("submit");
    await page.getByTestId("tool-select").click();
    await page.getByTestId("toggle-fillsign").click();
    await field(page, "send").click();
    await expect(page.getByTestId("form-action-message")).toContainText("Submitting forms is disabled");
    const out = await PDFDocument.load(await download(page));
    expect(buttonAction(out, "send")).toBeUndefined();
  });

  test("(f) list boxes and buttons in an existing PDF import as editable fields", async ({ page }) => {
    const doc = await PDFDocument.create();
    const p = doc.addPage([612, 792]);
    const form = doc.getForm();
    const lb = form.createOptionList("fruit");
    lb.addOptions(["Apple", "Banana", "Cherry"]);
    lb.enableMultiselect();
    lb.select(["Apple", "Cherry"]);
    lb.addToPage(p, { x: 72, y: 600, width: 200, height: 80 });
    const tf = form.createTextField("note");
    tf.setText("hello");
    tf.addToPage(p, { x: 72, y: 540, width: 200, height: 24 });
    const btn = form.createButton("toggleNote");
    btn.addToPage("Toggle", p, { x: 72, y: 480, width: 100, height: 30 });
    const act = doc.context.obj({});
    act.set(PDFName.of("S"), PDFName.of("JavaScript"));
    act.set(
      PDFName.of("JS"),
      PDFString.of('var f = this.getField("note"); f.display = (f.display == display.hidden) ? display.visible : display.hidden;'),
    );
    btn.acroField.getWidgets()[0].dict.set(PDFName.of("A"), act);
    const bytes = Buffer.from(await doc.save());

    await page.goto("/editor");
    await page.getByTestId("editor-file-input").setInputFiles({ name: "imp.pdf", mimeType: "application/pdf", buffer: bytes });
    await expect(page.getByTestId("form-action-message")).toContainText("Imported 3 form fields");
    await expect(option(page, "fruit", "Apple")).toHaveAttribute("aria-selected", "true");
    await expect(option(page, "fruit", "Banana")).toHaveAttribute("aria-selected", "false");
    await expect(option(page, "fruit", "Cherry")).toHaveAttribute("aria-selected", "true");
    await expect(field(page, "toggleNote")).toContainText("Toggle");

    // The imported toggle action works in Fill & Sign (twice = visible again).
    await page.getByTestId("toggle-fillsign").click();
    await field(page, "toggleNote").click();
    await expect(field(page, "note")).toHaveAttribute("data-field-hidden", "true");
    await field(page, "toggleNote").click();
    await expect(field(page, "note")).not.toHaveAttribute("data-field-hidden", "true");

    // Its properties show the recognised action.
    await page.getByTestId("toggle-fillsign").click();
    await field(page, "toggleNote").click();
    await expect(page.getByTestId("field-button-action")).toHaveValue("toggle");
    await expect(page.getByTestId("field-button-targets")).toHaveValue("note");

    // Re-export: fields exist once each (base bytes no longer carry the originals).
    const out = await PDFDocument.load(await download(page));
    const names = out.getForm().getFields().map((f) => f.getName()).sort();
    expect(names).toEqual(["fruit", "note", "toggleNote"]);
    expect([...out.getForm().getOptionList("fruit").getSelected()].sort()).toEqual(["Apple", "Cherry"]);
  });
});
