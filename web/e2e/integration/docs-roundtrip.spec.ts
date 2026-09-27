import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, createDoc, trashDoc } from "../helpers";
import { openDoc } from "../docs/helpers";
import { readPdf, renderPdfPage } from "./pdf-helpers";
import {
  downloadAs,
  editor,
  importFromHome,
  makePng,
  menu,
  openInDocsFromDrive,
  purgeDriveFile,
  selectText,
  uploadToDrive,
} from "./docs-helpers";

// Cross-boundary round trip for Docs: a document is built through the real
// editor UI (heading styles, bold, a numbered list, a table, an uploaded
// picture, an equation, a table of contents, a tracked insertion and a
// comment), downloaded through File ▸ Download in every offered format,
// and the downloads are brought back in two ways: the Docs home Import
// button, and Drive upload → Open with ▸ Docs → "Open in Docs".
//
// .docx goes through the direct writer/reader (docs.md §6.9) and keeps
// everything. The other formats go through pandoc from the editor's HTML
// (docs.md §1.4, §2.19), which by design drops comments, tracked changes
// and stored pictures; those losses are asserted explicitly below.

const TAG = () => `rt${Date.now().toString(36)}`;

const math = (page: Page) => editor(page).locator(".doc-math");
const tocEntries = (page: Page) => editor(page).locator(".doc-toc p.doc-toc-entry .toc-text");

async function buildRichDoc(page: Page, id: string) {
  await openDoc(page, id);
  await editor(page).click();
  // Heading styles and a bold run.
  await page.keyboard.press("Control+Alt+Digit1");
  await page.keyboard.type("Overview");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Plain text with ");
  await page.keyboard.press("Control+b");
  await page.keyboard.type("bold words");
  await page.keyboard.press("Control+b");
  await page.keyboard.type(" in it.");
  await page.keyboard.press("Enter");
  // A numbered list.
  await page.keyboard.press("Control+Shift+Digit7");
  await page.keyboard.type("Alpha item");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Beta item");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter"); // leave the list
  await page.keyboard.press("Control+Alt+Digit2");
  await page.keyboard.type("Details");
  await page.keyboard.press("Enter");
  // An equation.
  await page.keyboard.type("Pythagoras: ");
  await page.waitForTimeout(100);
  await menu(page, "Insert", "insert-equation", true);
  const input = page.getByTestId("equation-input");
  await input.focus();
  await page.keyboard.type("a^2+b^2=c^2", { delay: 5 });
  await expect(page.getByTestId("equation-preview").locator(".katex").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("equation-editor")).toBeHidden();
  await expect(math(page)).toHaveCount(1);
  // A picture uploaded to the document's asset store.
  await editor(page).click();
  await page.keyboard.press("Control+End");
  await page.waitForTimeout(100);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Picture follows. ");
  const png = await makePng(page);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    menu(page, "Insert", "Image from computer…"),
  ]);
  await chooser.setFiles({ name: "pic.png", mimeType: "image/png", buffer: png });
  await expect(editor(page).locator('.doc-obj[data-kind="picture"] img')).toHaveAttribute(
    "src",
    new RegExp(`^/api/v1/docs/d/${id}/assets/`),
    { timeout: 15_000 },
  );
  // A 2×2 table at the end.
  await editor(page).click();
  await page.keyboard.press("Control+End");
  await page.waitForTimeout(100);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Table below.");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Insert table" }).click();
  await page.getByTestId("table-size-2x2").click();
  const table = editor(page).locator("table").first();
  await expect(table.locator("tr")).toHaveCount(2);
  for (const [i, text] of ["Region", "Sales", "North", "42"].entries()) {
    if (i) await page.keyboard.press("Tab");
    await page.keyboard.type(text);
  }
  // Table of contents at the top.
  await selectText(page, "Overview", "start");
  await menu(page, "References", "ref-insert-toc", true);
  await expect(tocEntries(page)).toHaveText(["Overview", "Details"]);
  // A comment on "bold words".
  await selectText(page, "bold words");
  await page.keyboard.press("Control+Alt+KeyM");
  await page.getByPlaceholder("Add a comment…").fill("Check the wording");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(editor(page).locator(".doc-comment-anchor", { hasText: "bold words" })).toBeVisible();
  // A tracked insertion (Suggesting mode, on for everyone).
  await page.getByTestId("mode-menu").click();
  await page.getByRole("menuitem", { name: "Suggesting" }).click();
  await page.getByTestId("track-changes-menu").click();
  await page.getByTestId("track-on-everyone").click();
  await selectText(page, "in it.", "end");
  await page.keyboard.type(" Tracked");
  await expect(editor(page).locator(".suggestion-insert")).toHaveText(" Tracked");
  // Let the collab log persist before exporting.
  await page.waitForTimeout(1500);
}

