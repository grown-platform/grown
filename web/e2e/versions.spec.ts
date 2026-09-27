import { test, expect, type Page } from "@playwright/test";
import {
  BASE_URL,
  createDeck,
  createSheet,
  getDeckData,
  getSheetData,
  saveSheet,
  trashDeck,
  trashSheet,
  workbookWithCells,
} from "./helpers";

// Version history (CC7) for Sheets, Slides and Whiteboards: File ▸ Version
// history opens a panel listing versions; name one, change the document, name
// again, preview the diff, restore the first, and check the document and the
// history (a restore appends a version, it never removes one).
//
// VERSIONS_SCREENSHOT=<path> saves a screenshot of the Sheets panel.

async function openFileMenuItem(page: Page, item: string) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

async function nameCurrentVersion(page: Page, label: string) {
  const panel = page.getByTestId("version-history");
  await panel.getByRole("button", { name: "Name current version" }).click();
  await panel.getByRole("textbox", { name: "Version name" }).fill(label);
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await expect(panel.getByTestId("version-item").filter({ hasText: label })).toBeVisible();
}

async function versionLabels(page: Page, kind: string, id: string): Promise<string[]> {
  const r = await page.request.get(`${BASE_URL}/api/v1/versions/${kind}/${id}`);
  expect(r.ok()).toBeTruthy();
  const body = await r.json();
  return body.versions.map((v: { label: string }) => v.label);
}

// Click a cell on the FortuneSheet canvas (73px columns, 19px rows + 1px lines).
async function clickCell(page: Page, ref: string) {
  const col = ref.replace(/\d+/g, "").charCodeAt(0) - 65;
  const row = Number(ref.replace(/\D+/g, "")) - 1;
  await page.locator(".fortune-cell-area").click({ position: { x: col * 74 + 30, y: row * 20 + 10 } });
  await expect(page.locator(".fortune-name-box")).toHaveText(ref);
}

function cellValues(wb: any[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of wb?.[0]?.celldata ?? []) out[`${c.r},${c.c}`] = c.v?.m ?? c.v?.v;
  return out;
}

test("sheets: name, edit, preview what changed, restore", async ({ page }) => {
  const id = await createSheet(page.request, "e2e versions sheet");
  try {
    await saveSheet(page.request, id, workbookWithCells([{ r: 0, c: 0, v: 100 }]));
    await page.goto(`/sheets/d/${id}`);
    await expect(page.locator(".fortune-sheet-canvas")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("live", { exact: true })).toBeVisible({ timeout: 20_000 });

    await openFileMenuItem(page, "Version history");
    const panel = page.getByTestId("version-history");
    await expect(panel).toBeVisible();
    // The first save already produced an automatic snapshot.
    await expect(panel.getByTestId("version-item")).toHaveCount(1);
    // The editor re-saves its normalized workbook when the panel opens, so the
    // named version is a new row next to the automatic one.
    await nameCurrentVersion(page, "Baseline");
    await expect(panel.getByTestId("version-item")).toHaveCount(2);
    await panel.getByRole("button", { name: "Close version history" }).click();

    // Edit two cells in the grid.
    await clickCell(page, "B2");
    await page.keyboard.type("changed");
    await page.keyboard.press("Enter");
    await clickCell(page, "A1");
    await page.keyboard.type("5");
    await page.keyboard.press("Enter");

    // Opening the panel flushes the autosave; name the edited state.
    await openFileMenuItem(page, "Version history");
    await nameCurrentVersion(page, "Edited");
    await expect(panel.getByTestId("version-item")).toHaveCount(3);

    // Preview "Edited": what changed vs "Baseline", with the cells highlighted.
    await panel.getByTestId("version-item").filter({ hasText: "Edited" }).click();
    await expect(panel.getByTestId("version-summary")).toHaveText(
      "2 cells changed since the previous version",
    );
    const grid = panel.getByTestId("sheet-version-grid");
    await expect(grid.locator('[data-cell="B2"]')).toHaveText("changed");
    await expect(grid.locator('[data-cell="B2"]')).toHaveAttribute("data-changed", "true");
    await expect(grid.locator('[data-cell="A1"]')).toHaveAttribute("data-changed", "true");
    await expect(grid.locator('[data-cell="A2"]')).not.toHaveAttribute("data-changed", "true");
    if (process.env.VERSIONS_SCREENSHOT) {
      await page.screenshot({ path: process.env.VERSIONS_SCREENSHOT });
    }

    // Rename it.
    await panel.getByRole("textbox", { name: "Version name" }).fill("Edited twice");
    await panel.getByRole("button", { name: "Rename" }).click();
    await expect(panel.getByTestId("version-title")).toHaveText("Edited twice");

    // Back to the list; preview and restore "Baseline".
    await panel.getByRole("button", { name: "← All versions" }).click();
    await panel.getByTestId("version-item").filter({ hasText: "Baseline" }).click();
    await expect(panel.getByTestId("sheet-version-grid").locator('[data-cell="A1"]')).toHaveText("100");
    await expect(panel.getByTestId("sheet-version-grid").locator('[data-cell="B2"]')).toHaveText("");
    await Promise.all([
      page.waitForEvent("load"),
      panel.getByRole("button", { name: "Restore this version" }).click(),
    ]);
    await expect(page.locator(".fortune-sheet-canvas")).toBeVisible({ timeout: 20_000 });

    // The document is back to Baseline …
    const cells = cellValues(await getSheetData(page.request, id));
    expect(String(cells["0,0"])).toBe("100");
    expect(cells["1,1"]).toBeUndefined();
    // … and the history kept everything, with the restore on top.
    expect(await versionLabels(page, "sheets", id)).toEqual([
      "Restored “Baseline”",
      "Edited twice",
      "Baseline",
      "",
    ]);
    await openFileMenuItem(page, "Version history");
    await expect(panel.getByTestId("version-item").first()).toContainText("Restored “Baseline”");
    await expect(panel.getByTestId("version-item").first()).toContainText("restore");
  } finally {
    await trashSheet(page.request, id);
  }
});

