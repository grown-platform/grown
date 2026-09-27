import { test, expect, type Page } from "@playwright/test";
import {
  BASE_URL,
  createDeck,
  getDeckData,
  saveDeckData,
  trashDeck,
} from "./helpers";

// Slides M3: insert preset shapes from the gallery (click and drag), draw a
// glued elbow connector between them, drag an adjust handle, move a glued
// shape, reload, and check everything persisted.

const SHOT = process.env.GROWN_SLIDES_M3_SHOT;

type El = {
  id: string;
  type: string;
  preset?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  adj?: Record<string, number>;
  stCxn?: { id: string; idx: number };
  endCxn?: { id: string; idx: number };
  tailEnd?: string;
  flipH?: boolean;
  flipV?: boolean;
};

function waitForSave(page: Page, id: string) {
  return page.waitForResponse(
    (r) =>
      r.request().method() === "PUT" &&
      r.url().includes(`/api/v1/slides/d/${id}/data`) &&
      r.ok(),
    { timeout: 15_000 },
  );
}

async function toScreen(page: Page, x: number, y: number) {
  const box = (await page.getByTestId("slide-canvas").boundingBox())!;
  const s = box.width / 960;
  return { x: box.x + x * s, y: box.y + y * s };
}

async function dragLogical(page: Page, from: [number, number], to: [number, number]) {
  const a = await toScreen(page, ...from);
  const b = await toScreen(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
}

async function pick(page: Page, label: string) {
  await page.getByRole("button", { name: "Shapes" }).click();
  await page.getByTestId("shape-gallery").getByRole("button", { name: label, exact: true }).click();
  await expect(page.getByTestId("draw-hint")).toBeVisible();
}

async function elements(page: Page, id: string): Promise<El[]> {
  const d = (await getDeckData(page.request, id)) as { slides: { elements: El[] }[] };
  return d.slides[0].elements;
}

test("oo:slide/shortcuts/shortcuts.js#Check reset action with adding new shape", async ({ page }) => {
  const id = await createDeck(page.request, "e2e slides draw cancel");
  try {
    await saveDeckData(page.request, id, { slides: [{ id: "s1", background: "#ffffff", elements: [] }] });
    await page.goto(`${BASE_URL}/slides/d/${id}`);
    await expect(page.getByTestId("slide-canvas")).toBeVisible();
    await pick(page, "Cube");
    await expect(page.getByTestId("draw-overlay")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("draw-hint")).toHaveCount(0);
    await expect(page.getByTestId("draw-overlay")).toHaveCount(0);
    // A click on the slide now draws nothing.
    const p = await toScreen(page, 480, 270);
    await page.mouse.click(p.x, p.y);
    await expect(page.getByTestId("slide-canvas").locator("[data-el-id]")).toHaveCount(0);
  } finally {
    await trashDeck(page.request, id);
  }
});

test("gallery shapes, glued connector and adjust handle persist", async ({ page }) => {
  const id = await createDeck(page.request, "e2e slides shapes");
  try {
    await saveDeckData(page.request, id, { slides: [{ id: "s1", background: "#ffffff", elements: [] }] });
    await page.goto(`${BASE_URL}/slides/d/${id}`);
    const canvas = page.getByTestId("slide-canvas");
    await expect(canvas).toBeVisible();

    // Click inserts a star at its default 160×160 size centred on the point.
    await pick(page, "5-point star");
    let p = await toScreen(page, 200, 150);
    await page.mouse.click(p.x, p.y);
    const star = canvas.locator('[data-el-type="shape"]').first();
    await expect(star.locator('svg[data-preset="star5"] path').first()).toBeVisible();

    // Drag draws a rounded rectangle from (400,100) to (600,220).
    await pick(page, "Rounded rectangle");
    await dragLogical(page, [400, 100], [600, 220]);
    await expect(canvas.locator('svg[data-preset="roundRect"]')).toHaveCount(1);

    // Elbow connector from the rectangle's left site to the star's right tip.
    await pick(page, "Elbow connector");
    await dragLogical(page, [403, 162], [283, 133]);
    await expect(canvas.locator('[data-el-type="connector"]')).toHaveCount(1);

    let els = await elements(page, id).catch(() => [] as El[]);
    // Drag the rounded rectangle's yellow adjust handle 30 px right.
    const rr = canvas.locator('[data-el-type="shape"]').nth(1);
    await rr.click({ position: { x: 60, y: 60 } });
    const handle = rr.locator('[data-handle="adj-0"]');
    await expect(handle).toBeVisible();
    const hb = (await handle.boundingBox())!;
    const s = ((await canvas.boundingBox())!.width) / 960;
    const saved = waitForSave(page, id);
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 + 30 * s, hb.y + hb.height / 2, { steps: 8 });
    await page.mouse.up();
    await saved;

    els = await elements(page, id);
    const starEl = els.find((e) => e.preset === "star5")!;
    const rrEl = els.find((e) => e.preset === "roundRect")!;
    const cx = els.find((e) => e.type === "connector")!;
    expect(starEl).toMatchObject({ type: "shape", x: 120, y: 70, w: 160, h: 160 });
    expect(rrEl).toMatchObject({ x: 400, y: 100, w: 200, h: 120 });
    // Handle started at x1 = 120·16667/100000 ≈ 20; +30 px → ≈ 50 → adj ≈ 41667.
    expect(rrEl.adj!.adj).toBeGreaterThan(38000);
    expect(rrEl.adj!.adj).toBeLessThan(45000);
    expect(cx).toMatchObject({ preset: "bentConnector3", tailEnd: "triangle" });
    expect(cx.stCxn).toEqual({ id: rrEl.id, idx: 1 });
    expect(cx.endCxn).toEqual({ id: starEl.id, idx: 4 });

    // Moving the star drags the glued connector end along.
    const moved = waitForSave(page, id);
    await dragLogical(page, [200, 200], [200, 300]);
    await moved;

    await page.reload();
    await expect(canvas.locator('svg[data-preset="bentConnector3"]')).toHaveCount(1);
    els = await elements(page, id);
    const star2 = els.find((e) => e.preset === "star5")!;
    const cx2 = els.find((e) => e.type === "connector")!;
    expect(star2.y).toBeCloseTo(170, 0);
    expect(cx2.endCxn).toEqual({ id: star2.id, idx: 4 });
    // The connector's end (bottom-left corner: flipH) sits on the star's tip.
    expect(cx2.flipH).toBe(true);
    expect(cx2.x).toBeCloseTo(280, 0);
    expect(cx2.y + cx2.h).toBeCloseTo(231.1, 0);
    expect(els.find((e) => e.preset === "roundRect")!.adj!.adj).toBe(rrEl.adj!.adj);
  } finally {
    await trashDeck(page.request, id);
  }
});

