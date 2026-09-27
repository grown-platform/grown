import { test, expect, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { BASE_URL, createDeck, saveDeckData, trashDeck } from "./helpers";

// Slides M12: a feature-rich deck exported as a PDF file (page count, every
// page non-blank, searchable text), PNG (current slide at 1920 px, and every
// slide in a zip), and File ▸ Print with the handouts preview and a notes-
// pages PDF. GROWN_SLIDES_M12_SHOT=<prefix> saves the handouts preview and
// the first PDF page picture as <prefix>handouts.png / <prefix>pdf-page.jpg.

const SHOT = process.env.GROWN_SLIDES_M12_SHOT;

// A 4×4 red PNG (so the picture is visible in the export).
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGP4z8AARwzEcQCukw/x0F8jngAAAABJRU5ErkJggg==";

const text = (id: string, x: number, y: number, w: number, h: number, t: string, extra: object = {}) => ({
  id,
  type: "text",
  x,
  y,
  w,
  h,
  text: t,
  fontSize: 24,
  color: "#202124",
  fontFamily: "Arial",
  ...extra,
});

const DECK = {
  slides: [
    {
      id: "s1",
      background: "#ffffff",
      bgFill: { kind: "gradient", stops: [{ pos: 0, color: "#fff7e0" }, { pos: 1, color: "#e0ecff" }], angle: 90 },
      notes: "Open with the revenue story.",
      elements: [
        text("title", 40, 24, 600, 70, "Quarterly review", {
          fontSize: 40,
          runs: [
            { text: "Quarterly ", bold: true, color: "#c5221f" },
            { text: "review" },
          ],
        }),
        text("bul", 40, 110, 420, 160, "Revenue up twelve percent across every region we operate in\nCosts flat\nHiring on plan", { list: "bullet", fontSize: 20 }),
        {
          id: "tbl",
          type: "table",
          x: 500,
          y: 110,
          w: 420,
          h: 120,
          fontSize: 16,
          table: { rows: 3, cols: 2, cells: [["Region", "Growth"], ["North", "14%"], ["South", "9%"]] },
        },
        { id: "star", type: "shape", preset: "star5", x: 520, y: 260, w: 120, h: 120, fill: "#fbbc04", stroke: "#b06000", strokeWidth: 2, rotation: 15 },
        {
          id: "grp",
          type: "group",
          x: 680,
          y: 270,
          w: 240,
          h: 100,
          children: [
            { id: "g1", type: "rect", x: 680, y: 270, w: 100, h: 100, fill: "#34a853" },
            { id: "g2", type: "ellipse", x: 820, y: 270, w: 100, h: 100, fill: "#4285f4" },
          ],
        },
        { id: "pic", type: "image", x: 40, y: 300, w: 160, h: 160, src: PNG, alt: "Red square" },
        {
          id: "chart",
          type: "chart",
          x: 220,
          y: 290,
          w: 280,
          h: 200,
          chart: { type: "column", title: "Sales", data: [["", "2025"], ["Q1", "3"], ["Q2", "5"], ["Q3", "4"]] },
        },
      ],
    },
    {
      id: "s2",
      background: "#1a73e8",
      elements: [text("t2", 80, 200, 800, 120, "Thank you", { fontSize: 60, color: "#ffffff", align: "center", valign: "middle" })],
    },
    {
      id: "s3",
      background: "#ffffff",
      hidden: true,
      notes: "Backup slide.",
      elements: [text("t3", 80, 80, 800, 80, "Appendix")],
    },
  ],
};

async function openDeck(page: Page, id: string) {
  await page.goto(`${BASE_URL}/slides/d/${id}`);
  await expect(page.getByRole("textbox", { name: "Presentation title" })).toBeVisible();
  await expect(page.getByTestId("slide-thumb")).toHaveCount(3);
}

async function download(page: Page, label: RegExp): Promise<Buffer> {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByText("Download", { exact: true }).click();
  const dl = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("menuitem", { name: label }).click();
  return readFile(await (await dl).path());
}

/** The JPEG page pictures of a PDF written by pdfWriter (one per page). */
function pdfJpegs(pdf: Buffer): Buffer[] {
  const out: Buffer[] = [];
  const s = pdf.toString("latin1");
  const re = /\/Filter \/DCTDecode \/Length (\d+) >>\nstream\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    out.push(pdf.subarray(start, start + Number(m[1])));
  }
  return out;
}

/** Standard deviation of the pixel luminance of an image (0 = blank). */
async function spread(page: Page, bytes: Buffer, mime: string): Promise<number> {
  return page.evaluate(
    async ({ b64, mime }) => {
      const blob = await (await fetch(`data:${mime};base64,${b64}`)).blob();
      const bmp = await createImageBitmap(blob);
      const c = document.createElement("canvas");
      c.width = 200;
      c.height = Math.round((200 * bmp.height) / bmp.width);
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      let sq = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
        sum += l;
        sq += l * l;
      }
      return Math.sqrt(sq / n - (sum / n) ** 2);
    },
    { b64: bytes.toString("base64"), mime },
  );
}

