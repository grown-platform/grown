import { test, expect, type Browser, type Page } from "@playwright/test";
import { BASE_URL, STORAGE_STATE, createDeck, getDeckData, saveDeckData, trashDeck } from "../helpers";
import { openDeck } from "./slides-helpers";

// Gaps left by web/e2e/slides-collab.spec.ts (which covers presence,
// concurrent moves of one element, a stale op, own-op undo of a move and
// comments): concurrent *text* editing. Two editors type into different
// text boxes at once, then into the same box one after the other, one
// formats a box while the other types in it, one undoes its own typing, and
// both views, the saved deck and a reload all agree.

const box = (id: string, y: number, text: string) => ({
  id,
  type: "text",
  x: 80,
  y,
  w: 700,
  h: 80,
  text,
  fontSize: 28,
  color: "#202124",
  fontFamily: "Arial",
});

async function openCtx(browser: Browser, id: string): Promise<Page> {
  const ctx = await browser.newContext({ storageState: STORAGE_STATE, viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await openDeck(page, id);
  return page;
}

const el = (p: Page, id: string) => p.getByTestId("slide-canvas").locator(`[data-el-id="${id}"]`);

/** Enter a text box, go to the end of its text, type, leave with Esc. */
async function append(p: Page, id: string, text: string) {
  await el(p, id).dblclick();
  await p.keyboard.press("ControlOrMeta+End");
  await p.waitForTimeout(100);
  await p.keyboard.type(text);
  await p.keyboard.press("Escape");
}

type Saved = { id: string; text?: string; bold?: boolean; runs?: { text: string; bold?: boolean }[] };
async function saved(p: Page, deckId: string): Promise<Record<string, Saved>> {
  const d = await getDeckData(p.request, deckId);
  return Object.fromEntries((d?.slides[0].elements ?? []).map((e: Saved) => [e.id, e]));
}

/** Whether the box's text renders bold (some node under it at weight ≥ 600). */
function boldRendered(p: Page, id: string) {
  return el(p, id).evaluate((root) =>
    [root, ...Array.from(root.querySelectorAll("*"))].some(
      (n) => (n.textContent ?? "").includes("One") && Number(getComputedStyle(n).fontWeight) >= 600,
    ),
  );
}

async function expectSame(A: Page, B: Page, id: string, text: string) {
  for (const p of [A, B]) await expect(el(p, id)).toHaveText(text, { timeout: 10_000 });
}

test("two editors: concurrent text edits converge, format while typing, own undo, reload", async ({ browser, page }) => {
  test.setTimeout(120_000);
  const id = await createDeck(page.request, "e2e integration slides text collab");
  try {
    await saveDeckData(page.request, id, {
      slides: [{ id: "s1", background: "#ffffff", elements: [box("t1", 80, "One"), box("t2", 220, "Two"), box("t3", 360, "Three")] }],
    });
    const A = await openCtx(browser, id);
    const B = await openCtx(browser, id);

    // 1) Different boxes at the same time.
    await Promise.all([append(A, "t1", " from A"), append(B, "t2", " from B")]);
    await expectSame(A, B, "t1", "One from A");
    await expectSame(A, B, "t2", "Two from B");

    // 2) The same box, one after the other: the second edit builds on the first.
    await append(A, "t3", " +A");
    await expectSame(A, B, "t3", "Three +A");
    await append(B, "t3", " +B");
    await expectSame(A, B, "t3", "Three +A +B");

    // 3) B makes t1 bold (select the box, Ctrl+B) while A types into t2.
    await el(A, "t2").dblclick();
    await A.keyboard.press("ControlOrMeta+End");
    await A.waitForTimeout(100);
    await A.keyboard.type(" typing");
    await B.getByTestId("slide-canvas").click({ position: { x: 5, y: 5 } });
    await el(B, "t1").click();
    await B.keyboard.press("ControlOrMeta+b");
    await A.keyboard.type(" on");
    await A.keyboard.press("Escape");
    await expectSame(A, B, "t2", "Two from B typing on");
    await expect.poll(async () => (await saved(page, id)).t1?.bold, { timeout: 10_000 }).toBe(true);
    for (const p of [A, B]) await expect.poll(() => boldRendered(p, "t1")).toBe(true);

    // 4) A undoes its own last change (the typing in t2); B's bold and B's
    //    edit of t3 stay.
    await A.getByTestId("slide-canvas").click({ position: { x: 5, y: 5 } });
    await A.keyboard.press("ControlOrMeta+z");
    await expectSame(A, B, "t2", "Two from B");
    await expectSame(A, B, "t3", "Three +A +B");
    await expect.poll(async () => (await saved(page, id)).t1?.bold, { timeout: 10_000 }).toBe(true);

    // 5) Saved deck and a reload of both agree.
    await expect
      .poll(async () => {
        const s = await saved(page, id);
        return [s.t1?.text, s.t2?.text, s.t3?.text];
      }, { timeout: 15_000 })
      .toEqual(["One from A", "Two from B", "Three +A +B"]);
    await Promise.all([A.reload(), B.reload()]);
    for (const p of [A, B]) await expect(p.getByText("live", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expectSame(A, B, "t1", "One from A");
    await expectSame(A, B, "t2", "Two from B");
    await expectSame(A, B, "t3", "Three +A +B");

    await A.context().close();
    await B.context().close();
  } finally {
    await trashDeck(page.request, id);
  }
});
