import { test, expect, type Browser, type Page } from "@playwright/test";
import { BASE_URL, STORAGE_STATE, createDeck, getDeckData, saveDeckData, trashDeck } from "../helpers";
import { openDeck, waitForDeckSave } from "./slides-helpers";

// Version history across two open editors (Slides): A names a version, both
// editors change the deck, A restores the named version, and B, which still
// holds the newer deck, reloads by itself (the hub relays "versionRestored")
// and shows the restored deck. B must not autosave its stale copy over the
// restore afterwards.

const text = (id: string, t: string) => ({
  id,
  type: "text",
  x: 80,
  y: 80,
  w: 800,
  h: 100,
  text: t,
  fontSize: 32,
  color: "#202124",
  fontFamily: "Arial",
});

async function openCtx(browser: Browser, id: string): Promise<Page> {
  const ctx = await browser.newContext({ storageState: STORAGE_STATE, viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await openDeck(page, id);
  return page;
}

async function fileMenu(page: Page, item: string) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

async function nameVersion(page: Page, label: string) {
  const panel = page.getByTestId("version-history");
  await panel.getByRole("button", { name: "Name current version" }).click();
  await panel.getByRole("textbox", { name: "Version name" }).fill(label);
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await expect(panel.getByTestId("version-item").filter({ hasText: label })).toBeVisible();
}

const texts = async (page: Page, id: string) =>
  ((await getDeckData(page.request, id))?.slides ?? []).map((s) => s.elements.map((e: { text?: string }) => e.text ?? "").join("|"));

test("slides: restore in one editor reloads the other onto the restored deck", async ({ browser, page }) => {
  test.setTimeout(120_000);
  const id = await createDeck(page.request, "e2e integration slides versions");
  try {
    await saveDeckData(page.request, id, { slides: [{ id: "s1", background: "#ffffff", elements: [text("t1", "Alpha")] }] });
    const A = await openCtx(browser, id);
    const B = await openCtx(browser, id);

    await fileMenu(A, "Version history");
    await nameVersion(A, "Alpha only");
    await A.getByTestId("version-history").getByRole("button", { name: "Close version history" }).click();

    // A adds a slide; B sees it live. B then edits the first slide's text.
    const s1 = waitForDeckSave(A, id);
    await A.getByRole("button", { name: "New slide" }).first().click();
    await s1;
    await expect(B.getByTestId("slide-thumb")).toHaveCount(2, { timeout: 10_000 });
    await B.getByTestId("slide-thumb").first().click();
    await B.getByTestId("slide-canvas").locator('[data-el-id="t1"]').dblclick();
    await B.keyboard.press("End");
    await B.keyboard.type(" edited by B");
    const s2 = waitForDeckSave(B, id);
    await B.keyboard.press("Escape");
    await s2;
    await expect.poll(() => texts(page, id)).toEqual(["Alpha edited by B", expect.any(String)]);
    await expect(A.getByTestId("slide-thumb").first()).toContainText("Alpha edited by B", { timeout: 10_000 });

    // A restores "Alpha only": both editors reload.
    await fileMenu(A, "Version history");
    const panel = A.getByTestId("version-history");
    await panel.getByTestId("version-item").filter({ hasText: "Alpha only" }).click();
    await expect(panel.getByTestId("deck-version-slide")).toHaveCount(1);
    const bReloaded = B.waitForEvent("load", { timeout: 20_000 });
    await Promise.all([A.waitForEvent("load"), panel.getByRole("button", { name: "Restore this version" }).click()]);
    await bReloaded;

    for (const p of [A, B]) {
      await expect(p.getByText("live", { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(p.getByTestId("slide-thumb")).toHaveCount(1);
      await expect(p.getByTestId("slide-canvas").locator('[data-el-id="t1"]')).toHaveText("Alpha");
    }
    // Nothing stale is written back over the restore.
    await A.waitForTimeout(3000);
    expect(await texts(page, id)).toEqual(["Alpha"]);

    // Both still edit together after the restore.
    await A.getByTestId("slide-canvas").locator('[data-el-id="t1"]').dblclick();
    await A.keyboard.press("End");
    await A.keyboard.type(" again");
    const s3 = waitForDeckSave(A, id);
    await A.keyboard.press("Escape");
    await s3;
    await expect(B.getByTestId("slide-canvas").locator('[data-el-id="t1"]')).toHaveText("Alpha again", { timeout: 10_000 });

    await A.context().close();
    await B.context().close();
  } finally {
    await trashDeck(page.request, id);
  }
});
