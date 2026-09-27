import { test, expect, type Page } from "@playwright/test";
import { createDoc, trashDoc } from "../helpers";
import { openDoc } from "./helpers";

// Playwright ports of OnlyOffice word/shortcuts/shortcuts.js cases that need
// a real browser: caret movement and deletion are native contenteditable
// behaviour (ProseMirror leaves them to the browser), and some shortcuts
// open app UI. The rest of the suite is in
// web/app/src/pages/docs/__tests__/oo/shortcuts.test.ts.
//
// Word-wise movement/deletion uses the platform's modifier: Ctrl on
// Windows/Linux, Option on macOS (where Chrome also stops at word ends
// rather than word starts when moving right).

const isMac = process.platform === "darwin";
// The "Desktop Chrome" device reports a Windows platform, so the app's
// keymap ("Mod") expects Ctrl even on a macOS host, while native caret
// movement and deletion still follow the host OS.
const MOD = "Control";
const WORD = isMac ? "Alt" : "Control";
const DOC_START = isMac ? "Meta+ArrowUp" : "Control+Home";
const DOC_END = isMac ? "Meta+ArrowDown" : "Control+End";
const LINE_START = isMac ? "Meta+ArrowLeft" : "Home";
const LINE_END = isMac ? "Meta+ArrowRight" : "End";

const editor = (page: Page) => page.locator(".ProseMirror").first();

/** Text of the first paragraph as the DOM has it. */
const firstParagraph = (page: Page) =>
  editor(page)
    .locator("p")
    .first()
    .evaluate((p) => p.textContent ?? "");

/** Caret offset within the first paragraph. */
async function caret(page: Page): Promise<number> {
  return page.evaluate(() => {
    const sel = window.getSelection()!;
    const p = document.querySelector(".ProseMirror p")!;
    const r = document.createRange();
    r.setStart(p, 0);
    r.setEnd(sel.focusNode!, sel.focusOffset);
    return r.toString().length;
  });
}

const selected = (page: Page) => page.evaluate(() => window.getSelection()!.toString());

async function withDoc(page: Page, title: string, body: (id: string) => Promise<void>) {
  const id = await createDoc(page.request, title);
  try {
    await openDoc(page, id);
    await editor(page).click();
    await body(id);
  } finally {
    await trashDoc(page.request, id);
  }
}

