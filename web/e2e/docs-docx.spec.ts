import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { BASE_URL, trashDoc } from "./helpers";

// Docs M6: direct .docx import and export through the UI. A .docx with
// styles, a numbered list, bullets, a merged table, a header and a comment
// is generated here (never checked in), imported from the Docs home, and
// checked in the editor. It is then downloaded with File ▸ Download ▸
// .docx (the direct writer) and the download is imported again.
//
// Set DOCS_M6_SCREENSHOT to a path to save a screenshot of the import.

// --- a minimal stored (uncompressed) zip writer ------------------------------
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

// --- the fixture ---------------------------------------------------------------
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CT = "application/vnd.openxmlformats-officedocument.wordprocessingml";
const p = (text: string, pPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const num = (id: number, lvl = 0) => `<w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="${id}"/></w:numPr>`;
const cell = (text: string, tcPr = "") => `<w:tc>${tcPr ? `<w:tcPr>${tcPr}</w:tcPr>` : ""}${p(text)}</w:tc>`;

function fixtureDocx(): Buffer {
  const body = [
    p("Imported report", '<w:pStyle w:val="Title"/>'),
    p("Overview", '<w:pStyle w:val="Heading1"/>'),
    `<w:p><w:r><w:t xml:space="preserve">Direct import keeps </w:t></w:r><w:r><w:rPr><w:b/><w:color w:val="C00000"/></w:rPr><w:t>styles</w:t></w:r><w:r><w:t xml:space="preserve"> and </w:t></w:r><w:commentRangeStart w:id="0"/><w:r><w:t>comments</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r><w:r><w:t>.</w:t></w:r></w:p>`,
    p("A callout paragraph", '<w:pStyle w:val="Callout"/>'),
    p("First step", num(1)),
    p("Detail", num(1, 1)),
    p("Second step", num(1)),
    p("A bullet", num(2)),
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>` +
      `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cell("Region")}${cell("Sales")}</w:tr>` +
      `<w:tr>${cell("North")}${cell("42", '<w:shd w:val="clear" w:color="auto" w:fill="E6F4EA"/>')}</w:tr>` +
      `<w:tr>${cell("Total across regions", '<w:gridSpan w:val="2"/>')}</w:tr></w:tbl>`,
    p("The end."),
  ].join("");
  const styles = `<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="52"/><w:color w:val="1A73E8"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="Callout"><w:name w:val="Callout Box"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="FEF7E0"/><w:ind w:left="360"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
</w:styles>`;
  const numbering = `<w:numbering ${W}>
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
  const header = `<w:hdr ${W}>${p("ACME Corp — confidential", '<w:jc w:val="center"/>')}</w:hdr>`;
  const comments = `<w:comments ${W}><w:comment w:id="0" w:author="Reviewer" w:date="2026-09-01T10:00:00Z"><w:p><w:r><w:t>Is this true?</w:t></w:r></w:p></w:comment></w:comments>`;
  const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`;
  return zip({
    "[Content_Types].xml": `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${CT}.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="${CT}.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="${CT}.numbering+xml"/><Override PartName="/word/header1.xml" ContentType="${CT}.header+xml"/><Override PartName="/word/comments.xml" ContentType="${CT}.comments+xml"/></Types>`,
    "_rels/.rels": `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel("rId1", "officeDocument", "word/document.xml")}</Relationships>`,
    "word/_rels/document.xml.rels": `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel("rId1", "styles", "styles.xml")}${rel("rId2", "numbering", "numbering.xml")}${rel("rId3", "header", "header1.xml")}${rel("rId4", "comments", "comments.xml")}</Relationships>`,
    "word/document.xml": `${DECL}<w:document ${W}><w:body>${body}<w:sectPr><w:headerReference w:type="default" r:id="rId3"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`,
    "word/styles.xml": DECL + styles,
    "word/numbering.xml": DECL + numbering,
    "word/header1.xml": DECL + header,
    "word/comments.xml": DECL + comments,
  });
}

// --- helpers -----------------------------------------------------------------
// The header's margin editor is also a .ProseMirror and comes first.
const editor = (page: Page) => page.locator(".ProseMirror:not(.margin-editor .ProseMirror)").first();

