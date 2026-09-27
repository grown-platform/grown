import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { STORAGE_STATE, createDoc, trashDoc } from "../helpers";
import { openDoc } from "../docs/helpers";
import { editor, selectText } from "./docs-helpers";

// Two browser contexts (the same signed-in user, two independent sessions
// and Yjs clients) edit one document at the same time over the collab
// WebSocket: different paragraphs, the same paragraph, formatting while
// the other types, and an undo in one context. Both must converge, and
// still match after a reload.

/** The body as TipTap JSON (TipTap puts the editor on its root element);
 *  remote-cursor widgets are decorations, so they are not in it. */
async function model(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const el = document.querySelector(".ProseMirror:not(.margin-editor .ProseMirror)") as HTMLElement & {
      editor?: { getJSON(): unknown };
    };
    return el.editor!.getJSON();
  });
}

/** Paragraph texts from the model. */
async function paras(page: Page): Promise<string[]> {
  const json = (await model(page)) as { content?: { content?: { text?: string }[] }[] };
  return (json.content ?? []).map((b) => (b.content ?? []).map((c) => c.text ?? "").join(""));
}

async function converge(a: Page, b: Page) {
  await expect.poll(async () => JSON.stringify(await model(a)) === JSON.stringify(await model(b)), {
    timeout: 15_000,
    message: "both contexts converge",
  }).toBe(true);
}

test.describe.serial("docs integration: two-context collaboration", () => {
  test("concurrent edits, formatting, undo converge and survive reload", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const id = await createDoc(page.request, "e2e collab two contexts");
    let ctxB: BrowserContext | null = null;
    try {
      const a = page;
      await openDoc(a, id);
      await editor(a).click();
      await a.keyboard.type("First paragraph.");
      await a.keyboard.press("Enter");
      await a.keyboard.type("Second paragraph.");
      await a.waitForTimeout(500);

      ctxB = await browser.newContext({ storageState: STORAGE_STATE });
      const b = await ctxB.newPage();
      await openDoc(b, id);
      await expect(editor(b)).toContainText("Second paragraph.");

      // 1) Different paragraphs at the same time.
      await selectText(a, "First paragraph.", "end");
      await selectText(b, "Second paragraph.", "end");
      await Promise.all([a.keyboard.type(" Alice was here.", { delay: 20 }), b.keyboard.type(" Bob was here.", { delay: 20 })]);
      await converge(a, b);
      expect(await paras(a)).toEqual(["First paragraph. Alice was here.", "Second paragraph. Bob was here."]);

      // 2) The same paragraph: A appends, B inserts at its start.
      await selectText(a, "Alice was here.", "end");
      await selectText(b, "First paragraph.", "start");
      await Promise.all([a.keyboard.type(" [A2]", { delay: 20 }), b.keyboard.type("[B2] ", { delay: 20 })]);
      await converge(a, b);
      expect((await paras(b))[0]).toBe("[B2] First paragraph. Alice was here. [A2]");

      // 3) A bolds a word while B types in the same paragraph.
      await selectText(a, "Second");
      await selectText(b, "Bob was here.", "end");
      await Promise.all([
        a.keyboard.press("Control+b"),
        b.keyboard.type(" Typing on.", { delay: 20 }),
      ]);
      await converge(a, b);
      await expect(editor(b).locator("strong")).toHaveText("Second");
      expect((await paras(a))[1]).toBe("Second paragraph. Bob was here. Typing on.");

      // 4) Undo in one context removes only that context's own edit.
      await selectText(a, "[A2]", "end");
      await a.keyboard.type(" undo-me", { delay: 20 });
      await selectText(b, "Typing on.", "end");
      await b.keyboard.type(" Kept.", { delay: 20 });
      await converge(a, b);
      await editor(a).focus();
      await a.keyboard.press("Control+z");
      await converge(a, b);
      const after = await paras(b);
      expect(after[0]).not.toContain("undo-me");
      expect(after[1]).toBe("Second paragraph. Bob was here. Typing on. Kept.");
      await expect(editor(b).locator("strong")).toHaveText("Second"); // B's view kept A's bold

      // 5) Both reload and still match.
      await a.waitForTimeout(1500);
      const before = JSON.stringify(await model(a));
      await Promise.all([openDoc(a, id), openDoc(b, id)]);
      await expect.poll(async () => JSON.stringify(await model(a)), { timeout: 15_000 }).toBe(before);
      await expect.poll(async () => JSON.stringify(await model(b)), { timeout: 15_000 }).toBe(before);
    } finally {
      await ctxB?.close();
      await trashDoc(page.request, id);
    }
  });
});
