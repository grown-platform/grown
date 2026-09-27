import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import {
  BASE_URL,
  createDeck,
  getDeckData,
  getSheetData,
  saveDeckData,
  trashDeck,
  trashDoc,
  trashSheet,
} from "../helpers";
import { zip } from "../docs/zip";
import { buildVsdx, cell, rectGeom, shape, xform } from "../../app/src/pages/whiteboard/vsdxFixture";

// Drive integration: office files uploaded through the Drive UI open in the
// right Grown editor through the row menu's "Open with ▸ <editor>" and the
// editor page's "Open in …" button, which makes an editable copy. Trashing
// and restoring the Drive originals must not affect the copies.
//
// Fixtures are built in the test: .pptx/.odp/.pdf are downloaded from a
// Slides deck through its File ▸ Download menu, .xlsx comes from SheetJS,
// .docx from a hand-written package, .vsdx from vsdxFixture.ts. Nothing is
// written to disk except Playwright's own download temp files.

const requireApp = createRequire(path.join(process.cwd(), "../app/package.json"));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const XLSX = requireApp("xlsx");

const MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odp: "application/vnd.oasis.opendocument.presentation",
  csv: "text/csv",
  pdf: "application/pdf",
  // Browsers have no registered type for .vsdx and send a generic one.
  vsdx: "application/octet-stream",
} as const;
type Kind = keyof typeof MIME;

function docxFixture(): Buffer {
  const W =
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const p = (t: string, style = "") =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
  const tc = (t: string) => `<w:tc>${p(t)}</w:tc>`;
  const body =
    p("Drive memo", "Heading1") +
    p("Opened from Drive into Docs.") +
    `<w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr>${tc("Item")}${tc("Qty")}</w:tr><w:tr>${tc("Apples")}${tc("7")}</w:tr></w:tbl>` +
    p("End of memo.");
  const styles = `<w:styles ${W}><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/></w:rPr></w:style></w:styles>`;
  return zip({
    "[Content_Types].xml": `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    "_rels/.rels": `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/_rels/document.xml.rels": `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    "word/document.xml": `${DECL}<w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`,
    "word/styles.xml": DECL + styles,
  });
}

function xlsxFixture(): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([
    ["Item", "Price", "Qty"],
    ["Pens", 2.5, 4],
    ["Pads", 4, 3],
  ]);
  ws["D1"] = { t: "s", v: "Total" };
  ws["D2"] = { t: "n", f: "B2*C2", v: 10 };
  ws["D3"] = { t: "n", f: "B3*C3", v: 12 };
  ws["D4"] = { t: "n", f: "SUM(D2:D3)", v: 22 };
  ws["!ref"] = "A1:D4";
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Orders");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

async function vsdxFixture(): Promise<Buffer> {
  return Buffer.from(
    await buildVsdx({
      pages: [
        {
          name: "Flow",
          shapes: shape(
            1,
            xform(2.5, 6, 2.5, 1.2) + cell("FillForegnd", "#cfe2ff") + rectGeom(2.5, 1.2) + "<Text>Drive box</Text>",
          ),
        },
      ],
    }),
  );
}

const DECK = {
  slides: [
    {
      id: "s1",
      background: "#ffffff",
      notes: "Drive notes",
      elements: [
        {
          id: "t1", type: "text", x: 80, y: 180, w: 800, h: 100, text: "Drive deck title",
          fontSize: 40, color: "#202124", align: "center", valign: "middle", fontFamily: "Arial",
        },
      ],
    },
    {
      id: "s2",
      background: "#ffffff",
      elements: [
        { id: "r", type: "rect", x: 80, y: 80, w: 200, h: 120, fill: "#34a853", stroke: "none", strokeWidth: 0 },
        {
          id: "t2", type: "text", x: 80, y: 260, w: 600, h: 80, text: "Second slide text",
          fontSize: 24, color: "#202124", align: "left", valign: "top", fontFamily: "Arial",
        },
      ],
    },
  ],
};

/** Downloads the deck in each format through File ▸ Download. */
async function deckDownloads(page: Page, deckId: string): Promise<Record<"pptx" | "odp" | "pdf", Buffer>> {
  await page.goto(`${BASE_URL}/slides/d/${deckId}`);
  await expect(page.getByRole("textbox", { name: "Presentation title" })).toBeVisible();
  const out: Partial<Record<"pptx" | "odp" | "pdf", Buffer>> = {};
  for (const [fmt, label] of [
    ["pptx", /Microsoft PowerPoint/],
    ["odp", /ODP Document/],
    ["pdf", /PDF Document/],
  ] as const) {
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page.getByText("Download", { exact: true }).click();
    const dl = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: label }).click();
    out[fmt] = await readFile((await (await dl).path())!);
  }
  return out as Record<"pptx" | "odp" | "pdf", Buffer>;
}