function waitForDeckSave(page: Page, id: string) {
  return page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().includes(`/api/v1/slides/d/${id}/data`) && r.ok(),
    { timeout: 15_000 },
  );
}

test("slides: name, add a slide, preview, restore", async ({ page }) => {
  const id = await createDeck(page.request, "e2e versions deck");
  try {
    await page.goto(`${BASE_URL}/slides/d/${id}`);
    await expect(page.getByRole("textbox", { name: "Presentation title" })).toBeVisible();

    await openFileMenuItem(page, "Version history");
    const panel = page.getByTestId("version-history");
    await nameCurrentVersion(page, "One slide");
    await panel.getByRole("button", { name: "Close version history" }).click();

    // Add a slide with a text box.
    const saved1 = waitForDeckSave(page, id);
    await page.getByRole("button", { name: "New slide" }).first().click();
    await saved1;
    const saved2 = waitForDeckSave(page, id);
    await page.getByRole("button", { name: "Text box" }).click();
    await saved2;
    expect((await getDeckData(page.request, id))?.slides).toHaveLength(2);

    await openFileMenuItem(page, "Version history");
    await nameCurrentVersion(page, "Two slides");
    await panel.getByTestId("version-item").filter({ hasText: "Two slides" }).click();
    await expect(panel.getByTestId("version-summary")).toHaveText(
      "1 slide added since the previous version",
    );
    await expect(panel.getByTestId("deck-version-slide")).toHaveCount(2);
    await expect(panel.getByTestId("deck-version-slide").nth(1)).toHaveAttribute("data-changed", "new");

    await panel.getByRole("button", { name: "← All versions" }).click();
    await panel.getByTestId("version-item").filter({ hasText: "One slide" }).click();
    await expect(panel.getByTestId("deck-version-slide")).toHaveCount(1);
    await Promise.all([
      page.waitForEvent("load"),
      panel.getByRole("button", { name: "Restore this version" }).click(),
    ]);
    await expect(page.getByRole("textbox", { name: "Presentation title" })).toBeVisible();

    expect((await getDeckData(page.request, id))?.slides).toHaveLength(1);
    expect(await versionLabels(page, "slides", id)).toEqual([
      "Restored “One slide”",
      "Two slides",
      "One slide",
    ]);
  } finally {
    await trashDeck(page.request, id);
  }
});

test("whiteboards: the panel lists, previews and restores board versions", async ({ page }) => {
  const created = await page.request.post(`${BASE_URL}/api/v1/whiteboards`, {
    data: { title: "e2e versions board" },
  });
  const id = (await created.json()).id as string;
  const rect = (x: number) => ({
    id: "r1", type: "rectangle", x, y: 10, width: 120, height: 80, angle: 0,
    strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid",
    strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [],
    frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1,
    isDeleted: false, boundElements: null, updated: 1, link: null, locked: false,
  });
  const save = (x: number) =>
    page.request.put(`${BASE_URL}/api/v1/whiteboards/d/${id}/data`, {
      data: { data: JSON.stringify({ elements: [rect(x)], files: {} }) },
    });
  try {
    await save(10); // first save → auto snapshot
    const named = await page.request.post(`${BASE_URL}/api/v1/versions/whiteboards/${id}`, {
      data: { label: "At 10" },
    });
    expect(named.ok()).toBeTruthy();
    await save(300);

    await page.goto(`${BASE_URL}/whiteboard/d/${id}`);
    await expect(page.getByTestId("whiteboard-canvas")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("whiteboard-file-menu").click();
    await page.getByRole("menuitem", { name: "Version history" }).click();
    const panel = page.getByTestId("version-history");
    await panel.getByTestId("version-item").filter({ hasText: "At 10" }).click();
    await expect(panel.getByTestId("board-version-svg").locator("svg")).toBeVisible();
    await Promise.all([
      page.waitForEvent("load"),
      panel.getByRole("button", { name: "Restore this version" }).click(),
    ]);
    const r = await page.request.get(`${BASE_URL}/api/v1/whiteboards/d/${id}`);
    const scene = JSON.parse((await r.json()).data);
    expect(scene.elements[0].x).toBe(10);
    const labels = await versionLabels(page, "whiteboards", id);
    expect(labels[0]).toBe("Restored “At 10”");
    expect(labels).toContain("At 10");
  } finally {
    await page.request.delete(`${BASE_URL}/api/v1/whiteboards/d/${id}`);
  }
});

test("versions API refuses unknown documents", async ({ page }) => {
  const r = await page.request.get(
    `${BASE_URL}/api/v1/versions/sheets/00000000-0000-0000-0000-000000000001`,
  );
  expect(r.status()).toBe(404);
});
