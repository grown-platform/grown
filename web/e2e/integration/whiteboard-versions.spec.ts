import { test, expect, type Browser, type Page } from "@playwright/test";
import { BASE_URL, STORAGE_STATE } from "../helpers";

// Version history across two open whiteboards: A names a version through
// the panel, A draws a rectangle (B receives it live, and it autosaves), A
// restores the named version, and B reloads by itself onto the restored
// scene without writing its stale scene back.

const rect = (id: string, x: number) => ({
  id, type: "rectangle", x, y: 40, width: 160, height: 100, angle: 0,
  strokeColor: "#1e1e1e", backgroundColor: "#a5d8ff", fillStyle: "solid",
  strokeWidth: 2, strokeStyle: "solid", roughness: 0, opacity: 100, groupIds: [],
  frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1,
  isDeleted: false, boundElements: null, updated: 1, link: null, locked: false,
});

type El = { id: string; type: string; isDeleted?: boolean };

async function liveElements(page: Page, id: string): Promise<El[]> {
  const r = await page.request.get(`${BASE_URL}/api/v1/whiteboards/d/${id}`);
  const body = await r.json();
  const els: El[] = body.data ? JSON.parse(body.data).elements ?? [] : [];
  return els.filter((e) => !e.isDeleted);
}

async function openBoard(browser: Browser, id: string): Promise<Page> {
  const ctx = await browser.newContext({ storageState: STORAGE_STATE, viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}/whiteboard/d/${id}`);
  await expect(page.getByTestId("whiteboard-canvas")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("live", { exact: true })).toBeVisible({ timeout: 20_000 });
  return page;
}

async function openHistory(page: Page) {
  await page.getByTestId("whiteboard-file-menu").click();
  await page.getByRole("menuitem", { name: "Version history" }).click();
  return page.getByTestId("version-history");
}

/** Draw a rectangle with the toolbar rectangle tool in the lower right of the canvas. */
async function drawRect(page: Page) {
  const box = (await page.getByTestId("whiteboard-canvas").boundingBox())!;
  await page.getByTitle(/^Rectangle/).click();
  const x = box.x + box.width * 0.6;
  const y = box.y + box.height * 0.6;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 150, y + 90, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
}

test("whiteboard: restore in one editor reloads the other onto the restored scene", async ({ browser, page }) => {
  test.setTimeout(120_000);
  const created = await page.request.post(`${BASE_URL}/api/v1/whiteboards`, { data: { title: "e2e integration board versions" } });
  const id = (await created.json()).id as string;
  try {
    await page.request.put(`${BASE_URL}/api/v1/whiteboards/d/${id}/data`, {
      data: { data: JSON.stringify({ elements: [rect("r1", 40)], files: {} }) },
    });
    const A = await openBoard(browser, id);
    const B = await openBoard(browser, id);

    let panel = await openHistory(A);
    await panel.getByRole("button", { name: "Name current version" }).click();
    await panel.getByRole("textbox", { name: "Version name" }).fill("One box");
    await panel.getByRole("button", { name: "Save", exact: true }).click();
    await expect(panel.getByTestId("version-item").filter({ hasText: "One box" })).toBeVisible();
    await panel.getByRole("button", { name: "Close version history" }).click();

    // A draws a second rectangle; it autosaves.
    await drawRect(A);
    await expect.poll(async () => (await liveElements(page, id)).length, { timeout: 15_000 }).toBe(2);

    // Restore "One box" in A: both editors reload.
    panel = await openHistory(A);
    await panel.getByTestId("version-item").filter({ hasText: "One box" }).click();
    await expect(panel.getByTestId("board-version-svg").locator("svg")).toBeVisible();
    const bReloaded = B.waitForEvent("load", { timeout: 20_000 });
    await Promise.all([A.waitForEvent("load"), panel.getByRole("button", { name: "Restore this version" }).click()]);
    await bReloaded;
    for (const p of [A, B]) {
      await expect(p.getByTestId("whiteboard-canvas")).toBeVisible({ timeout: 20_000 });
      await expect(p.getByText("live", { exact: true })).toBeVisible({ timeout: 20_000 });
    }
    // The restored scene holds the one box, and neither editor writes a
    // stale scene back over it.
    await B.waitForTimeout(3000);
    const after = await liveElements(page, id);
    expect(after.map((e) => e.id)).toEqual(["r1"]);

    // B's reloaded editor is on the restored scene: drawing there adds to it
    // (one box + one new = 2), rather than to the pre-restore scene (3).
    await drawRect(B);
    await expect.poll(async () => (await liveElements(page, id)).length, { timeout: 15_000 }).toBe(2);

    await A.context().close();
    await B.context().close();
  } finally {
    await page.request.delete(`${BASE_URL}/api/v1/whiteboards/d/${id}`);
  }
});