/** Uploads files through the Drive page's upload input; returns name → id. */
async function uploadViaDrive(page: Page, files: { name: string; kind: Kind; buffer: Buffer }[]) {
  await page.goto(`${BASE_URL}/drive`);
  await expect(page.getByText("My Drive").first()).toBeVisible();
  await page.getByTestId("drive-upload-input").setInputFiles(
    files.map((f) => ({ name: f.name, mimeType: MIME[f.kind], buffer: f.buffer })),
  );
  const ids: Record<string, string> = {};
  await expect
    .poll(
      async () => {
        const r = await page.request.get(`${BASE_URL}/api/v1/drive/files`);
        const list = ((await r.json()).files ?? []) as { id: string; name: string }[];
        for (const f of files) {
          const hit = list.find((x) => x.name === f.name);
          if (hit) ids[f.name] = hit.id;
        }
        return Object.keys(ids).length;
      },
      { timeout: 20_000 },
    )
    .toBe(files.length);
  return ids;
}

/** Drive row menu ▸ Open with ▸ <editor>. */
async function openWith(page: Page, fileId: string, editorName: string) {
  await page.goto(`${BASE_URL}/drive`);
  await page.getByTestId(`row-menu-${fileId}`).click();
  await page.getByTestId(`open-with-${fileId}`).click();
  await page.getByRole("menuitem", { name: editorName, exact: true }).click();
}

const docEditor = (page: Page) => page.locator(".ProseMirror:not(.margin-editor .ProseMirror)").first();

