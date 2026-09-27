import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, trashDoc } from "../helpers";
import { zip } from "./zip";

// Playwright port of OnlyOffice word/forms/complexForm.js "Check mouse
// clicks" (behaviour only): in the fill-in view a double click inside a
// sub-field selects that field, a triple click anywhere in a complex form
// selects the whole form, and a double click on the form's own text
// selects a word. The complex form "111<abc def>222<ABC DEF>333 444" comes
// from a generated .docx protected for filling forms.

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:gf="urn:grown:docs:forms:2026"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CT = "application/vnd.openxmlformats-officedocument.wordprocessingml";
const r = (t: string) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;
const sub = (id: number, text: string) =>
  `<w:sdt><w:sdtPr><w:id w:val="${id}"/><w:text/><gf:pr gf:json='{"form":{"key":"f${id}"}}'/></w:sdtPr><w:sdtContent>${r(text)}</w:sdtContent></w:sdt>`;

function complexDocx(): Buffer {
  const body =
    `<w:p><w:sdt><w:sdtPr><w:id w:val="1"/><gf:pr gf:json='{"type":"complex","form":{"key":"c"}}'/></w:sdtPr><w:sdtContent>` +
    `${r("111")}${sub(2, "abc def")}${r("222")}${sub(3, "ABC DEF")}${r("333 444")}` +
    `</w:sdtContent></w:sdt></w:p>`;
  return zip({
    "[Content_Types].xml": `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${CT}.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="${CT}.settings+xml"/></Types>`,
    "_rels/.rels": `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/_rels/document.xml.rels": `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/settings" Target="settings.xml"/></Relationships>`,
    "word/document.xml": `${DECL}<w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`,
    "word/settings.xml": `${DECL}<w:settings ${W}><w:documentProtection w:edit="forms" w:enforcement="1"/></w:settings>`,
  });
}

const editor = (page: Page) => page.locator(".ProseMirror:not(.margin-editor .ProseMirror)").first();
const selected = (page: Page) => page.evaluate(() => window.getSelection()?.toString() ?? "");

/** Centre of the first occurrence of `needle` in the editor's text. */
async function pointOf(page: Page, needle: string): Promise<{ x: number; y: number }> {
  return page.evaluate((n) => {
    const root = document.querySelector(".ProseMirror:not(.margin-editor .ProseMirror)")!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const i = (t.textContent ?? "").indexOf(n);
      if (i < 0) continue;
      const range = document.createRange();
      range.setStart(t, i);
      range.setEnd(t, i + n.length);
      const b = range.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }
    throw new Error(`${n} not found`);
  }, needle);
}

test.describe.serial("OnlyOffice complex form ports", () => {
  test("oo:word/forms/complexForm.js#Check mouse clicks", async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await page.getByTestId("tile-docs").click();
    await page.getByTestId("docs-import-input").setInputFiles({ name: "complex.docx", mimeType: `${CT}.document`, buffer: complexDocx() });
    await page.waitForURL(/\/docs\/d\/[^/]+$/, { timeout: 20_000 });
    const id = page.url().split("/").pop()!;
    try {
      await expect(page.getByTestId("collab-status")).toHaveText("connected", { timeout: 15_000 });
      await expect(editor(page)).toContainText("111abc def222ABC DEF333 444");
      await expect(page.getByTestId("forms-fill-bar")).toBeVisible();

      let p = await pointOf(page, "abc");
      await page.mouse.dblclick(p.x, p.y);
      await page.waitForTimeout(100);
      expect(await selected(page), "double click in the first sub-field").toBe("abc def");
      await page.mouse.click(p.x, p.y, { clickCount: 3 });
      await page.waitForTimeout(100);
      expect(await selected(page), "triple click in a sub-field").toBe("111abc def222ABC DEF333 444");

      p = await pointOf(page, "333");
      await page.mouse.dblclick(p.x, p.y);
      await page.waitForTimeout(100);
      expect((await selected(page)).trim(), "double click outside the sub-fields: a word").toBe("333");
      await page.mouse.click(p.x, p.y, { clickCount: 3 });
      await page.waitForTimeout(100);
      expect(await selected(page), "triple click outside the sub-fields").toBe("111abc def222ABC DEF333 444");
    } finally {
      await trashDoc(page.request, id);
    }
  });
});
