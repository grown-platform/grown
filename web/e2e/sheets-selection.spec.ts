import { test, expect, type Page } from "@playwright/test";
import { createSheet, trashSheet, saveSheet, workbookWithCells } from "./helpers";

// The grid selection stays where the user put it: after the sheet opens,
// after an edit (and the autosave + server recalc that follows it), and
// across a dialog opening and closing. FortuneSheet paints the grid on a
// canvas; the name box (.fortune-name-box) is DOM.

async function openSheet(page: Page, id: string) {
  await page.goto(`/sheets/d/${id}`);
  await expect(page.locator(".fortune-sheet-canvas")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("live", { exact: true })).toBeVisible({ timeout: 20_000 });
}

// Click a cell on the canvas by its row/column header positions.
async function clickCell(page: Page, ref: string) {
  const col = ref.replace(/\d+/g, "").charCodeAt(0) - 65;
  const row = Number(ref.replace(/\D+/g, "")) - 1;
  const area = page.locator(".fortune-cell-area");
  // FortuneSheet's defaults: 73px columns, 19px rows (+1px grid line).
  await area.click({ position: { x: col * 74 + 30, y: row * 20 + 10 } });
  await expect(page.locator(".fortune-name-box")).toHaveText(ref);
}

// The name box holds `want` now and for the next `ms` (nothing snaps it back).
async function staysAt(page: Page, want: string, ms: number) {
  const box = page.locator(".fortune-name-box");
  await expect(box).toHaveText(want);
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    await page.waitForTimeout(250);
    expect(await box.textContent()).toBe(want);
  }
}

test("the selection survives open, edits, autosave + recalc and dialogs", async ({ page }) => {
  const id = await createSheet(page.request, "e2e selection");
  try {
    // A formula makes every autosave run the server recalc round-trip.
    await saveSheet(
      page.request,
      id,
      workbookWithCells([
        { r: 0, c: 0, v: 2 },
        { r: 0, c: 1, f: "=A1*3" },
      ]),
    );
    await openSheet(page, id);
    // A fresh sheet opens on a clean A1 (not "A1:NaN").
    await expect(page.locator(".fortune-name-box")).toHaveText("A1");

    // Selecting right after open sticks.
    await clickCell(page, "C5");
    await staysAt(page, "C5", 3_000);

    // Type + Enter moves down to C6 and stays there through the autosave
    // (1.5s debounce) and the server recalc that follows it.
    await page.keyboard.type("42");
    await page.keyboard.press("Enter");
    await staysAt(page, "C6", 5_000);

    // A second edit, then a dialog: open and close it.
    await page.keyboard.type("7");
    await page.keyboard.press("Enter");
    await expect(page.locator(".fortune-name-box")).toHaveText("C7");
    await page.getByRole("button", { name: "Format", exact: true }).click();
    await page.getByRole("menuitem", { name: "Custom number format…" }).click();
    await expect(page.getByLabel("Format code")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("Format code")).toBeHidden();
    await staysAt(page, "C7", 4_000);
  } finally {
    await trashSheet(page.request, id);
  }
});
