import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, createDoc, createSheet, saveSheet, trashDoc, trashSheet } from "../helpers";
import { openDoc } from "../docs/helpers";
import { readFile } from "node:fs/promises";
import { openSheet, txt, num } from "../sheetsGrid";
import { downloadAs as docsDownloadAs, editor } from "./docs-helpers";
import { downloadAs as sheetsDownloadAs } from "./sheets-helpers";
import { PDF_SHOT_DIR, readPdf, renderPdfPage } from "./pdf-helpers";

// File ▸ Download ▸ PDF in Docs and Sheets builds the file in the browser
// from the paginated layout (web/app/src/lib/pdf): one page per laid-out
// page at the page's own size, a searchable text layer and web links. The
// server's pandoc path is only a fallback where a PDF engine is installed;
// without one it answers 501 (never 500) and says so in its capabilities.

const LOREM = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ";
// A 40×24 PNG, solid blue, so the picture shows in the page render.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAYCAIAAAAH5iiXAAAAKElEQVR4nGOQKn4xIIhh1OJRi0ctHrV41OJRi0ctHrV41OJRi4ePxQBgnHcMTGP4wAAAAABJRU5ErkJggg==";

function longHtml(): string {
  let html = `<p></p><h1>Introduction</h1><p>See <a href="https://example.com/grown-pdf">the example site</a> for more.</p><p><img src="${PNG}" alt="blue"></p>`;
  for (let i = 0; i < 14; i++) html += `<p>Intro ${i}. ${LOREM.repeat(2)}</p>`;
  html += "<h2>Data</h2><table><tbody>";
  for (let i = 0; i < 20; i++) html += `<tr><td><p>${i ? `Row ${i}` : "Item"}</p></td><td><p>${i ? i * 7 : "Value"}</p></td></tr>`;
  html += "</tbody></table>";
  html += "<h1>Wide appendix</h1>";
  for (let i = 0; i < 6; i++) html += `<p>Appendix ${i}. ${LOREM}</p>`;
  return html;
}

