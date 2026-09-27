import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, createDoc, trashDoc } from "./helpers";
import { openDoc } from "./docs/helpers";

// Docs M13: spell check (worker, squiggles, suggestions menu, add to
// dictionary, language, on/off), the symbol table, the shared font
// bundle rendering an imported Calibri .docx with Carlito, non-printing
// characters, header/footer navigation keys and the status bar's page in
// view. Set DOCS_M13_SHOTS to a directory to save screenshots.

const SHOTS = process.env.DOCS_M13_SHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/docs-m13-${name}.png` });
};
const editor = (page: Page) => page.locator(".ProseMirror:not(.margin-editor .ProseMirror)").first();
const menu = async (page: Page, top: string, item: string) => {
  await page.getByRole("button", { name: top, exact: true }).click();
  await page.getByTestId(item).click();
};

// A word no dictionary has, different on every run (the personal
// dictionary is per user and persists).
const uniqueWord = () => `Zorblax${Array.from({ length: 5 }, () => "bcdfghjklmnpqrstvwxz"[Math.floor(Math.random() * 20)]).join("")}`;

test.describe.serial("docs spell check and M13 (M13)", () => {
  test("squiggles, suggestions, add to dictionary, language, toggle", async ({ page }) => {
    test.setTimeout(90_000);
    const id = await createDoc(page.request, "e2e spell");
    try {
      await openDoc(page, id);
      const word = uniqueWord();
      await editor(page).click();
      await page.keyboard.type(`This sentance has teh errors and ${word} too. `);
      const errors = editor(page).locator(".spell-error");
      await expect(errors).toHaveCount(3, { timeout: 15_000 });
      await expect(errors.nth(0)).toHaveText("sentance");
      await expect(errors.nth(0)).toHaveCSS("text-decoration-style", "wavy");
      await expect(page.getByTestId("status-spelling")).toHaveText("3 spelling errors");
      await expect(page.getByTestId("status-language")).toHaveText("English (United States)");
      await shot(page, "spell-squiggles");

      // Right-click: suggestions first.
      await errors.nth(0).click({ button: "right" });
      const suggestions = page.getByTestId("spell-suggestion");
      await expect(suggestions.first()).toHaveText("sentence", { timeout: 10_000 });
      await shot(page, "spell-menu");
      await suggestions.first().click();
      await expect(editor(page)).toContainText("This sentence has teh errors");
      await expect(errors).toHaveCount(2);

      // Add to dictionary: the made-up word stops being flagged, also after a reload.
      await editor(page).locator(".spell-error", { hasText: word }).click({ button: "right" });
      await page.getByTestId("spell-add").click();
      await expect(errors).toHaveCount(1);
      await expect(errors.first()).toHaveText("teh");
      await page.reload();
      await expect(editor(page)).toContainText("This sentence");
      await expect(editor(page).locator(".spell-error")).toHaveCount(1, { timeout: 15_000 });

      // Ignore all.
      await editor(page).locator(".spell-error").first().click({ button: "right" });
      await page.getByTestId("spell-ignore-all").click();
      await expect(editor(page).locator(".spell-error")).toHaveCount(0);

      // A paragraph in French (no French dictionary: not checked), then
      // back to US English with a new error.
      await editor(page).click();
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      await page.keyboard.type("Bonjour tout le monde ");
      await expect(editor(page).locator(".spell-error")).toHaveCount(3, { timeout: 10_000 });
      await menu(page, "Tools", "tools-language");
      await page.getByRole("combobox", { name: "Text language" }).click();
      await page.getByRole("option", { name: /French \(France\)/ }).click();
      await page.getByTestId("language-ok").click();
      await expect(editor(page).locator('span[lang="fr-FR"]')).toHaveText("Bonjour tout le monde ");
      await expect(editor(page).locator(".spell-error")).toHaveCount(0);

      // Typing on keeps the run's language (as in Word): still not checked.
      await page.keyboard.type("qwzzxv ");
      await expect(editor(page).locator(".spell-error")).toHaveCount(0);
      // Spell check off and on (per user), on an English paragraph.
      const first = editor(page).locator("p").first();
      const box = (await first.boundingBox())!;
      await first.click({ position: { x: box.width - 4, y: box.height / 2 } }); // right of the text: line end
      await page.keyboard.type(" Anothr ");
      await expect(editor(page).locator(".spell-error")).toHaveCount(1, { timeout: 10_000 });
      await menu(page, "Tools", "tools-spellcheck-toggle");
      await expect(editor(page).locator(".spell-error")).toHaveCount(0);
      await expect(page.getByTestId("status-spelling")).toHaveText("Spelling off");
      await menu(page, "Tools", "tools-spellcheck-toggle");
      await expect(editor(page).locator(".spell-error")).toHaveCount(1, { timeout: 10_000 });
    } finally {
      await trashDoc(page.request, id);
    }
  });

  test("symbol table, date & time, drop cap, statistics, non-printing characters", async ({ page }) => {
    test.setTimeout(60_000);
    const id = await createDoc(page.request, "e2e symbols");
    try {
      await openDoc(page, id);
      await editor(page).click();
      await page.keyboard.type("Arrow ");
      await menu(page, "Insert", "insert-symbol");
      const dlg = page.getByTestId("symbol-dialog");
      await expect(dlg).toBeVisible();
      await page.getByTestId("symbol-dialog").getByRole("combobox", { name: /Subset/ }).click();
      await page.getByRole("option", { name: "Arrows", exact: true }).click();
      await dlg.locator('[data-cp="8594"]').first().click(); // →
      await expect(page.getByTestId("symbol-preview")).toHaveText("→");
      await page.getByTestId("symbol-code").fill("2665"); // ♥ by hex code
      await expect(page.getByTestId("symbol-preview")).toHaveText("♥");
      await shot(page, "symbol");
      await page.getByTestId("symbol-insert").click();
      await expect(page.getByTestId("symbol-recent")).toContainText("♥");
      await page.keyboard.press("Escape");
      await expect(editor(page)).toContainText("Arrow ♥");

      await menu(page, "Insert", "insert-datetime");
      await page.getByTestId("datetime-format").nth(4).click(); // yyyy-MM-dd
      await page.getByTestId("datetime-ok").click();
      await expect(editor(page)).toContainText(/Arrow ♥\d{4}-\d\d-\d\d/);

      await page.keyboard.press("Enter");
      await page.keyboard.type("Once upon a time, a document had a drop cap.");
      await menu(page, "Insert", "insert-dropcap");
      await page.getByTestId("dropcap-ok").click();
      await expect(editor(page).locator('p[data-drop-cap="drop"]')).toHaveCount(1);
      // The first letter spans three lines (CSS initial-letter).
      const initial = await editor(page).locator('p[data-drop-cap="drop"]').evaluate((p) => getComputedStyle(p, "::first-letter").getPropertyValue("initial-letter"));
      expect(initial.trim()).toMatch(/^3/);
      await expect(page.getByTestId("status-words")).toHaveText("12 words");

      await menu(page, "Tools", "tools-stats");
      await expect(page.getByTestId("stats-words")).toContainText("12");
      await expect(page.getByTestId("stats-paragraphs")).toContainText("2");
      await expect(page.getByTestId("stats-pages")).toContainText("1");
      await page.keyboard.press("Escape");

      await menu(page, "View", "view-nonprinting");
      await expect(editor(page).locator(".np-para")).toHaveCount(2);
      expect(await editor(page).locator(".np-space").count()).toBeGreaterThan(8);
      await page.keyboard.press("Control+Alt+Shift+8");
      await expect(editor(page).locator(".np-para")).toHaveCount(0);
    } finally {
      await trashDoc(page.request, id);
    }
  });

  test("header/footer navigation keys and the status bar page in view", async ({ page }) => {
    test.setTimeout(90_000);
    const id = await createDoc(page.request, "e2e hf nav");
    try {
      await openDoc(page, id);
      await editor(page).click();
      const para = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore. ".repeat(6);
      await page.evaluate((h) => {
        const dt = new DataTransfer();
        dt.setData("text/html", h);
        dt.setData("text/plain", "x");
        document.querySelector(".ProseMirror")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      }, Array.from({ length: 30 }, (_, i) => `<p>Paragraph ${i + 1}. ${para}</p>`).join(""));
      await expect.poll(() => page.locator(".doc-pages .doc-page").count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(4);
      const total = await page.locator(".doc-pages .doc-page").count();

      // The status bar follows the page in view, not the caret (at the end
      // of the pasted text, on the last pages).
      await page.locator('.doc-page[data-page="1"]').evaluate((el) => el.scrollIntoView({ block: "center" }));
      await expect(page.getByTestId("status-page")).toHaveText(`Page 1 of ${total}`);
      await page.locator('.doc-page[data-page="3"]').evaluate((el) => el.scrollIntoView({ block: "center" }));
      await expect(page.getByTestId("status-page")).toHaveText(`Page 3 of ${total}`);
      await page.locator('.doc-page[data-page="1"]').evaluate((el) => el.scrollIntoView({ block: "center" }));
      await expect(page.getByTestId("status-page")).toHaveText(`Page 1 of ${total}`);

      // Open page 1's header, then walk: PageDown -> page 1 footer -> page 2
      // header; Alt+PageUp -> page 1 header; Escape -> the body.
      await page.getByRole("button", { name: "Insert", exact: true }).click();
      await page.getByRole("menuitem", { name: "Headers & footers", exact: true }).click();
      const header1 = page.locator('.doc-hf--header[data-page="1"] .ProseMirror');
      await header1.click();
      await page.keyboard.type("Head");
      const focused = () =>
        page.evaluate(() => {
          const hf = document.activeElement?.closest(".doc-hf") as HTMLElement | null;
          if (!hf) return document.activeElement?.closest(".margin-editor") ? "margin" : "body";
          return `${hf.classList.contains("doc-hf--header") ? "header" : "footer"}:${hf.dataset.page}`;
        });
      await expect.poll(focused).toBe("header:1");
      await page.keyboard.press("PageDown");
      await expect.poll(focused).toBe("footer:1");
      await page.keyboard.press("PageDown");
      await expect.poll(focused).toBe("header:2");
      await page.keyboard.press("Alt+PageUp");
      await expect.poll(focused).toBe("header:1");
      await page.keyboard.press("Escape");
      await expect.poll(focused).toBe("body");
    } finally {
      await trashDoc(page.request, id);
    }
  });

  test("an imported Calibri .docx renders with Carlito metrics", async ({ page }) => {
    test.setTimeout(60_000);
    let id = "";
    try {
      await page.goto(`${BASE_URL}/`);
      await page.getByTestId("tile-docs").click();
      await expect(page.getByTestId("docs-import")).toBeVisible();
      await page.getByTestId("docs-import-input").setInputFiles({
        name: "Calibri report.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: calibriDocx(),
      });
      await page.waitForURL(/\/docs\/d\/[^/]+$/, { timeout: 20_000 });
      id = page.url().split("/").pop()!;
      const run = editor(page).locator("span", { hasText: "Quarterly figures in Calibri" }).first();
      await expect(run).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("status-words")).toHaveText("15 words");
      // The document keeps its font name…
      expect(await run.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Calibri");
      // …and the Calibri face the bundle declares (local Calibri, else Carlito) is loaded.
      await expect
        .poll(() => page.evaluate(() => [...document.fonts].some((f) => f.family.replace(/"/g, "") === "Calibri" && f.status === "loaded")), { timeout: 10_000 })
        .toBe(true);
      // Same advance widths as Carlito (metric-compatible either way).
      const widths = await run.evaluate((el) => {
        const probe = (family: string) => {
          const s = document.createElement("span");
          s.textContent = el.textContent;
          s.style.cssText = `font-family:${family};font-size:22px;white-space:pre;position:absolute;visibility:hidden`;
          document.body.appendChild(s);
          const w = s.getBoundingClientRect().width;
          s.remove();
          return w;
        };
        return { calibri: probe("Calibri"), carlito: probe("Carlito"), serif: probe("serif") };
      });
      expect(Math.abs(widths.calibri - widths.carlito)).toBeLessThan(1);
      expect(Math.abs(widths.calibri - widths.serif)).toBeGreaterThan(2);
      await shot(page, "calibri-carlito");
    } finally {
      if (id) await trashDoc(page.request, id);
    }
  });
});

// --- a minimal .docx using Calibri (stored zip) ------------------------------------
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, "utf8");
    const fname = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(fname.length, 26);
    locals.push(h, fname, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(fname.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, fname);
    offset += 30 + fname.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

function calibriDocx(): Buffer {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const rPr = '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="44"/></w:rPr>';
  const body =
    `<w:p><w:r>${rPr}<w:t>Quarterly figures in Calibri</w:t></w:r></w:p>` +
    `<w:p><w:r><w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria"/><w:sz w:val="28"/></w:rPr><w:t>A Cambria line rendered with Caladea.</w:t></w:r></w:p>` +
    `<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr><w:t>An Arial line (Liberation Sans).</w:t></w:r></w:p>`;
  return zip({
    "[Content_Types].xml": `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `${DECL}<w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  });
}
