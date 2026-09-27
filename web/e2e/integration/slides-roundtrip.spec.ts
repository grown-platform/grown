import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, createDeck, getDeckData, saveDeckData, trashDeck } from "../helpers";
import {
  downloadFromFileMenu,
  driveDelete,
  driveOpenIn,
  driveUpload,
  openDeck,
  waitForDeckSave,
} from "./slides-helpers";

// Cross-app file round trip for Slides. A deck is built partly in the UI
// (title placeholder, theme gallery, layout, grouping, animation pane,
// speaker notes) on top of an API-seeded slide with a table and a chart.
// It is downloaded as .pptx, .odp and .pdf through File ▸ Download, and the
// .pptx/.odp are brought back three ways: Slides home "Upload", File ▸
// Import slides, and Drive upload → Open file (details panel) → "Open in Slides".
//
// Documented losses asserted as such:
// - pptx (slides.md §6.12 "Gaps"): effects on groups are not written.
// - ODP writer (docs/plans/onlyoffice-parity/slides.md §6.16 "More formats"):
//   charts are written as pictures and groups are flattened.
// - ODP reader (web/app/src/pages/slides/odp/read.ts header; added in
//   c7d6e33 after §6.16's "there is no ODP import" was written): animations,
//   tables and charts are not read (reported as warnings), groups flattened,
//   no theme.
// - PDF (slides.md §6.16 "Gaps"): a picture per page under a text layer;
//   there is no PDF import into Slides.

type El = {
  id: string;
  type: string;
  text?: string;
  children?: El[];
  table?: { cells: string[][] };
  chart?: { type: string; title?: string; data: string[][] };
  placeholder?: { type: string };
  src?: string;
};
type Slide = { id: string; layout?: string; notes?: string; anims?: { el: string; cls: string; kind: string }[]; elements: El[] };
type Deck = { theme?: { id: string; fonts?: { major: string } }; slides: Slide[] };

const deckOf = async (page: Page, id: string) => (await getDeckData(page.request, id)) as unknown as Deck;

const allTexts = (els: El[]): string[] =>
  els.flatMap((e) => [
    ...(e.text ? [e.text] : []),
    ...(e.table ? e.table.cells.flat() : []),
    ...(e.children ? allTexts(e.children) : []),
  ]);

/** Fill a placeholder: double-click, type, Esc. */
async function fillPlaceholder(page: Page, id: string, nth: number, text: string) {
  const el = page.getByTestId("slide-canvas").locator('[data-el-type="text"]').nth(nth);
  await el.dblclick();
  await page.keyboard.type(text);
  const saved = waitForDeckSave(page, id);
  await page.keyboard.press("Escape");
  await saved;
}