type Expect = {
  styles?: boolean;
  list?: boolean;
  table?: boolean;
  picture?: boolean;
  equation?: "math" | "text" | false;
  toc?: "field" | "text" | false;
  tracked?: boolean;
  comment?: boolean;
};

/** Asserts what survived in the open editor. */
async function expectContent(page: Page, e: Expect) {
  const ed = editor(page);
  await expect(ed).toContainText("Plain text with bold words in it.", { timeout: 15_000 });
  if (e.styles) {
    await expect(ed.locator("h1", { hasText: "Overview" })).toHaveCount(1);
    await expect(ed.locator("h2", { hasText: "Details" })).toHaveCount(1);
    await expect(ed.locator("strong", { hasText: "bold words" })).toHaveCount(1);
  }
  if (e.list) {
    // A TipTap list item, or a numbered paragraph (M3 numbering, docx import).
    await expect(ed.locator("li:has-text('Alpha item'), p.doc-num:has-text('Alpha item')").first()).toBeVisible();
  }
  if (e.table) {
    const cells = ed.locator("table").first().locator("th, td");
    await expect(cells).toHaveText(["Region", "Sales", "North", "42"]);
  }
  if (e.picture) {
    await expect(ed.locator("img:not(.ProseMirror-separator)").first()).toBeVisible();
  } else if (e.picture === false) {
    await expect(ed.locator("img:not(.ProseMirror-separator)")).toHaveCount(0);
  }
  if (e.equation === "math") {
    await expect(math(page)).toHaveCount(1);
    await expect(math(page)).toHaveAttribute("data-linear", "a^2+b^2=c^2");
  } else if (e.equation === "text") {
    await expect(math(page)).toHaveCount(0);
    await expect(ed).toContainText("Pythagoras:");
  }
  if (e.toc === "field") {
    await expect(tocEntries(page)).toHaveText(["Overview", "Details"]);
  } else if (e.toc === "text") {
    await expect(ed.locator(".doc-toc")).toHaveCount(0);
  }
  if (e.tracked) {
    await expect(ed.locator(".suggestion-insert")).toHaveText(" Tracked");
  } else if (e.tracked === false) {
    await expect(ed.locator(".suggestion-insert")).toHaveCount(0);
  }
  if (e.comment) {
    await expect(ed.locator(".doc-comment-anchor", { hasText: "bold words" })).toBeVisible();
  } else if (e.comment === false) {
    await expect(ed.locator(".doc-comment-anchor")).toHaveCount(0);
  }
}

async function commentBodies(page: Page, id: string): Promise<string[]> {
  const r = await page.request.get(`${BASE_URL}/api/v1/docs/d/${id}/comments`);
  expect(r.ok()).toBeTruthy();
  return ((await r.json()).comments ?? []).map((c: { body: string }) => c.body);
}

