import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, createDeck, getDeckData, saveDeckData, trashDeck } from "./helpers";

// Slides M5/M6: insert a table from the size picker, type into cells (Tab
// moves on), merge two cells, pick a table style; insert a picture (it goes
// to the deck's asset store), crop it to a shape, crop an edge, add alt
// text; reload and check the model and the rendering.

const SHOT = process.env.GROWN_SLIDES_M5M6_SHOT;

type El = {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  src?: string;
  crop?: { l: number; t: number; r: number; b: number };
  cropShape?: string;
  alt?: string;
  table?: {
    rows: number;
    cols: number;
    cells: string[][];
    merges?: { r: number; c: number; rs: number; cs: number }[];
    style?: string;
    look?: Record<string, boolean>;
  };
};

function waitForSave(page: Page, id: string) {
  return page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().includes(`/api/v1/slides/d/${id}/data`) && r.ok(),
    { timeout: 15_000 },
  );
}

async function toScreen(page: Page, x: number, y: number) {
  const box = (await page.getByTestId("slide-canvas").boundingBox())!;
  const s = box.width / 960;
  return { x: box.x + x * s, y: box.y + y * s };
}

async function elements(page: Page, id: string): Promise<El[]> {
  const d = (await getDeckData(page.request, id)) as { slides: { elements: El[] }[] };
  return d.slides[0].elements;
}

const cell = (page: Page, r: number, c: number) => page.locator(`[data-el-type="table"] td[data-cell="${r},${c}"]`);

/** A 300×200 PNG with a gradient (made by the browser). */
async function pngBytes(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 300;
    c.height = 200;
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 300, 200);
    grad.addColorStop(0, "#ff6d00");
    grad.addColorStop(1, "#2962ff");
    g.fillStyle = grad;
    g.fillRect(0, 0, 300, 200);
    g.fillStyle = "#ffffff";
    g.font = "bold 48px sans-serif";
    g.fillText("Grown", 70, 118);
    return c.toDataURL("image/png").split(",")[1];
  });
  return Buffer.from(b64, "base64");
}

test("table with a merge and a style, picture cropped to a shape: persist over reload", async ({ page }) => {
  const id = await createDeck(page.request, "e2e slides media");
  try {
    await saveDeckData(page.request, id, { slides: [{ id: "s1", background: "#ffffff", elements: [] }] });
    await page.goto(`${BASE_URL}/slides/d/${id}`);
    await expect(page.getByTestId("slide-canvas")).toBeVisible();

    // ---- table ----
    await page.getByRole("button", { name: "Table", exact: true }).click();
    await page.getByTestId("table-picker").locator('[data-size="3x3"]').click();
    await expect(page.locator('[data-el-type="table"]')).toHaveCount(1);
    await expect(page.getByTestId("table-controls")).toBeVisible();

    // Click a cell of the selected table: its editor opens; Tab moves on.
    await cell(page, 0, 0).click();
    await page.keyboard.type("Region");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Q1");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Q2");
    await page.keyboard.press("Escape");
    await cell(page, 1, 0).click();
    await page.keyboard.type("North");
    await page.keyboard.press("Escape");

    // Select two cells (click + Shift+click) and merge them.
    await cell(page, 1, 0).click();
    await cell(page, 2, 0).click({ modifiers: ["Shift"] });
    await expect(page.locator('td[data-selected-cell="true"]')).toHaveCount(2);
    await page.getByTestId("table-merge").click();
    await expect(page.locator('[data-el-type="table"] td[rowspan="2"]')).toHaveCount(1);

    // Pick a style from the gallery.
    await page.getByTestId("table-style").click();
    await page.locator('[data-style="Medium Style 2 - Accent 2"]').click();

    // ---- picture ----
    const bytes = await pngBytes(page);
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Image", exact: true }).click();
    const upload = page.waitForResponse((r) => r.url().includes(`/api/v1/slides/d/${id}/assets`) && r.request().method() === "POST");
    await (await chooser).setFiles({ name: "grown.png", mimeType: "image/png", buffer: bytes });
    expect((await upload).status()).toBe(201);
    const img = page.locator('[data-el-type="image"]');
    await expect(img).toHaveCount(1);
    await expect(page.getByTestId("image-controls")).toBeVisible();

    // Crop to a shape (oval).
    await page.getByTestId("image-crop-shape").click();
    await page.getByTestId("shape-gallery").getByRole("button", { name: "Oval", exact: true }).click();
    await expect(img.locator("[data-image] > div").first()).toHaveAttribute("style", /clip-path: path/);

    // Crop mode: drag the left handle inwards, then Enter.
    await page.getByRole("button", { name: "Crop", exact: true }).click();
    await expect(page.getByTestId("crop-ghost")).toBeVisible();
    const handle = (await img.locator('[data-handle="w"]').boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + 40, handle.y + handle.height / 2, { steps: 8 });
    await page.mouse.up();
    if (SHOT) await page.screenshot({ path: SHOT.replace(/\.png$/, "-crop-mode.png") });
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("crop-ghost")).toHaveCount(0);

    // Move the picture beside the table.
    const box = (await img.boundingBox())!;
    const target = await toScreen(page, 800, 330);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 10 });
    await page.mouse.up();

    // Alt text.
    await page.getByTestId("image-crop-menu").click();
    await page.getByRole("menuitem", { name: "Alt text…" }).click();
    await page.getByLabel("Alt text description").fill("Grown logo on a gradient");
    const saved = waitForSave(page, id);
    await page.getByTestId("alt-text-dialog").getByRole("button", { name: "Save" }).click();
    await saved;

    // ---- reload and check ----
    await page.reload();
    await expect(page.getByTestId("slide-canvas")).toBeVisible();
    const els = await elements(page, id);
    const table = els.find((e) => e.type === "table")!;
    expect(table.table!.cells[0]).toEqual(["Region", "Q1", "Q2"]);
    expect(table.table!.cells[1][0]).toBe("North");
    expect(table.table!.merges).toEqual([{ r: 1, c: 0, rs: 2, cs: 1 }]);
    expect(table.table!.style).toBe("{21E4AEA4-8DFA-4A89-87EB-49C32662AFE8}");
    expect(table.table!.look).toEqual({ header: true, banded: true });
    const pic = els.find((e) => e.type === "image")!;
    expect(pic.src).toMatch(new RegExp(`^/api/v1/slides/d/${id}/assets/[0-9a-f]{64}$`));
    expect(pic.cropShape).toBe("ellipse");
    expect(pic.crop!.l).toBeGreaterThan(0.05);
    expect(pic.alt).toBe("Grown logo on a gradient");
    // The asset is served to the deck's users.
    const asset = await page.request.get(`${BASE_URL}${pic.src}`);
    expect(asset.status()).toBe(200);
    expect(asset.headers()["content-type"]).toBe("image/png");

    // Rendered after reload: merged cell, header fill of the style, clipped picture.
    await expect(page.locator('[data-el-type="table"] td[rowspan="2"]')).toHaveText("North");
    await expect(cell(page, 0, 0)).toHaveCSS("background-color", "rgb(237, 125, 49)");
    const rendered = page.locator('[data-el-type="image"] img[alt="Grown logo on a gradient"]');
    await expect(rendered).toBeVisible();
    expect(await rendered.evaluate((n) => (n as HTMLImageElement).naturalWidth)).toBe(300);
    if (SHOT) await page.getByTestId("slide-canvas").screenshot({ path: SHOT });
  } finally {
    await trashDeck(page.request, id);
  }
});