test.describe.serial("drive: upload → open with → open in editor", () => {
  test("each office format opens in its editor, and copies survive trash/restore of the originals", async ({ page }) => {
    test.setTimeout(240_000);
    const tag = Math.random().toString(36).slice(2, 7);
    const made = { docs: [] as string[], sheets: [] as string[], decks: [] as string[], boards: [] as string[] };
    let driveIds: Record<string, string> = {};
    const sourceDeck = await createDeck(page.request, `drive src ${tag}`);
    made.decks.push(sourceDeck);
    try {
      await saveDeckData(page.request, sourceDeck, DECK);
      const deckFiles = await deckDownloads(page, sourceDeck);
      expect(deckFiles.pdf.subarray(0, 5).toString()).toBe("%PDF-");

      const name = (k: Kind) => `drive-${tag}.${k}`;
      const files = [
        { name: name("docx"), kind: "docx" as const, buffer: docxFixture() },
        { name: name("xlsx"), kind: "xlsx" as const, buffer: xlsxFixture() },
        { name: name("pptx"), kind: "pptx" as const, buffer: deckFiles.pptx },
        { name: name("odp"), kind: "odp" as const, buffer: deckFiles.odp },
        { name: name("csv"), kind: "csv" as const, buffer: Buffer.from("City,Pop\nOslo,700\nBergen,285\n") },
        { name: name("vsdx"), kind: "vsdx" as const, buffer: await vsdxFixture() },
        { name: name("pdf"), kind: "pdf" as const, buffer: deckFiles.pdf },
      ];
      driveIds = await uploadViaDrive(page, files);
      const id = (k: Kind) => driveIds[name(k)];

      // --- .docx → Docs ---------------------------------------------------
      await openWith(page, id("docx"), "Docs");
      await expect(page).toHaveURL(new RegExp(`/docs/${id("docx")}$`));
      await page.getByTestId("open-in-docs").click();
      await page.waitForURL(/\/docs\/d\/[^/]+$/, { timeout: 30_000 });
      made.docs.push(page.url().split("/").pop()!);
      await expect(page.getByTestId("collab-status")).toHaveText("connected", { timeout: 15_000 });
      await expect(docEditor(page).locator("h1")).toHaveText("Drive memo");
      await expect(docEditor(page).locator("table")).toContainText("Apples");

      // --- .xlsx → Sheets ---------------------------------------------------
      await openWith(page, id("xlsx"), "Sheets");
      await page.getByTestId("open-in-sheets").click();
      await page.waitForURL(/\/sheets\/d\/[^/]+$/, { timeout: 30_000 });
      const xlsxSheet = page.url().split("/").pop()!;
      made.sheets.push(xlsxSheet);
      await expect(page.locator(".fortune-sheet-canvas")).toBeVisible({ timeout: 20_000 });
      {
        const wb = await getSheetData(page.request, xlsxSheet);
        expect(wb[0].name).toBe("Orders");
        const at = (r: number, c: number) => wb[0].celldata.find((x: any) => x.r === r && x.c === c)?.v;
        expect(at(0, 0)?.v).toBe("Item");
        expect(at(3, 3)?.f).toBe("=SUM(D2:D3)");
        expect(Number(at(3, 3)?.v)).toBe(22);
      }

      // --- .csv → Sheets ----------------------------------------------------
      await openWith(page, id("csv"), "Sheets");
      await page.getByTestId("open-in-sheets").click();
      await page.waitForURL(/\/sheets\/d\/[^/]+$/, { timeout: 30_000 });
      const csvSheet = page.url().split("/").pop()!;
      made.sheets.push(csvSheet);
      await expect(page.locator(".fortune-sheet-canvas")).toBeVisible({ timeout: 20_000 });
      {
        const wb = await getSheetData(page.request, csvSheet);
        const at = (r: number, c: number) => wb[0].celldata.find((x: any) => x.r === r && x.c === c)?.v;
        expect(at(1, 0)?.v).toBe("Oslo");
        expect(Number(at(2, 1)?.v)).toBe(285);
      }

      // --- .pptx and .odp → Slides -------------------------------------------
      for (const k of ["pptx", "odp"] as const) {
        await openWith(page, id(k), "Slides");
        await page.getByTestId("open-in-slides").click();
        await page.waitForURL(/\/slides\/d\/[^/]+$/, { timeout: 30_000 });
        const deckId = page.url().split("/").pop()!;
        made.decks.push(deckId);
        await expect(page.getByRole("textbox", { name: "Presentation title" })).toBeVisible();
        const deck = await getDeckData(page.request, deckId);
        expect(deck?.slides, k).toHaveLength(2);
        const texts = deck!.slides.flatMap((s) => s.elements.map((e: any) => e.text ?? "")).join("|");
        expect(texts, k).toContain("Drive deck title");
        expect(texts, k).toContain("Second slide text");
        expect((deck!.slides[0] as any).notes, k).toContain("Drive notes");
      }

      // --- .pdf → PDF (preview) -----------------------------------------------
      // Documented: Drive's /pdf/:id is a preview page; opening a Drive item in
      // the PDF editor is "Missing (deferred)" (cross-cutting.md §2.1, row
      // "Continuous-scroll multi-page render; open a Documents item by id in /editor").
      await openWith(page, id("pdf"), "PDF");
      await expect(page).toHaveURL(new RegExp(`/pdf/${id("pdf")}$`));
      await expect(page.getByText("PDF editor is coming soon")).toBeVisible();
      // Both slides render as pages.
      await expect(page.locator("canvas")).toHaveCount(2, { timeout: 20_000 });

      // --- trash the originals: the copies are independent -----------------
      for (const f of files) {
        const r = await page.request.delete(`${BASE_URL}/api/v1/drive/files/${driveIds[f.name]}`);
        expect(r.ok(), f.name).toBeTruthy();
      }
      await page.goto(`${BASE_URL}/drive?view=trash`);
      for (const f of files) await expect(page.getByTestId(`file-row-${driveIds[f.name]}`)).toBeVisible();

      await page.goto(`${BASE_URL}/docs/d/${made.docs[0]}`);
      await expect(page.getByTestId("collab-status")).toHaveText("connected", { timeout: 15_000 });
      await expect(docEditor(page).locator("h1")).toHaveText("Drive memo");
      for (const s of made.sheets) expect((await getSheetData(page.request, s)).length).toBeGreaterThan(0);
      await page.goto(`${BASE_URL}/sheets/d/${xlsxSheet}`);
      await expect(page.locator(".fortune-sheet-canvas")).toBeVisible({ timeout: 20_000 });
      for (const d of made.decks.slice(1)) expect((await getDeckData(page.request, d))?.slides).toHaveLength(2);

      // --- restore through the Trash view; the originals open again --------
      for (const f of files) {
        await page.goto(`${BASE_URL}/drive?view=trash`);
        await page.getByTestId(`restore-${driveIds[f.name]}`).click();
        await expect(page.getByTestId(`file-row-${driveIds[f.name]}`)).toHaveCount(0);
      }
      await openWith(page, id("docx"), "Docs");
      await expect(page.getByTestId("open-in-docs")).toBeVisible();
      await openWith(page, id("xlsx"), "Sheets");
      await page.getByTestId("open-in-sheets").click();
      await page.waitForURL(/\/sheets\/d\/[^/]+$/, { timeout: 30_000 });
      made.sheets.push(page.url().split("/").pop()!);
      expect(Number((await getSheetData(page.request, made.sheets.at(-1)!))[0].celldata.find((x: any) => x.r === 3 && x.c === 3)?.v?.v)).toBe(22);
      // The first copy is unchanged by the second open.
      expect((await getSheetData(page.request, xlsxSheet))[0].name).toBe("Orders");
    } finally {
      for (const d of made.docs) await trashDoc(page.request, d);
      for (const s of made.sheets) await trashSheet(page.request, s);
      for (const d of made.decks) await trashDeck(page.request, d);
      for (const b of made.boards) await page.request.delete(`${BASE_URL}/api/v1/whiteboards/d/${b}`).catch(() => {});
      for (const fid of Object.values(driveIds)) {
        await page.request.delete(`${BASE_URL}/api/v1/drive/files/${fid}`).catch(() => {});
        await page.request.delete(`${BASE_URL}/api/v1/drive/files/${fid}:forever`).catch(() => {});
      }
    }
  });
});