test.describe.serial("docs integration: export → import round trips", () => {
  test("rich doc → .docx → Docs import and Drive ▸ Open in Docs", async ({ page }) => {
    test.setTimeout(180_000);
    const docs: string[] = [];
    const files: string[] = [];
    const tag = TAG();
    try {
      const id = await createDoc(page.request, `Integration ${tag}`);
      docs.push(id);
      await buildRichDoc(page, id);
      const all: Expect = {
        styles: true, list: true, table: true, picture: true,
        equation: "math", toc: "field", tracked: true, comment: true,
      };
      await expectContent(page, all);

      const { bytes, name } = await downloadAs(page, "Microsoft Word (.docx)");
      expect(name).toBe(`Integration ${tag}.docx`);
      expect(bytes.subarray(0, 2).toString()).toBe("PK");
      for (const part of ["word/document.xml", "word/numbering.xml", "word/comments.xml", "word/media/"])
        expect(bytes.includes(Buffer.from(part)), part).toBe(true);

      // 1) Docs home ▸ Import.
      const a = await importFromHome(page, `${tag}-home.docx`, bytes);
      docs.push(a);
      await expectContent(page, all);
      expect(await commentBodies(page, a)).toContain("Check the wording");

      // 2) Drive upload ▸ Open with ▸ Docs ▸ Open in Docs.
      const fileId = await uploadToDrive(page, `${tag}-drive.docx`, bytes);
      files.push(fileId);
      const b = await openInDocsFromDrive(page, fileId);
      docs.push(b);
      await expectContent(page, all);
      expect(await commentBodies(page, b)).toContain("Check the wording");

      // The imported copy is a real, persisted document: reload keeps it.
      await page.waitForTimeout(1500);
      await openDoc(page, b);
      await expectContent(page, all);
      await openDoc(page, a);
      await expectContent(page, all);

      // Trashing the Drive original does not affect the opened copy.
      await page.request.delete(`${BASE_URL}/api/v1/drive/files/${fileId}`);
      await openDoc(page, b);
      await expectContent(page, { table: true, equation: "math" });
    } finally {
      for (const f of files) await purgeDriveFile(page, f);
      for (const d of docs) await trashDoc(page.request, d);
    }
  });

  test("rich doc → .odt / .rtf / .md / .html / .txt (pandoc path) / .pdf (browser)", async ({ page }) => {
    test.setTimeout(240_000);
    const docs: string[] = [];
    const files: string[] = [];
    const tag = TAG();
    try {
      const id = await createDoc(page.request, `Integration ${tag}`);
      docs.push(id);
      await buildRichDoc(page, id);
      const src = page.url();

      // Documented pandoc-path losses (docs.md §1.4 "Import", §2.19, and
      // §6.18 "HTML-based exports ... stored pictures are relative URLs the
      // converter can't fetch"): comments, tracked changes and stored
      // pictures do not survive; the TOC comes back as plain text.
      const pandoc: Expect = { styles: true, table: true, picture: false, tracked: false, comment: false, toc: "text" };

      // .odt: import from the Docs home and through Drive.
      const odt = await downloadAs(page, "OpenDocument Format (.odt)");
      expect(odt.bytes.subarray(0, 2).toString()).toBe("PK");
      expect(odt.bytes.includes(Buffer.from("application/vnd.oasis.opendocument.text"))).toBe(true);
      docs.push(await importFromHome(page, `${tag}.odt`, odt.bytes));
      await expectContent(page, pandoc);
      const odtFile = await uploadToDrive(page, `${tag}-drive.odt`, odt.bytes);
      files.push(odtFile);
      docs.push(await openInDocsFromDrive(page, odtFile));
      await expectContent(page, pandoc);

      // .rtf: pandoc's RTF writer; re-import through Drive ▸ Open in Docs.
      await page.goto(src);
      await expect(page.getByTestId("collab-status")).toHaveText("connected", { timeout: 15_000 });
      const rtf = await downloadAs(page, "Rich Text Format (.rtf)");
      expect(rtf.bytes.subarray(0, 5).toString()).toBe("{\\rtf");
      const rtfFile = await uploadToDrive(page, `${tag}-drive.rtf`, rtf.bytes);
      files.push(rtfFile);
      docs.push(await openInDocsFromDrive(page, rtfFile));
      await expect(editor(page)).toContainText("Plain text with bold words in it.", { timeout: 15_000 });
      await expect(editor(page)).toContainText("Alpha item");

      // .md and .html: back through the Docs home.
      await page.goto(src);
      await expect(page.getByTestId("collab-status")).toHaveText("connected", { timeout: 15_000 });
      const md = await downloadAs(page, "Markdown (.md)");
      expect(md.bytes.toString("utf8")).toMatch(/^# .*Overview/m);
      docs.push(await importFromHome(page, `${tag}.md`, md.bytes));
      await expectContent(page, { styles: true, table: true, tracked: false, comment: false });

      await page.goto(src);
      await expect(page.getByTestId("collab-status")).toHaveText("connected", { timeout: 15_000 });
      const html = await downloadAs(page, "Web Page (.html)");
      const htmlText = html.bytes.toString("utf8");
      expect(htmlText).toContain("<h1");
      expect(htmlText).toContain("Region");
      docs.push(await importFromHome(page, `${tag}.html`, html.bytes));
      await expectContent(page, { styles: true, table: true });

      // .txt: text only.
      await page.goto(src);
      await expect(page.getByTestId("collab-status")).toHaveText("connected", { timeout: 15_000 });
      const txt = await downloadAs(page, "Plain Text (.txt)");
      const plain = txt.bytes.toString("utf8");
      for (const s of ["Overview", "bold words", "Alpha item", "Region", "North"]) expect(plain).toContain(s);

      // .pdf is built in the browser from the paginated layout (lib/pdf):
      // one page per laid-out page, the text layer and a drawn page.
      await page.goto(src);
      await expect(page.getByTestId("collab-status")).toHaveText("connected", { timeout: 15_000 });
      await expect(page.getByTestId("doc-editor")).toHaveAttribute("data-paged", "true");
      const laidOut = await page.locator(".doc-pages .doc-page").count();
      const pdf = await downloadAs(page, "PDF Document (.pdf)");
      const info = readPdf(pdf.bytes);
      expect(info.pages).toHaveLength(laidOut);
      expect(info.pages[0]).toMatchObject({ w: 612, h: 792 });
      for (const s of ["Overview", "bold words", "Alpha item", "Region", "North"]) expect(info.text).toContain(s);
      expect(await renderPdfPage(page, pdf.bytes, 1)).toBeGreaterThan(0.005);
    } finally {
      for (const f of files) await purgeDriveFile(page, f);
      for (const d of docs) await trashDoc(page.request, d);
    }
  });
});