async function paste(page: Page, html: string) {
  await editor(page).click();
  await page.evaluate((h) => {
    const dt = new DataTransfer();
    dt.setData("text/html", h);
    dt.setData("text/plain", "x");
    document
      .querySelector(".ProseMirror")!
      .dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, html);
}

async function layoutMenu(page: Page, testid: string) {
  await page.getByTestId("menu-layout").click();
  await page.getByTestId(testid).click();
  await page.waitForTimeout(300);
}

test.describe.serial("PDF export", () => {
  test("server reports its PDF capability and never 500s without an engine", async ({ page }) => {
    const caps = await page.request.get(`${BASE_URL}/api/v1/docs/convert/capabilities`);
    expect(caps.ok()).toBe(true);
    const c = await caps.json();
    expect(typeof c.pdf).toBe("boolean");
    const probe = await page.request.post(`${BASE_URL}/api/v1/docs/convert?to=pdf`, { headers: { "Content-Type": "text/html" }, data: "<p>probe</p>" });
    if (c.pdf) expect(probe.status()).toBe(200);
    else {
      expect([501, 503]).toContain(probe.status());
      expect(await probe.text()).toMatch(/not installed|no PDF engine/);
    }
  });

  test("docs: pages, sizes per section, header/footer, text layer, links, picture", async ({ page }) => {
    test.setTimeout(150_000);
    const id = await createDoc(page.request, "PDF export doc");
    try {
      await openDoc(page, id);
      await paste(page, longHtml());
      await expect(page.getByTestId("doc-editor")).toHaveAttribute("data-paged", "true");
      await expect.poll(() => page.locator(".doc-pages .doc-page").count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(3);

      // "Page X of Y" in the footer, a header on every page.
      await page.getByRole("button", { name: "Insert", exact: true }).first().click();
      await page.getByTestId("insert-page-numbers").click();
      await page.getByTestId("pn-center").click();
      await page.getByTestId("pn-of-total").click();
      await page.getByTestId("pn-ok").click();
      await page.locator(".doc-header-region .ProseMirror").click();
      await page.keyboard.type("Quarterly report");
      await expect(page.locator('.doc-hf--header[data-page="2"]')).toContainText("Quarterly report");

      // A landscape section from "Wide appendix" on.
      await editor(page).locator("h1", { hasText: "Wide appendix" }).click({ position: { x: 1, y: 8 } });
      await page.keyboard.press("Home");
      await page.waitForTimeout(100);
      await layoutMenu(page, "layout-break-nextPage");
      await layoutMenu(page, "layout-landscape");
      await expect(page.locator('.doc-pages .doc-page[data-orient="landscape"]').first()).toBeAttached();
      await page.waitForTimeout(500);

      const orients = await page.locator(".doc-pages .doc-page").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.orient ?? "portrait"));
      const { bytes, name } = await docsDownloadAs(page, "PDF Document (.pdf)");
      expect(name).toBe("PDF export doc.pdf");
      const pdf = readPdf(bytes);
      expect(pdf.producer).toBe("Grown Docs");
      // One PDF page per laid-out page, each at its section's size.
      expect(pdf.pages.map((p) => (p.w > p.h ? "landscape" : "portrait"))).toEqual(orients);
      for (const p of pdf.pages) expect([p.w, p.h].sort((a, b) => a - b)).toEqual([612, 792]);
      // The text layer: body, table, header text on every page.
      for (const s of ["Introduction", "Intro 3.", "Row 7", "Wide appendix", "Appendix 5."]) expect(pdf.text).toContain(s);
      for (const p of pdf.pages) expect(p.text).toContain("Quarterly report");
      expect(pdf.pages[1].text).toContain("Page");
      // The web link is an annotation.
      expect(bytes.toString("latin1")).toContain("/URI (https://example.com/grown-pdf)");
      // The picture is drawn: page 1 has real ink, including the blue image.
      const ink = await renderPdfPage(page, bytes, 1, `${PDF_SHOT_DIR}/pdf-export-docs.png`);
      expect(ink).toBeGreaterThan(0.01);
      const last = await renderPdfPage(page, bytes, pdf.pages.length, `${PDF_SHOT_DIR}/pdf-export-docs-landscape.png`);
      expect(last).toBeGreaterThan(0.005);
    } finally {
      await trashDoc(page.request, id);
    }
  });

  test("sheets: print area, orientation, fit to width, gridlines, headings, repeated title row", async ({ page }) => {
    test.setTimeout(150_000);
    const id = await createSheet(page.request, "PDF export sheet");
    try {
      const celldata: any[] = [];
      const head = ["Region", "Quarter", "Units", "Revenue", "Notes"];
      head.forEach((h, c) => celldata.push({ r: 0, c, v: { ...txt(h), bl: 1 } }));
      for (let r = 1; r < 120; r++) {
        celldata.push({ r, c: 0, v: txt(`Region ${r}`) });
        celldata.push({ r, c: 1, v: txt(`Q${(r % 4) + 1}`) });
        celldata.push({ r, c: 2, v: num(r * 3) });
        celldata.push({ r, c: 3, v: num(r * 101) });
        celldata.push({ r, c: 4, v: txt(r === 60 ? "Midpoint row" : "") });
      }
      // Outside the print area: must not be in the PDF.
      celldata.push({ r: 2, c: 12, v: txt("Outside area") });
      const grownPrint = {
        orientation: "landscape",
        paper: "a4",
        printArea: { r1: 0, c1: 0, r2: 119, c2: 4 },
        titleRows: [0, 0],
        gridLines: true,
        headings: true,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        footer: "&CPage &P of &N",
      };
      await saveSheet(page.request, id, [{ name: "Report", id: "pdf-rep", order: 0, row: 130, column: 20, celldata, grownPrint }]);
      await openSheet(page, id);

      // The page count print preview shows (File ▸ Print).
      await page.getByRole("button", { name: "File", exact: true }).click();
      await page.getByRole("menuitem", { name: /^Print/ }).click();
      const frame = page.frameLocator('[data-testid="print-preview"]');
      await expect(frame.locator("section.page").first()).toBeAttached({ timeout: 15_000 });
      const previewPages = await frame.locator("section.page").count();
      expect(previewPages).toBeGreaterThan(1);
      // The dialog's own Download PDF gives the previewed pages.
      const [fromDialog] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), page.getByTestId("print-download-pdf").click()]);
      expect(readPdf(await readFile((await fromDialog.path())!)).pages).toHaveLength(previewPages);
      await page.keyboard.press("Escape");

      const { bytes, name } = await sheetsDownloadAs(page, "PDF Document (.pdf)");
      expect(name).toBe("PDF export sheet.pdf");
      const pdf = readPdf(bytes);
      expect(pdf.producer).toBe("Grown Sheets");
      expect(pdf.pages).toHaveLength(previewPages);
      // A4 landscape: 297 × 210 mm.
      for (const p of pdf.pages) {
        expect(p.w).toBeCloseTo((297 / 25.4) * 72, 0);
        expect(p.h).toBeCloseTo((210 / 25.4) * 72, 0);
      }
      // The title row repeats on every page; headings and the footer show.
      for (const [i, p] of pdf.pages.entries()) {
        expect(p.text, `page ${i + 1}`).toContain("Region Quarter Units Revenue");
        expect(p.text, `page ${i + 1}`).toContain(`Page ${i + 1} of ${previewPages}`);
      }
      expect(pdf.pages[0].text).toMatch(/\bA B C D E\b/);
      expect(pdf.text).toContain("Midpoint row");
      expect(pdf.text).toContain("Region 119");
      expect(pdf.text).not.toContain("Outside area");
      const ink = await renderPdfPage(page, bytes, 1, `${PDF_SHOT_DIR}/pdf-export-sheets.png`);
      expect(ink).toBeGreaterThan(0.01);
    } finally {
      await trashSheet(page.request, id);
    }
  });

  test("docs: mail merge downloads one page per record", async ({ page }) => {
    test.setTimeout(90_000);
    const stamp = Date.now();
    const sheetTitle = `pdf merge data ${stamp}`;
    const sheet = await createSheet(page.request, sheetTitle);
    await saveSheet(page.request, sheet, [
      {
        name: "People",
        celldata: [
          { r: 0, c: 0, v: { v: "Name", m: "Name" } },
          { r: 1, c: 0, v: { v: "Ada", m: "Ada" } },
          { r: 2, c: 0, v: { v: "Grace", m: "Grace" } },
        ],
      },
    ]);
    const doc = await createDoc(page.request, `pdf letter ${stamp}`);
    try {
      await openDoc(page, doc);
      await editor(page).click();
      await page.keyboard.type("Dear ");
      await page.getByRole("button", { name: "Tools", exact: true }).first().click();
      await page.getByTestId("tools-mail-merge").click();
      const panel = page.getByTestId("mail-merge");
      await panel.getByTestId("mm-sheet").click();
      await page.getByRole("option", { name: sheetTitle }).click();
      await panel.getByTestId("mm-load").click();
      await expect(panel.getByTestId("mm-summary")).toHaveText(/2 records/);
      await panel.getByTestId("mm-field-Name").click();
      await page.waitForTimeout(100);
      await page.keyboard.type(", welcome.");
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), panel.getByRole("button", { name: "Download PDF" }).click()]);
      const bytes = await readFile((await dl.path())!);
      const pdf = readPdf(bytes);
      expect(pdf.pages).toHaveLength(2);
      expect(pdf.pages[0].text).toContain("Dear Ada, welcome.");
      expect(pdf.pages[1].text).toContain("Dear Grace, welcome.");
      expect(await renderPdfPage(page, bytes, 2)).toBeGreaterThan(0.0005);
    } finally {
      await trashDoc(page.request, doc);
      await trashSheet(page.request, sheet);
    }
  });
});