test.describe.serial("docs: OnlyOffice shortcut ports", () => {
  test("oo:word/shortcuts/shortcuts.js#Check remove symbols", async ({ page }) => {
    await withDoc(page, "e2e oo remove symbols", async () => {
      await page.keyboard.type("Hello Hello Hello Hello Hello Hello Hello");
      await page.keyboard.press("Backspace");
      expect(await firstParagraph(page)).toBe("Hello Hello Hello Hello Hello Hello Hell");
      await page.keyboard.press(`${WORD}+Backspace`);
      expect((await firstParagraph(page)).trimEnd()).toBe("Hello Hello Hello Hello Hello Hello");
      await page.keyboard.press(`${WORD}+Backspace`);
      expect((await firstParagraph(page)).trimEnd()).toBe("Hello Hello Hello Hello Hello");

      await page.keyboard.press(DOC_START);
      // The browser moves the caret for Ctrl+Home and reports it to the editor
      // asynchronously; a Delete in the same millisecond still sees the old
      // caret (same race as the Ctrl+K link fix). People don't type that fast.
      await page.waitForTimeout(100);
      await page.keyboard.press("Delete");
      expect((await firstParagraph(page)).trimEnd()).toBe("ello Hello Hello Hello Hello");
      await page.keyboard.press(`${WORD}+Delete`);
      expect((await firstParagraph(page)).trim()).toBe("Hello Hello Hello Hello");
      await page.keyboard.press(`${WORD}+Delete`);
      expect((await firstParagraph(page)).trim()).toBe("Hello Hello Hello");
    });
  });

  test("oo:word/shortcuts/shortcuts.js#Check move/select in no calculated text", async ({
    page,
  }) => {
    await withDoc(page, "e2e oo move", async () => {
      const text = "The quick brown fox jumps over the lazy dog";
      await page.keyboard.type(text);
      await page.keyboard.press(DOC_START);
      for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
      expect(await caret(page)).toBe(3);
      await page.keyboard.press(LINE_END);
      expect(await caret(page)).toBe(43);
      for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft");
      expect(await caret(page)).toBe(38);
      await page.keyboard.press(LINE_START);
      expect(await caret(page)).toBe(0);
      await page.keyboard.press(DOC_END);
      expect(await caret(page)).toBe(43);
      await page.keyboard.press(DOC_START);
      expect(await caret(page)).toBe(0);
      for (let i = 0; i < 3; i++) await page.keyboard.press(`${WORD}+ArrowRight`);
      // Windows/Linux stop at word starts (16), macOS at word ends (15).
      expect(await caret(page)).toBe(isMac ? 15 : 16);
      await page.keyboard.press(`${WORD}+ArrowLeft`);
      expect(await caret(page)).toBe(10);
    });
  });

  test("oo:word/shortcuts/shortcuts.js#Check move/select in text", async ({ page }) => {
    // Selection by line needs real line wrapping, so this runs in the
    // browser. OnlyOffice's page-wise cases (PageUp/PageDown) are left out:
    // Grown's pages are one scrolling surface.
    await withDoc(page, "e2e oo select", async () => {
      const text = Array.from({ length: 30 }, (_, i) => (i % 2 ? "World" : "Hello")).join(" ");
      await page.keyboard.type(text);
      await page.keyboard.press(DOC_START);

      await page.keyboard.press(`Shift+${LINE_END}`);
      const line1 = await selected(page);
      expect(line1.length).toBeGreaterThan(0);
      expect(line1.length).toBeLessThan(text.length);
      expect(text.startsWith(line1.trimEnd())).toBe(true);

      await page.keyboard.press("Shift+ArrowDown");
      expect((await selected(page)).length).toBeGreaterThan(line1.length);
      await page.keyboard.press("Shift+ArrowUp");
      expect((await selected(page)).trimEnd()).toBe(line1.trimEnd());

      await page.keyboard.press(`Shift+${DOC_END}`);
      expect((await selected(page)).trim()).toBe(text);
      await page.keyboard.press(`Shift+${DOC_START}`);
      // Anchor-based on Windows/Linux (collapses back to the start); macOS
      // extends the existing selection instead.
      expect(await selected(page)).toBe(isMac ? text : "");

      await page.keyboard.press(DOC_END);
      await page.keyboard.press("Shift+ArrowLeft");
      expect(await selected(page)).toBe("d");
      await page.keyboard.press(`Shift+${WORD}+ArrowLeft`);
      expect(await selected(page)).toBe("World");
    });
  });

  test("oo:word/shortcuts/shortcuts.js#Check sending event to interface", async ({
    page,
  }) => {
    // OnlyOffice checks that shortcuts reach the UI: insert hyperlink opens
    // its dialog, Escape closes popups. Grown: Ctrl+K asks for the link URL,
    // Ctrl+/ opens the shortcuts overlay and Escape closes it.
    await withDoc(page, "e2e oo ui events", async () => {
      await page.keyboard.type("Grown");
      await page.keyboard.press(`Shift+${LINE_START}`);
      // window.prompt blocks the key press until answered, so answer it
      // from the dialog handler.
      let message = "";
      page.once("dialog", (d) => {
        message = d.message();
        void d.accept("https://example.com");
      });
      await page.keyboard.press(`${MOD}+k`);
      expect(message).toContain("Link");
      await expect(editor(page).locator('a[href="https://example.com"]')).toHaveText("Grown");

      await page.keyboard.press(`${MOD}+Slash`);
      const overlay = page.getByRole("dialog").filter({ hasText: "Keyboard shortcuts" });
      await expect(overlay).toBeVisible();
      await expect(overlay).toContainText("Ctrl+Enter");
      await page.keyboard.press("Escape");
      await expect(overlay).toBeHidden();
    });
  });

  test("new editing shortcuts: page break, font size, reset, symbols", async ({
    page,
  }, testInfo) => {
    await withDoc(page, "e2e shortcuts", async () => {
      await page.keyboard.type("Before the break");
      await page.keyboard.press(`${MOD}+Enter`);
      await expect(editor(page).locator(".page-break")).toHaveCount(1);
      await page.keyboard.type("After the break ");

      // Ctrl+Shift+. twice: 11pt -> 12pt -> 14pt for what's typed next.
      await page.keyboard.press(`${MOD}+Shift+Period`);
      await page.keyboard.press(`${MOD}+Shift+Period`);
      await page.keyboard.type("bigger");
      await expect(editor(page).locator('span[style*="font-size: 14pt"]')).toHaveText("bigger");

      await page.keyboard.press("Enter");
      await page.keyboard.press(`${MOD}+Space`); // reset character formatting
      await page.keyboard.type("Grown");
      await page.keyboard.press(`${MOD}+Alt+KeyT`);
      await page.keyboard.type(" ");
      await page.keyboard.press(`${MOD}+Alt+KeyG`);
      await page.keyboard.type(" 2026 ");
      await page.keyboard.press(`${MOD}+Alt+Period`);
      const last = editor(page).locator("p").last();
      await expect(last).toHaveText("Grown™ © 2026 …");

      await page.screenshot({ path: testInfo.outputPath("docs-shortcuts.png"), fullPage: false });
    });
  });
});