test("oo:slide/shortcuts/shortcuts.js#Check main actions with shapes (table keys in the editor)", async ({ page }) => {
  const id = await createDeck(page.request, "e2e slides table keys");
  try {
    const cells = Array.from({ length: 4 }, (_, r) => Array.from({ length: 4 }, (_, c) => (r === 0 && c === 0 ? "Hello Hello" : "")));
    await saveDeckData(page.request, id, {
      slides: [
        {
          id: "s1",
          background: "#ffffff",
          elements: [{ id: "t1", type: "table", x: 80, y: 80, w: 480, h: 200, table: { rows: 4, cols: 4, cells }, fill: "none", stroke: "#bdc1c6", strokeWidth: 1, fontSize: 16 }],
        },
      ],
    });
    await page.goto(`${BASE_URL}/slides/d/${id}`);
    const t = page.locator('[data-el-type="table"]');
    await expect(t).toBeVisible();
    // Select the table, then Enter edits the first cell with its text selected.
    const b = (await t.boundingBox())!;
    await page.mouse.click(b.x + b.width - 3, b.y + b.height - 3);
    await expect(t).toHaveAttribute("data-selected", "true");
    await page.keyboard.press("Escape");
    await page.mouse.click(b.x + b.width - 3, b.y + b.height - 3);
    await page.keyboard.press("Enter");
    await expect(cell(page, 0, 0).locator("[data-text-editor]")).toBeFocused();
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("Hello Hello");
    // Tab / Shift+Tab / arrows move between cells while editing.
    await page.keyboard.press("Tab");
    await expect(cell(page, 0, 1).locator("[data-text-editor]")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(cell(page, 0, 2).locator("[data-text-editor]")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(cell(page, 0, 1).locator("[data-text-editor]")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(cell(page, 1, 1).locator("[data-text-editor]")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(cell(page, 0, 1).locator("[data-text-editor]")).toBeFocused();
    // Esc leaves the cell; arrows then move the active cell.
    await page.keyboard.press("Escape");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator('td[data-selected-cell="true"]')).toHaveAttribute("data-cell", "0,2");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator('td[data-selected-cell="true"]')).toHaveAttribute("data-cell", "0,0");
    // Shift+Right extends the selection; Backspace clears it.
    await page.keyboard.press("Shift+ArrowRight");
    await expect(page.locator('td[data-selected-cell="true"]')).toHaveCount(2);
    const saved = waitForSave(page, id);
    await page.keyboard.press("Backspace");
    await saved;
    expect((await elements(page, id))[0].table!.cells[0][0]).toBe("");
  } finally {
    await trashDeck(page.request, id);
  }
});