async function buildRichDeck(page: Page, id: string) {
  // --- UI part 1: title slide placeholder + theme ------------------------
  await openDeck(page, id);
  const canvas = page.getByTestId("slide-canvas");
  await expect(canvas.getByTestId("ph-prompt")).toHaveCount(2);
  await fillPlaceholder(page, id, 0, "Integration deck");
  await fillPlaceholder(page, id, 1, "Built in the UI");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  let saved = waitForDeckSave(page, id);
  await page.getByRole("button", { name: "Theme Coral" }).click();
  await saved;
  await page.keyboard.press("Escape");
  // A second slide from the "Two content" layout.
  await page.getByRole("button", { name: "New slide with layout" }).click();
  saved = waitForDeckSave(page, id);
  await page.getByRole("button", { name: "Layout Two content" }).click();
  await saved;
  await fillPlaceholder(page, id, 0, "Compare");
  await fillPlaceholder(page, id, 1, "Left column");
  await fillPlaceholder(page, id, 2, "Right column");
  await expect.poll(async () => (await deckOf(page, id)).slides.length).toBe(2);
  // Let the collab log settle, then leave the editor before the API seed.
  await page.goto(`${BASE_URL}/`);

  // --- API part: a third slide with a table, a chart and two shapes ------
  const d = await deckOf(page, id);
  d.slides.push({
    id: "s3",
    background: "#ffffff",
    elements: [
      {
        id: "tbl",
        type: "table",
        x: 40,
        y: 40,
        w: 420,
        h: 120,
        fontSize: 16,
        table: { rows: 3, cols: 2, cells: [["Region", "Sales"], ["North", "42"], ["South", "17"]] },
      },
      {
        id: "chart",
        type: "chart",
        x: 500,
        y: 40,
        w: 400,
        h: 260,
        chart: { type: "column", title: "Revenue", data: [["", "2025"], ["Q1", "3"], ["Q2", "5"], ["Q3", "4"]] },
      },
      { id: "ga", type: "rect", x: 60, y: 330, w: 120, h: 80, fill: "#34a853", stroke: "none", strokeWidth: 0 },
      { id: "gb", type: "ellipse", x: 240, y: 330, w: 120, h: 80, fill: "#4285f4", stroke: "none", strokeWidth: 0 },
    ],
  } as unknown as Slide);
  await saveDeckData(page.request, id, d);

  // --- UI part 2: group, animate, notes on slide 3 ------------------------
  await openDeck(page, id);
  await expect(page.getByTestId("slide-thumb")).toHaveCount(3);
  await page.getByTestId("slide-thumb").nth(2).click();
  await expect(canvas.locator('[data-el-id="ga"]')).toBeVisible();
  await canvas.locator('[data-el-id="ga"]').click();
  await canvas.locator('[data-el-id="gb"]').click({ modifiers: ["Shift"] });
  await expect(canvas.locator("[data-selected]")).toHaveCount(2);
  saved = waitForDeckSave(page, id);
  await page.keyboard.press("Control+g");
  await saved;
  const group = canvas.locator('[data-el-type="group"]');
  await expect(group).toHaveCount(1);
  const groupId = (await group.getAttribute("data-el-id"))!;

  await page.getByRole("button", { name: "Slide", exact: true }).click();
  await page.getByRole("menuitem", { name: "Transition…" }).click();
  const motion = page.getByTestId("motion-panel");
  await expect(motion).toBeVisible();
  await group.click();
  await motion.getByRole("button", { name: "Add animation" }).click();
  saved = waitForDeckSave(page, id);
  await page.getByRole("menuitem", { name: "Fade" }).first().click();
  await saved;
  await expect(page.getByTestId("anim-effect")).toHaveCount(1);
  // A second effect on a top-level shape (the table).
  await canvas.locator('[data-el-id="tbl"]').click();
  await motion.getByRole("button", { name: "Add animation" }).click();
  saved = waitForDeckSave(page, id);
  await page.getByRole("menuitem", { name: "Fade" }).first().click();
  await saved;
  await expect(page.getByTestId("anim-effect")).toHaveCount(2);

  const notes = page.getByRole("textbox", { name: "Speaker notes for this slide" });
  await notes.click();
  await notes.fill("Walk through the numbers.");
  await expect
    .poll(async () => (await deckOf(page, id)).slides[2].notes, { timeout: 15_000 })
    .toBe("Walk through the numbers.");

  const src = await deckOf(page, id);
  expect(src.theme?.id).toBe("coral");
  expect(src.slides.map((s) => s.layout)).toEqual(["title", "twoObj", undefined]);
  expect(src.slides[2].anims?.map((a) => [a.el, a.cls, a.kind])).toEqual([
    [groupId, "entr", "fade"],
    ["tbl", "entr", "fade"],
  ]);
  return { groupId };
}