test.describe.serial("slides export and print", () => {
  test("PDF, PNG and PNG zip downloads of a feature-rich deck", async ({ page }) => {
    const id = await createDeck(page.request, "e2e export deck");
    try {
      await saveDeckData(page.request, id, DECK);
      await openDeck(page, id);

      // PDF: one page per slide (the download includes hidden slides).
      const pdf = await download(page, /PDF Document/);
      const src = pdf.toString("latin1");
      expect(src.startsWith("%PDF-1.4")).toBe(true);
      expect(src.match(/\/Type \/Page\b(?!s)/g)).toHaveLength(3);
      expect(src).toContain("/MediaBox [0 0 720 405]");
      // Searchable text layer: the title and the table's text are in it.
      expect(src).toContain("(Quarterly review) Tj");
      expect(src).toContain("(North) Tj");
      const jpegs = pdfJpegs(pdf);
      expect(jpegs).toHaveLength(3);
      for (const j of jpegs) expect(await spread(page, j, "image/jpeg")).toBeGreaterThan(5);
      if (SHOT) {
        await writeFile(`${SHOT}pdf.pdf`, pdf);
        await writeFile(`${SHOT}pdf-page.jpg`, jpegs[0]);
      }

      // PNG of the current slide at 1920 × 1080.
      const png = await download(page, /PNG image \(\.png, current slide\)/);
      expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
      expect(png.readUInt32BE(16)).toBe(1920);
      expect(png.readUInt32BE(20)).toBe(1080);
      expect(await spread(page, png, "image/png")).toBeGreaterThan(5);

      // Every slide as PNG in a zip.
      const zip = await download(page, /PNG images, all slides/);
      const names = zip.toString("latin1").match(/slide-0\d\.png/g) ?? [];
      expect([...new Set(names)]).toEqual(["slide-01.png", "slide-02.png", "slide-03.png"]);

      // ODP: mimetype first and stored, one draw:page per slide.
      const odp = await download(page, /ODP Document/);
      expect(odp.subarray(30, 38).toString("latin1")).toBe("mimetype");
      expect(odp.subarray(38, 85).toString("latin1")).toBe("application/vnd.oasis.opendocument.presentation");
      if (SHOT) await writeFile(`${SHOT}deck.odp`, odp);
    } finally {
      await trashDeck(page.request, id);
    }
  });

  test("print dialog: handouts preview, range, hidden slides and a notes-pages PDF", async ({ page }) => {
    const id = await createDeck(page.request, "e2e print deck");
    try {
      await saveDeckData(page.request, id, DECK);
      await openDeck(page, id);
      await page.getByTestId("slide-canvas").click({ position: { x: 5, y: 5 } });
      await page.keyboard.press("ControlOrMeta+p");
      const dialog = page.getByTestId("print-dialog");
      await expect(dialog).toBeVisible();
      // Full slides, hidden slide skipped: 2 pages.
      await expect(page.getByTestId("print-page-count")).toHaveText("Page 1 of 2");

      await dialog.getByRole("combobox", { name: "Print layout" }).click();
      await page.getByRole("option", { name: "Handouts" }).click();
      await dialog.getByRole("combobox", { name: "Slides per page" }).click();
      await page.getByRole("option", { name: "3", exact: true }).click();
      await dialog.getByRole("checkbox", { name: "Include hidden slides" }).check();
      await expect(page.getByTestId("print-page-count")).toHaveText("Page 1 of 1");
      const preview = page.getByTestId("print-preview-page");
      await expect(preview).toHaveAttribute("alt", "Preview of page 1 of 1");
      // The preview is a portrait letter page with the three slides on it.
      const img = await preview.evaluate(async (el: HTMLImageElement) => {
        await el.decode();
        const svg = atob(el.src.split(",")[1]);
        return { w: el.naturalWidth, h: el.naturalHeight, slides: (svg.match(/viewBox="0 0 960 /g) ?? []).length, lines: (svg.match(/<line /g) ?? []).length };
      });
      expect(img.h).toBeGreaterThan(img.w);
      expect(img.slides).toBe(3);
      expect(img.lines).toBeGreaterThanOrEqual(21); // 7 note lines per slide
      if (SHOT) await dialog.screenshot({ path: `${SHOT}handouts.png` });

      // A custom range that doesn't parse prints nothing.
      await dialog.getByRole("radio", { name: "Custom range" }).check();
      await dialog.getByRole("textbox", { name: "Custom slide range" }).fill("9");
      await expect(page.getByTestId("print-page-count")).toHaveText("0 pages");
      await dialog.getByRole("textbox", { name: "Custom slide range" }).fill("1, 3");
      await expect(page.getByTestId("print-page-count")).toHaveText("Page 1 of 1");

      // Notes pages as a PDF: slides 1 and 3, with their notes as text.
      await dialog.getByRole("combobox", { name: "Print layout" }).click();
      await page.getByRole("option", { name: "Notes pages" }).click();
      await expect(page.getByTestId("print-page-count")).toHaveText("Page 1 of 2");
      const dl = page.waitForEvent("download", { timeout: 30_000 });
      await page.getByTestId("print-download-pdf").click();
      const pdf = await readFile(await (await dl).path());
      const src = pdf.toString("latin1");
      expect(src.match(/\/Type \/Page\b(?!s)/g)).toHaveLength(2);
      expect(src).toContain("/MediaBox [0 0 612 792]");
      expect(src).toContain("(Open with the revenue story.) Tj");
      expect(src).toContain("(Backup slide.) Tj");
      for (const j of pdfJpegs(pdf)) expect(await spread(page, j, "image/jpeg")).toBeGreaterThan(3);
    } finally {
      await trashDeck(page.request, id);
    }
  });
});
