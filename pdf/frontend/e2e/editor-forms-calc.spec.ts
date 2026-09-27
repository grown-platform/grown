import { expect, test, type Page } from "@playwright/test";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFString, type PDFField } from "pdf-lib";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createRequire } from "node:module";
import fs from "node:fs";

/**
 * CC3 — calculated form fields + AF* formats in the /editor.
 *
 *   (a) OnlyOffice's calculate-action chain (tests/pdf/forms/actions.js),
 *       driven through the UI on a PDF whose fields carry /AA /C scripts.
 *   (b) A total field built in the editor (Sum of fields + currency format)
 *       computes on commit; the live export keeps /AA C/F/K and /CO, and the
 *       flattened export bakes the formatted computed value.
 *   (c) The live export reopens with its actions intact and keeps computing.
 *   (d) Imported /AcroForm /CO order wins over document order.
 *   (e) Date/percent formats apply on blur; number keystrokes are filtered.
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

// Build a one-page PDF with text fields carrying /AA /C calculate scripts
// (and optionally a /CO order), the way Acrobat stores them.
async function buildCalcPdf(
  fields: { name: string; value: string; calc?: string }[],
  co?: string[],
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  const byName = new Map<string, PDFField>();
  fields.forEach((f, i) => {
    const tf = form.createTextField(f.name);
    tf.setText(f.value);
    tf.addToPage(page, { x: 72, y: 700 - i * 50, width: 200, height: 24 });
    if (f.calc) {
      const action = doc.context.obj({});
      action.set(PDFName.of("S"), PDFName.of("JavaScript"));
      action.set(PDFName.of("JS"), PDFString.of(f.calc));
      const aa = doc.context.obj({});
      aa.set(PDFName.of("C"), action);
      tf.acroField.dict.set(PDFName.of("AA"), aa);
    }
    byName.set(f.name, tf);
  });
  if (co) form.acroForm.dict.set(PDFName.of("CO"), doc.context.obj(co.map((n) => byName.get(n)!.ref)));
  return Buffer.from(await doc.save());
}

// Read a field's /AA script for a trigger from exported bytes.
function aaScript(doc: PDFDocument, fieldName: string, key: string): string {
  const f = doc.getForm().getField(fieldName);
  const aa = f.acroField.dict.lookup(PDFName.of("AA"), PDFDict);
  const a = aa.lookup(PDFName.of(key), PDFDict);
  const js = a.lookup(PDFName.of("JS"));
  return js && "decodeText" in js ? (js as PDFString).decodeText() : "";
}

test.describe("PDF Editor - calculated fields (CC3)", () => {
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

  async function openPdf(page: Page, bytes: Buffer, name = "form.pdf") {
    await page.goto("/editor");
    await page.getByTestId("editor-file-input").setInputFiles({ name, mimeType: "application/pdf", buffer: bytes });
    await expect(page.locator(".react-pdf__Page")).toBeVisible();
  }

  async function placeField(page: Page, tool: string, fx: number, fy: number, name: string) {
    await page.getByTestId(tool).click();
    const canvas = page.getByTestId("editor-canvas");
    const b = (await canvas.boundingBox())!;
    await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
    await expect(page.getByTestId("field-name")).toBeVisible();
    await page.getByTestId("field-name").fill(name);
    await page.getByTestId("tool-select").click();
  }

  const input = (page: Page, name: string) => page.locator(`[data-field-name="${name}"] input`);

  // Type into an on-canvas text field and commit it (Enter blurs = commit).
  async function typeInto(page: Page, name: string, text: string, append = false) {
    const el = input(page, name);
    await el.click();
    if (append) await el.press("End");
    else await el.fill("");
    await el.pressSequentially(text);
    await el.press("Enter");
  }

  async function download(page: Page, testId = "editor-download"): Promise<Buffer> {
    await expect(page.getByTestId(testId)).toBeEnabled();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId(testId).click()]);
    return fs.promises.readFile(await dl.path());
  }

  test("(a) imported calculate chain typed in the editor — oo:pdf/forms/actions.js#Test calculate action", async ({ page }) => {
    const pdf = await buildCalcPdf([
      { name: "TextForm1", value: "1", calc: "this.getField('TextForm2').value += 1" },
      { name: "TextForm2", value: "2", calc: "this.getField('TextForm3').value += 1" },
      { name: "TextForm3", value: "3", calc: "this.getField('TextForm1').value += 1" },
    ]);
    await openPdf(page, pdf);
    await expect(page.getByTestId("form-action-message")).toContainText("Imported 3 form fields");
    await expect(input(page, "TextForm1")).toHaveValue("1");
    await expect(input(page, "TextForm2")).toHaveValue("2");
    await expect(input(page, "TextForm3")).toHaveValue("3");

    await typeInto(page, "TextForm2", "2", true);
    await expect(input(page, "TextForm1")).toHaveValue("2");
    await expect(input(page, "TextForm2")).toHaveValue("22");
    await expect(input(page, "TextForm3")).toHaveValue("4");

    await typeInto(page, "TextForm3", "3", true);
    await expect(input(page, "TextForm1")).toHaveValue("3");
    await expect(input(page, "TextForm2")).toHaveValue("23");
    await expect(input(page, "TextForm3")).toHaveValue("43");
  });

  test("(b) Sum total with currency format computes, exports actions + /CO, flattens the computed value", async ({ page }) => {
    await openBlank(page);
    await placeField(page, "tool-field-text", 0.2, 0.12, "subtotal");
    await placeField(page, "tool-field-text", 0.2, 0.22, "shipping");
    await placeField(page, "tool-field-text", 0.2, 0.32, "total");

    // total = SUM(subtotal, shipping), formatted as $ with 2 decimals.
    await page.locator('[data-field-name="total"]').click();
    await page.getByTestId("field-calc").selectOption("SUM");
    await page.getByTestId("field-calc-fields").fill("subtotal, shipping");
    await page.getByTestId("field-format").selectOption("number");
    await page.getByTestId("field-format-currency").fill("$");
    await expect(input(page, "total")).toHaveValue("$0.00");

    await typeInto(page, "subtotal", "1200");
    await typeInto(page, "shipping", "34.5");
    await expect(input(page, "total")).toHaveValue("$1,234.50");
    await expect(input(page, "total")).toHaveAttribute("data-raw-value", "1234.5");
    await expect(page.locator('[data-field-name="total"]')).toHaveAttribute("data-field-calc", "true");

    if (process.env.CC3_SCREENSHOT) {
      // Select the total (opens its Format/Calculate panel), then blur it so
      // the field shows its formatted display value.
      await input(page, "total").click();
      await input(page, "total").evaluate((el) => (el as HTMLInputElement).blur());
      await expect(input(page, "total")).toHaveValue("$1,234.50");
      await page.getByTestId("field-calc-panel").scrollIntoViewIfNeeded();
      await page.screenshot({ path: process.env.CC3_SCREENSHOT, fullPage: false });
    }

    // Live export: raw value in /V, AFSimple_Calculate + AFNumber_* in /AA, /CO lists total.
    const live = await PDFDocument.load(await download(page));
    const form = live.getForm();
    expect(form.getTextField("total").getText()).toBe("1234.5");
    // Regression: text fields used to export without a widget (setFontSize
    // before addToPage threw and was swallowed).
    expect(form.getTextField("total").acroField.getWidgets()).toHaveLength(1);
    expect(form.getTextField("subtotal").getText()).toBe("1200");
    expect(aaScript(live, "total", "C")).toBe('AFSimple_Calculate("SUM", new Array("subtotal", "shipping"));');
    expect(aaScript(live, "total", "F")).toContain("AFNumber_Format(2, 0, 0, 0, \"$\", true)");
    expect(aaScript(live, "total", "K")).toContain("AFNumber_Keystroke(");
    const co = form.acroForm.dict.lookup(PDFName.of("CO"), PDFArray);
    expect(co.size()).toBe(1);
    expect((co.get(0) as PDFRef).toString()).toBe(form.getTextField("total").ref.toString());

    // Flattened: no live fields, the computed, formatted total is baked in.
    await page.getByTestId("flatten-forms").check();
    const flat = await download(page);
    expect((await PDFDocument.load(flat)).getForm().getFields()).toHaveLength(0);
    const text = await pageText(flat);
    expect(text).toContain("$1,234.50");
    expect(text).toContain("1200"); // subtotal (unformatted) as entered
  });

  test("(c) the live export reopens with its calculate action and keeps computing", async ({ page }) => {
    await openBlank(page);
    await placeField(page, "tool-field-text", 0.2, 0.12, "qty");
    await placeField(page, "tool-field-text", 0.2, 0.22, "price");
    await placeField(page, "tool-field-text", 0.2, 0.32, "amount");
    await page.locator('[data-field-name="amount"]').click();
    await page.getByTestId("field-calc").selectOption("sfn");
    await page.getByTestId("field-calc-expr").fill("qty * price");
    await typeInto(page, "qty", "3");
    await typeInto(page, "price", "2.5");
    await expect(input(page, "amount")).toHaveValue("7.5");

    const bytes = await download(page);
    const live = await PDFDocument.load(bytes);
    expect(aaScript(live, "amount", "C")).toContain("BVCALC qty * price EVCALC");

    // Reopen the exported PDF: its AcroForm is imported with the action.
    await openPdf(page, bytes, "reopen.pdf");
    await expect(page.getByTestId("form-action-message")).toContainText("Imported 3 form fields");
    await expect(input(page, "amount")).toHaveValue("7.5");
    await typeInto(page, "qty", "4");
    await expect(input(page, "amount")).toHaveValue("10");
    // The properties panel recognises the imported notation.
    await page.locator('[data-field-name="amount"]').click();
    await expect(page.getByTestId("field-calc")).toHaveValue("sfn");
    await expect(page.getByTestId("field-calc-expr")).toHaveValue("qty * price");
  });

  test("(d) the imported /AcroForm /CO calculation order wins over document order", async ({ page }) => {
    // Document order puts c before b; /CO says b then c, so c sees the new b.
    const pdf = await buildCalcPdf(
      [
        { name: "a", value: "" },
        { name: "c", value: "", calc: 'event.value = this.getField("b").value * 10;' },
        { name: "b", value: "", calc: 'event.value = AFMakeNumber(getField("a").value) + 1;' },
      ],
      ["b", "c"],
    );
    await openPdf(page, pdf);
    await typeInto(page, "a", "5");
    await expect(input(page, "b")).toHaveValue("6");
    await expect(input(page, "c")).toHaveValue("60");
    await page.locator('[data-field-name="b"]').click();
    await expect(page.getByTestId("field-calc-order")).toHaveValue("1");
  });

  test("(e) date + percent formats apply on blur; number keystrokes are filtered", async ({ page }) => {
    await openBlank(page);
    const select = (name: string) => page.locator(`[data-field-name="${name}"]`).click();
    await placeField(page, "tool-field-text", 0.2, 0.12, "when");
    await select("when");
    await page.getByTestId("field-format").selectOption("date");
    await page.getByTestId("field-format-date").selectOption("mmm d, yyyy");
    await placeField(page, "tool-field-text", 0.2, 0.22, "rate");
    await select("rate");
    await page.getByTestId("field-format").selectOption("percent");
    await page.getByTestId("field-format-decimals").fill("1");
    await placeField(page, "tool-field-text", 0.2, 0.32, "count");
    await select("count");
    await page.getByTestId("field-format").selectOption("number");
    await page.getByTestId("field-format-decimals").fill("0");

    await typeInto(page, "when", "3/7/2026");
    await expect(input(page, "when")).toHaveValue("Mar 7, 2026");

    await typeInto(page, "rate", "12.5%");
    await expect(input(page, "rate")).toHaveValue("12.5%");
    await expect(input(page, "rate")).toHaveAttribute("data-raw-value", "0.125");

    await typeInto(page, "count", "12ab3");
    await expect(input(page, "count")).toHaveAttribute("data-raw-value", "123");
    await expect(input(page, "count")).toHaveValue("123");

    // A value that can't be a date is kept but flagged.
    await typeInto(page, "when", "not a date");
    await expect(page.getByTestId("form-action-message")).toContainText("doesn't match the format");
    await expect(input(page, "when")).toHaveValue("not a date");
  });
});
