import { test, expect } from "@playwright/test";
import { BASE_URL, createDoc, trashDoc } from "./helpers";

// Regression: the Docs Presence chip (data-testid="collab-status") sometimes
// stayed "connecting" for the life of the page after a reload of a production
// build (about 1 load in 25 with an edit before each reload). The socket was
// open and the replay had arrived; the chip had missed y-websocket's one-off
// "connected" status event, which fired between Presence's first render and
// its effect subscribing. Edit, reload, and require "connected" quickly every
// time. On failure the WebSocket event log is printed.

const RELOADS = Number(process.env.COLLAB_RELOADS ?? 10);

test("docs: collab status reaches connected on every reload", async ({ page }) => {
  test.setTimeout(30_000 + RELOADS * 10_000);
  const id = await createDoc(page.request, "e2e collab reconnect");
  const log: string[] = [];
  const t0 = Date.now();
  const note = (s: string) => log.push(`${Date.now() - t0}ms ${s}`);
  const size = (p: string | Buffer) => (typeof p === "string" ? p.length : p.byteLength);
  page.on("websocket", (ws) => {
    if (!ws.url().includes("/connect")) return;
    note(`ws new ${ws.url()}`);
    ws.on("framereceived", (f) => note(`ws recv ${size(f.payload)}B`));
    ws.on("framesent", (f) => note(`ws sent ${size(f.payload)}B`));
    ws.on("socketerror", (e) => note(`ws error ${e}`));
    ws.on("close", () => note("ws close"));
  });
  const stuck: number[] = [];
  try {
    await page.goto(`${BASE_URL}/docs/d/${id}`);
    for (let i = 0; i <= RELOADS; i++) {
      if (i > 0) {
        await page.locator(".ProseMirror").first().click();
        await page.keyboard.type(`line ${i}`);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(1000);
        await page.reload();
      }
      note(`--- load ${i}`);
      await expect(page.locator(".ProseMirror")).toBeVisible();
      try {
        await expect(page.getByTestId("collab-status")).toHaveText("connected", {
          timeout: 5_000,
        });
      } catch {
        stuck.push(i);
        note(`load ${i}: chip at "${await page.getByTestId("collab-status").textContent()}"`);
      }
    }
    // Every edit came back through the hub's replay.
    await expect(page.locator(".ProseMirror").first()).toContainText(new RegExp(`line ${RELOADS}$`, "i"));
  } finally {
    await trashDoc(page.request, id);
  }
  if (stuck.length) console.log(log.join("\n"));
  expect(stuck, `loads whose chip never reached "connected": ${stuck.join(", ")}`).toEqual([]);
});