/** Everything a pptx round trip must keep. */
function expectPptxSurvived(d: Deck) {
  expect(d.theme?.id ?? "", "theme").not.toBe("");
  expect(d.slides).toHaveLength(3);
  expect(allTexts(d.slides[0].elements)).toEqual(expect.arrayContaining(["Integration deck", "Built in the UI"]));
  expect(allTexts(d.slides[1].elements)).toEqual(expect.arrayContaining(["Compare", "Left column", "Right column"]));
  expect(d.slides[0].elements.map((e) => e.placeholder?.type)).toEqual(["ctrTitle", "subTitle"]);
  const s3 = d.slides[2];
  expect(s3.notes).toBe("Walk through the numbers.");
  const tbl = s3.elements.find((e) => e.type === "table");
  expect(tbl?.table?.cells).toEqual([["Region", "Sales"], ["North", "42"], ["South", "17"]]);
  const chart = s3.elements.find((e) => e.type === "chart");
  expect(chart?.chart?.type).toBe("column");
  expect(chart?.chart?.data.slice(1)).toEqual([["Q1", "3"], ["Q2", "5"], ["Q3", "4"]]);
  const grp = s3.elements.find((e) => e.type === "group");
  expect(grp?.children?.map((c) => c.type)).toEqual(["rect", "ellipse"]);
  // The table's effect survives; the group's does not: "effects on groups
  // are not written to pptx" (slides.md §6.12 Gaps) — a documented loss.
  expect(s3.anims?.map((a) => [a.el, a.cls, a.kind])).toEqual([[tbl!.id, "entr", "fade"]]);
}

/** What an .odp round trip keeps, and the documented losses. */
function expectOdpSurvived(d: Deck) {
  expect(d.slides).toHaveLength(3);
  expect(allTexts(d.slides[0].elements)).toEqual(expect.arrayContaining(["Integration deck", "Built in the UI"]));
  expect(allTexts(d.slides[1].elements)).toEqual(expect.arrayContaining(["Compare", "Left column", "Right column"]));
  const s3 = d.slides[2];
  expect(s3.notes).toBe("Walk through the numbers.");
  const types = s3.elements.map((e) => e.type);
  // Group flattened (writer §6.16 + reader): its two members arrive as top-level shapes.
  expect(types).not.toContain("group");
  expect(s3.elements.filter((e) => e.type !== "image").length).toBeGreaterThanOrEqual(2);
  // Chart → picture (writer); tables are not read back (reader warning).
  expect(types).not.toContain("chart");
  expect(types).toContain("image");
  expect(types).not.toContain("table");
  // Animations are not read (reader warning).
  expect(s3.anims ?? []).toEqual([]);
}

