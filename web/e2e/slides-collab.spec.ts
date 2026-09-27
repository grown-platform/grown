import { test, expect, type Browser, type Page } from "@playwright/test";
import { BASE_URL, STORAGE_STATE, createDeck, getDeckData, saveDeckData, trashDeck } from "./helpers";

// Slides M10: two browser contexts on one deck. Presence outlines, the same
// element moved from both at once (they converge, also after reload), a
// stale op rejected by the hub, undo that only undoes your own change, and
// a comment thread (marker, reply, resolve) that syncs and persists.

const SHOT = process.env.GROWN_SLIDES_M10_SHOT;

const rect = (id: string, x: number, y: number, fill: string) => ({
  id,
  type: "rect",
  x,
  y,
  w: 120,
  h: 80,
  fill,
  stroke: "none",
  strokeWidth: 0,
});

async function open(browser: Browser, id: string): Promise<Page> {
  const ctx = await browser.newContext({ storageState: STORAGE_STATE, viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}/slides/d/${id}`);
  await expect(page.getByTestId("slide-canvas").locator('[data-el-id="a"]')).toBeVisible();
  await expect(page.getByText("live", { exact: true })).toBeVisible();
  return page;
}

async function toScreen(page: Page, x: number, y: number) {
  const box = (await page.getByTestId("slide-canvas").boundingBox())!;
  const s = box.width / 960;
  return { x: box.x + x * s, y: box.y + y * s };
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await toScreen(page, ...from);
  const b = await toScreen(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

/** The element's logical x/y from its rendered box. */
async function logicalPos(page: Page, elId: string) {
  const canvas = (await page.getByTestId("slide-canvas").boundingBox())!;
  const el = (await page.getByTestId("slide-canvas").locator(`[data-el-id="${elId}"]`).first().boundingBox())!;
  const s = canvas.width / 960;
  return { x: Math.round((el.x - canvas.x) / s), y: Math.round((el.y - canvas.y) / s) };
}

async function savedEl(page: Page, id: string, elId: string) {
  const d = (await getDeckData(page.request, id)) as { slides: { elements: { id: string; x: number; y: number }[] }[] };
  return d.slides[0].elements.find((e) => e.id === elId);
}

test("two editors: presence, concurrent moves converge, own-op undo, comments", async ({ browser, page }) => {
  test.setTimeout(120_000);
  const id = await createDeck(page.request, "e2e slides collab");
  try {
    await saveDeckData(page.request, id, {
      slides: [{ id: "s1", background: "#ffffff", elements: [rect("a", 100, 100, "#4285f4"), rect("b", 500, 300, "#ea4335")] }],
    });
    const A = await open(browser, id);
    const B = await open(browser, id);

    // Presence: B sees A's selection outlined in A's colour with a name.
    await A.getByTestId("slide-canvas").locator('[data-el-id="a"]').click();
    await expect(B.locator('[data-testid="peer-selection"][data-el="a"]')).toBeVisible({ timeout: 10_000 });

    // Both move element a at the same time.
    await Promise.all([drag(A, [160, 140], [460, 140]), drag(B, [160, 140], [160, 400])]);
    await expect
      .poll(async () => JSON.stringify([await logicalPos(A, "a"), await logicalPos(B, "a")]), { timeout: 10_000 })
      .toMatch(/^\[(\{[^}]+\}),\1\]$/);
    let converged = await logicalPos(A, "a");
    expect(converged).not.toEqual({ x: 100, y: 100 });
    // Persisted, and still the same after a reload of both.
    await expect.poll(async () => savedEl(A, id, "a").then((e) => e && { x: e.x, y: e.y }), { timeout: 15_000 }).toEqual(converged);
    await Promise.all([A.reload(), B.reload()]);
    for (const p of [A, B]) {
      await expect(p.getByText("live", { exact: true })).toBeVisible();
      expect(await logicalPos(p, "a")).toEqual(converged);
    }

    // The hub rejects a stale op: an upsert of a based on seq 0, after A
    // moved it again in this session.
    await A.getByTestId("slide-canvas").locator('[data-el-id="a"]').click();
    await A.keyboard.press("ArrowDown");
    await expect.poll(() => logicalPos(B, "a").then((p) => p.y)).toBeGreaterThan(converged.y);
    converged = await logicalPos(A, "a");
    const verdict = await B.evaluate(async (deckId) => {
      const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/v1/slides/d/${deckId}/connect`);
      const got: { t: string; id?: string }[] = [];
      await new Promise<void>((res) => (ws.onopen = () => res()));
      ws.onmessage = (e) => got.push(JSON.parse(e.data));
      ws.send(JSON.stringify({ t: "hello", cid: "probe", since: 0, epoch: "" }));
      await new Promise((r) => setTimeout(r, 300));
      ws.send(JSON.stringify({ t: "upsert", id: "stale1", base: 0, si: "s1", el: { id: "a", type: "rect", x: 0, y: 0, w: 1, h: 1 } }));
      await new Promise((r) => setTimeout(r, 500));
      ws.close();
      return got.find((m) => m.id === "stale1")?.t;
    }, id);
    expect(verdict).toBe("reject");
    expect(await logicalPos(A, "a")).toEqual(converged);

    // Undo only undoes your own change: A moves a, B moves b, A undoes.
    const bBefore = await logicalPos(B, "b");
    await A.getByTestId("slide-canvas").locator('[data-el-id="a"]').click();
    await A.keyboard.press("ArrowRight");
    await A.keyboard.press("ArrowRight");
    await expect.poll(() => logicalPos(B, "a").then((p) => p.x)).toBeGreaterThan(converged.x);
    await drag(B, [bBefore.x + 60, bBefore.y + 40], [bBefore.x + 60, bBefore.y - 160]);
    const bMoved = await logicalPos(B, "b");
    await expect.poll(() => logicalPos(A, "b")).toEqual(bMoved);
    await A.getByTestId("slide-canvas").click({ position: { x: 5, y: 5 } });
    await A.keyboard.press("Control+z");
    for (const p of [A, B]) {
      await expect.poll(() => logicalPos(p, "a")).toEqual(converged);
      await expect.poll(() => logicalPos(p, "b")).toEqual(bMoved);
    }

    // Comments: A comments on a (Insert ▸ Comment), B sees the marker and the
    // thread, replies; A resolves; everything persists.
    await A.getByTestId("slide-canvas").locator('[data-el-id="a"]').click();
    await A.getByRole("button", { name: "Insert" }).click();
    await A.getByRole("menuitem", { name: /^Comment/ }).click();
    await A.getByTestId("comment-input").fill("Can we make this bigger?");
    await A.getByTestId("comment-submit").click();
    await expect(A.getByTestId("comment-marker")).toHaveCount(1);
    await expect(B.getByTestId("comment-marker")).toHaveCount(1, { timeout: 10_000 });
    await B.getByTestId("comment-marker").click();
    const thread = B.getByTestId("comment-thread");
    await expect(thread.getByTestId("comment-body")).toHaveText("Can we make this bigger?");
    await expect(thread).toContainText("Slide 1 · Rectangle");
    await B.getByTestId("comment-reply-input").fill("Yes, doubling it");
    await B.getByRole("button", { name: "Reply", exact: true }).click();
    await expect(A.getByTestId("comment-reply")).toHaveText(/Yes, doubling it/, { timeout: 10_000 });
    if (SHOT) {
      await A.getByTestId("comment-thread").click();
      await A.screenshot({ path: SHOT });
    }
    await A.getByRole("button", { name: "Resolve comment" }).click();
    await expect(B.getByTestId("comment-marker")).toHaveCount(0, { timeout: 10_000 });
    await expect
      .poll(async () => {
        const d = (await getDeckData(A.request, id)) as { comments?: { resolved?: boolean; replies: unknown[] }[] };
        return d.comments?.map((c) => [!!c.resolved, c.replies.length]);
      }, { timeout: 15_000 })
      .toEqual([[true, 1]]);
    await B.reload();
    await B.getByRole("button", { name: "View" }).click();
    await B.getByRole("menuitem", { name: "Comments", exact: true }).click();
    await B.getByRole("combobox", { name: "Show comments" }).click();
    await B.getByRole("option", { name: "Resolved" }).click();
    await expect(B.locator('[data-testid="comment-thread"][data-resolved="true"]')).toHaveCount(1);
    await expect(B.getByTestId("comment-reply")).toHaveCount(1);

    await A.context().close();
    await B.context().close();
  } finally {
    await trashDeck(page.request, id);
  }
});