async function importFromHome(page: Page, name: string, buffer: Buffer): Promise<string> {
  // A hard load of /docs serves the public documentation site; the Docs
  // home is reached client-side from the launcher.
  await page.goto(`${BASE_URL}/`);
  await page.getByTestId("tile-docs").click();
  await expect(page.getByTestId("docs-import")).toBeVisible();
  await page.getByTestId("docs-import-input").setInputFiles({
    name,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer,
  });
  await page.waitForURL(/\/docs\/d\/[^/]+$/, { timeout: 20_000 });
  await expect(page.getByTestId("collab-status")).toHaveText("connected", { timeout: 15_000 });
  return page.url().split("/").pop()!;
}

async function expectImported(page: Page) {
  const ed = editor(page);
  await expect(ed.locator('p[data-style="Title"]')).toHaveText("Imported report");
  await expect(ed.locator('p[data-style="Title"]')).toHaveCSS("color", "rgb(26, 115, 232)");
  await expect(ed.locator("h1")).toHaveText("Overview");
  await expect(ed.locator('p[data-style="Callout"]')).toHaveText("A callout paragraph");
  await expect(ed.locator('p[data-style="Callout"]')).toHaveCSS("font-style", "italic");
  const labels = ed.locator(".doc-num");
  await expect(labels).toHaveCount(4);
  await expect(labels.nth(0)).toHaveAttribute("data-num", "1.");
  await expect(labels.nth(1)).toHaveAttribute("data-num", "a)");
  await expect(labels.nth(2)).toHaveAttribute("data-num", "2.");
  await expect(labels.nth(3)).toHaveAttribute("data-num", "•");
  await expect(ed.locator("strong", { hasText: "styles" })).toBeVisible();
  // Table: header row, shading, a merged cell.
  await expect(ed.locator("table th")).toHaveText(["Region", "Sales"]);
  await expect(ed.locator("table td", { hasText: "42" })).toHaveCSS("background-color", "rgb(230, 244, 234)");
  await expect(ed.locator('table td[colspan="2"]')).toHaveText("Total across regions");
  // Header fragment.
  await expect(page.locator(".margin-editor--header")).toContainText("ACME Corp — confidential");
}

test.describe.serial("docs direct docx import/export", () => {
  test("import, render, export and re-import a .docx", async ({ page }, testInfo) => {
    const ids: string[] = [];
    try {
      ids.push(await importFromHome(page, "M6 report.docx", fixtureDocx()));
      await expectImported(page);
      // The comment thread was created on the server and anchored.
      await expect(editor(page).locator(".doc-comment-anchor", { hasText: "comments" })).toBeVisible();
      await page.getByRole("button", { name: /comments/i }).first().click().catch(() => {});
      await expect(page.getByText("Is this true?").first()).toBeVisible({ timeout: 10_000 });

      const shot = process.env.DOCS_M6_SCREENSHOT;
      if (shot) await page.screenshot({ path: shot, fullPage: false });

      // Let the collab log persist the import before exporting.
      await page.waitForTimeout(1000);
      await page.getByRole("button", { name: "File", exact: true }).click();
      await page.getByText("Download", { exact: true }).click();
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("menuitem", { name: "Microsoft Word (.docx)" }).click(),
      ]);
      const file = await download.path();
      const bytes = await readFile(file!);
      expect(bytes.subarray(0, 2).toString()).toBe("PK");
      expect(bytes.includes(Buffer.from("word/document.xml"))).toBe(true);
      expect(bytes.includes(Buffer.from("word/numbering.xml"))).toBe(true);
      expect(bytes.includes(Buffer.from("word/comments.xml"))).toBe(true);
      // Only the direct writer adds commentsExtended (pandoc does not).
      expect(bytes.includes(Buffer.from("word/commentsExtended.xml"))).toBe(true);
      await testInfo.attach("export.docx", { body: bytes, contentType: "application/octet-stream" });

      // Re-import what we exported: same render.
      ids.push(await importFromHome(page, "M6 report (export).docx", bytes));
      await expectImported(page);
      await expect(page.getByText("Is this true?").first()).toBeAttached({ timeout: 10_000 }).catch(() => {});
    } finally {
      for (const id of ids) await trashDoc(page.request, id);
    }
  });
});