test.describe.serial("slides file round trips", () => {
  test("rich deck: pptx/odp/pdf download → upload, import slides, Drive open-in", async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1400, height: 900 });
    const decks: string[] = [];
    const driveFiles: string[] = [];
    const sourceId = await createDeck(page.request, "e2e integration slides");
    decks.push(sourceId);
    try {
      await buildRichDeck(page, sourceId);
      await page.reload();
      await expect(page.getByTestId("slide-thumb")).toHaveCount(3);

      const pptx = await downloadFromFileMenu(page, /Microsoft PowerPoint/);
      expect(pptx.bytes.subarray(0, 2).toString()).toBe("PK");
      expect(pptx.name).toMatch(/\.pptx$/);
      const odp = await downloadFromFileMenu(page, /ODP Document/);
      expect(odp.bytes.subarray(30, 38).toString("latin1")).toBe("mimetype");
      const pdf = await downloadFromFileMenu(page, /PDF Document/);
      const pdfText = pdf.bytes.toString("latin1");
      expect(pdfText.startsWith("%PDF-")).toBe(true);
      expect(pdfText.match(/\/Type \/Page\b(?!s)/g)).toHaveLength(3);
      expect(pdfText).toContain("(Integration deck) Tj");
      expect(pdfText).toContain("(North) Tj");

      // 1) Slides home ▸ Upload .pptx → new deck.
      await page.goto(`${BASE_URL}/slides`);
      await page.getByTestId("pptx-upload-input").setInputFiles({
        name: "integration.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        buffer: pptx.bytes,
      });
      await page.waitForURL(/\/slides\/d\/[^/]+$/);
      const fromPptx = page.url().split("/").pop()!;
      decks.push(fromPptx);
      await expect(page.getByTestId("slide-thumb")).toHaveCount(3);
      await expect(page.getByTestId("slide-thumb").first()).toContainText("Integration deck");
      await expect.poll(async () => (await deckOf(page, fromPptx))?.slides?.length ?? 0, { timeout: 15_000 }).toBe(3);
      expectPptxSurvived(await deckOf(page, fromPptx));
      // DOM: the grouped shapes and the table render on slide 3.
      await page.getByTestId("slide-thumb").nth(2).click();
      await expect(page.getByTestId("slide-canvas").locator('[data-el-type="group"]')).toHaveCount(1);
      await expect(page.getByTestId("slide-canvas").getByText("North")).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Speaker notes for this slide" })).toHaveValue("Walk through the numbers.");

      // 2) Slides home ▸ Upload .odp → new deck (documented losses).
      await page.goto(`${BASE_URL}/slides`);
      await page.getByTestId("pptx-upload-input").setInputFiles({
        name: "integration.odp",
        mimeType: "application/vnd.oasis.opendocument.presentation",
        buffer: odp.bytes,
      });
      await page.waitForURL(/\/slides\/d\/[^/]+$/);
      const fromOdp = page.url().split("/").pop()!;
      decks.push(fromOdp);
      await expect(page.getByTestId("slide-thumb")).toHaveCount(3);
      await expect.poll(async () => (await deckOf(page, fromOdp))?.slides?.length ?? 0, { timeout: 15_000 }).toBe(3);
      expectOdpSurvived(await deckOf(page, fromOdp));

      // 3) File ▸ Import slides (.pptx) into a fresh deck: appended.
      const target = await createDeck(page.request, "e2e integration import target");
      decks.push(target);
      await openDeck(page, target);
      await expect(page.getByTestId("slide-thumb")).toHaveCount(1);
      await page.getByTestId("pptx-import-input").setInputFiles({
        name: "more.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        buffer: pptx.bytes,
      });
      await expect(page.getByTestId("pptx-import-status")).toContainText("Imported 3 slides");
      await expect(page.getByTestId("slide-thumb")).toHaveCount(4);
      await expect.poll(async () => (await deckOf(page, target))?.slides?.length ?? 0, { timeout: 15_000 }).toBe(4);
      const appended = await deckOf(page, target);
      const s4 = appended.slides[3];
      expect(s4.elements.find((e) => e.type === "table")?.table?.cells[1]).toEqual(["North", "42"]);
      expect(s4.elements.find((e) => e.type === "chart")?.chart?.type).toBe("column");
      expect(s4.notes).toBe("Walk through the numbers.");

      // 4) Drive: upload the .pptx and the .odp, Open file ▸ Open in Slides.
      const pptxFile = await driveUpload(
        page,
        `e2e-integration-${Date.now()}.pptx`,
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        pptx.bytes,
      );
      driveFiles.push(pptxFile);
      const driveDeck = await driveOpenIn(page, pptxFile, "slides");
      decks.push(driveDeck);
      await expect(page.getByTestId("slide-thumb")).toHaveCount(3);
      await expect.poll(async () => (await deckOf(page, driveDeck))?.slides?.length ?? 0, { timeout: 15_000 }).toBe(3);
      expectPptxSurvived(await deckOf(page, driveDeck));

      const odpFile = await driveUpload(
        page,
        `e2e-integration-${Date.now()}.odp`,
        "application/vnd.oasis.opendocument.presentation",
        odp.bytes,
      );
      driveFiles.push(odpFile);
      const driveOdpDeck = await driveOpenIn(page, odpFile, "slides");
      decks.push(driveOdpDeck);
      await expect(page.getByTestId("slide-thumb")).toHaveCount(3);
      await expect.poll(async () => (await deckOf(page, driveOdpDeck))?.slides?.length ?? 0, { timeout: 15_000 }).toBe(3);
      expectOdpSurvived(await deckOf(page, driveOdpDeck));
    } finally {
      for (const f of driveFiles) await driveDelete(page.request, f);
      for (const d of decks) await trashDeck(page.request, d);
    }
  });
});