test("a slide of preset shapes renders (screenshot)", async ({ page }) => {
  const shapes: [string, string, Record<string, number>?][] = [
    ["roundRect", "#4285f4"],
    ["star5", "#fbbc04"],
    ["rightArrow", "#34a853", { adj1: 60000, adj2: 40000 }],
    ["wedgeRoundRectCallout", "#a142f4"],
    ["can", "#ea4335"],
    ["cube", "#46bdc6"],
    ["heart", "#e8398d"],
    ["flowChartDecision", "#ff6d01"],
    ["flowChartDocument", "#7baaf7"],
    ["smileyFace", "#fdd663"],
    ["mathMultiply", "#5f6368"],
    ["pie", "#81c995", { adj1: 0, adj2: 13500000 }],
    ["chevron", "#f28b82"],
    ["wave", "#a8dab5"],
  ];
  const els = shapes.map(([preset, fill, adj], i) => ({
    id: `s${i}`,
    type: "shape",
    preset,
    x: 30 + (i % 5) * 185,
    y: 30 + Math.floor(i / 5) * 170,
    w: 150,
    h: preset === "wedgeRoundRectCallout" ? 90 : 120,
    fill,
    stroke: "#3c4043",
    strokeWidth: 1.5,
    ...(adj ? { adj } : {}),
  }));
  els.push({
    id: "c1",
    type: "connector",
    preset: "curvedConnector3",
    x: 770,
    y: 390,
    w: 150,
    h: 110,
    stroke: "#202124",
    strokeWidth: 3,
    tailEnd: "triangle",
    headEnd: "oval",
  } as never);
  const id = await createDeck(page.request, "e2e slides preset gallery");
  try {
    await saveDeckData(page.request, id, { slides: [{ id: "s1", background: "#ffffff", elements: els }] });
    await page.goto(`${BASE_URL}/slides/d/${id}`);
    const canvas = page.getByTestId("slide-canvas");
    await expect(canvas.locator("[data-el-id] svg[data-preset]")).toHaveCount(els.length);
    for (const e of els)
      await expect(canvas.locator(`[data-el-id="${e.id}"] svg path`).first()).toBeAttached();
    if (SHOT) await canvas.screenshot({ path: SHOT });
  } finally {
    await trashDeck(page.request, id);
  }
});
