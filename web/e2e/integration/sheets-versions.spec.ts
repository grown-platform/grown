import { test, expect, type Browser, type Page } from "@playwright/test";
import { STORAGE_STATE, createSheet, getSheetData, saveSheet, trashSheet } from "../helpers";
import { book, num, openSheet, shown, typeAt } from "../sheetsGrid";
import { cellAt } from "./sheets-helpers";

// Version history with a second editor open: A edits, names a version, edits
// again and restores the named version. The restore tells every open editor
// to reload (VERSION_RESTORED_MSG over the collab socket), so B shows the
// restored content without touching anything, and neither editor's autosave
// writes the stale workbook back.

async function editor(browser: Browser, id: string): Promise<Page> {
  const ctx = await browser.newContext({ storageState: STORAGE_STATE, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await openSheet(page, id);
  return page;
}

async function fileMenu(page: Page, item: string) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

async function nameVersion(page: Page, label: string) {
  await fileMenu(page, "Version history");
  const panel = page.getByTestId("version-history");
  await panel.getByRole("button", { name: "Name current version" }).click();
  await panel.getByRole("textbox", { name: "Version name" }).fill(label);
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await expect(panel.getByTestId("version-item").filter({ hasText: label })).toBeVisible();
  return panel;
}

test("sheets: a restore in one editor reloads the other with the restored content", async ({ browser, page }) => {
  test.setTimeout(180_000);
  const id = await createSheet(page.request, "e2e sheets versions 2 editors");
  const pages: Page[] = [];
  try {
    await saveSheet(page.request, id, book({ A1: num(1) }));
    const a = await editor(browser, id);
    const b = await editor(browser, id);
    pages.push(a, b);

    // Edit → name "Baseline".
    await typeAt(a, "A1", "100");
    await typeAt(a, "C3", "kept");
    await expect(async () => expect(await shown(b, "A1")).toBe("100")).toPass({ timeout: 15_000 });
    let panel = await nameVersion(a, "Baseline");
    await panel.getByRole("button", { name: "Close version history" }).click();

    // Edit again (seen live in B), name it too.
    await typeAt(a, "A1", "5");
    await typeAt(a, "B2", "changed");
    await expect(async () => {
      expect(await shown(b, "A1")).toBe("5");
      expect(await shown(b, "B2")).toBe("changed");
    }).toPass({ timeout: 15_000 });
    panel = await nameVersion(a, "Edited");

    // Restore "Baseline" in A: both editors reload.
    await panel.getByTestId("version-item").filter({ hasText: "Baseline" }).click();
    const bReloaded = b.waitForEvent("load", { timeout: 20_000 });
    await Promise.all([a.waitForEvent("load"), panel.getByRole("button", { name: "Restore this version" }).click()]);
    await bReloaded;
    await Promise.all([
      expect(a.locator(".fortune-sheet-canvas")).toBeVisible({ timeout: 20_000 }),
      expect(b.locator(".fortune-sheet-canvas")).toBeVisible({ timeout: 20_000 }),
    ]);
    await b.waitForTimeout(1_500);
    await a.waitForTimeout(1_500);
    for (const p of [a, b]) {
      await expect(async () => {
        expect(await shown(p, "A1")).toBe("100");
        expect(await shown(p, "C3")).toBe("kept");
        expect(await shown(p, "B2")).toBe("");
      }).toPass({ timeout: 20_000 });
    }

    // The saved copy is the restored one, and stays so (no stale autosave).
    await a.waitForTimeout(3_000);
    const s = (await getSheetData(page.request, id))[0];
    expect(cellAt(s, "A1")?.v).toBe(100);
    expect(cellAt(s, "C3")?.v).toBe("kept");
    expect(cellAt(s, "B2")?.v ?? "").toBe("");

    // B edits after the reload: that works and reaches A.
    await typeAt(b, "D4", "after restore");
    await expect(async () => expect(await shown(a, "D4")).toBe("after restore")).toPass({ timeout: 15_000 });
    const labels = ((await (await page.request.get(`/api/v1/versions/sheets/${id}`)).json()).versions as { label: string }[]).map((v) => v.label);
    expect(labels).toEqual(expect.arrayContaining(["Restored “Baseline”", "Edited", "Baseline"]));
  } finally {
    for (const p of pages) await p.context().close();
    await trashSheet(page.request, id);
  }
});
