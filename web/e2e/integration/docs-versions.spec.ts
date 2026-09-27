import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { BASE_URL, STORAGE_STATE, createDoc, trashDoc } from "../helpers";
import { openDoc } from "../docs/helpers";
import { editor, selectText } from "./docs-helpers";

// Docs version history across two open contexts: A edits, names a version
// (File ▸ Name current version), edits again, then restores the named
// version from File ▸ Version history. Docs restores into the live Yjs
// document (VersionHistory.tsx doRestore → editor.setContent), so context
// B sees the restored text without reloading, and again after a reload.

async function fileMenu(page: Page, item: string) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: new RegExp(`^${item}`) }).click();
}

/** The first heading's text from the editor model (remote-cursor labels
 *  are decorations inside the DOM text, not part of the document). */
async function h1(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector(".ProseMirror:not(.margin-editor .ProseMirror)") as HTMLElement & {
      editor?: { state: { doc: { firstChild: { textContent: string } | null } } };
    };
    return el.editor!.state.doc.firstChild?.textContent ?? "";
  });
}

async function versions(page: Page, id: string): Promise<{ label: string; is_auto: boolean }[]> {
  const r = await page.request.get(`${BASE_URL}/api/v1/docs/d/${id}/versions`);
  expect(r.ok()).toBeTruthy();
  return (await r.json()).versions ?? [];
}

test.describe.serial("docs integration: version history", () => {
  test("edit → name → edit → restore; the other context follows", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const id = await createDoc(page.request, "e2e docs versions");
    let ctxB: BrowserContext | null = null;
    const label = `Baseline ${Date.now().toString(36)}`;
    try {
      const a = page;
      await openDoc(a, id);
      await editor(a).click();
      await a.keyboard.press("Control+Alt+Digit1");
      await a.keyboard.type("Plan");
      await a.keyboard.press("Enter");
      await a.keyboard.type("Version one text.");
      await a.waitForTimeout(500);

      ctxB = await browser.newContext({ storageState: STORAGE_STATE });
      const b = await ctxB.newPage();
      await openDoc(b, id);
      await expect(editor(b)).toContainText("Version one text.");

      // Name the current version (a window.prompt).
      a.once("dialog", (d) => d.accept(label));
      await fileMenu(a, "Name current version");
      const panel = a.getByText("Version history", { exact: true }).locator("xpath=ancestor::div[contains(@class,'MuiSheet-root')][1]");
      await expect(panel.getByText(label, { exact: true })).toBeVisible();
      await a.getByRole("button", { name: "Close version history" }).click();
      expect((await versions(a, id)).map((v) => v.label)).toContain(label);

      // Edit again (B sees it live).
      await selectText(a, "Version one text.", "end");
      await a.keyboard.press("Enter");
      await a.keyboard.type("Second edit after the named version.");
      await selectText(a, "Plan", "end");
      await a.keyboard.type(" v2");
      await expect(editor(b)).toContainText("Second edit after the named version.");
      await expect.poll(() => h1(b)).toBe("Plan v2");

      // Restore the named version from the panel.
      await fileMenu(a, "Version history");
      await panel.getByText(label, { exact: true }).click();
      await expect(a.getByTestId("version-preview")).toContainText("Version one text.");
      await expect(a.getByTestId("version-preview")).not.toContainText("Second edit");
      await a.getByRole("button", { name: "Restore this version" }).click();

      // Both contexts show the restored content: B live …
      for (const p of [a, b]) {
        await expect(editor(p)).not.toContainText("Second edit", { timeout: 15_000 });
        await expect.poll(() => h1(p)).toBe("Plan");
        await expect(editor(p)).toContainText("Version one text.");
      }
      // … and after a reload of each.
      await a.waitForTimeout(1500);
      await Promise.all([openDoc(a, id), openDoc(b, id)]);
      for (const p of [a, b]) {
        await expect(editor(p)).not.toContainText("Second edit");
        await expect.poll(() => h1(p)).toBe("Plan");
        await expect(editor(p)).toContainText("Version one text.");
      }
      // History kept the named version (restoring adds, never removes).
      const after = await versions(a, id);
      expect(after.map((v) => v.label)).toContain(label);
      expect(after.length).toBeGreaterThanOrEqual(2);

      // The restored document is still editable from B and syncs to A.
      await selectText(b, "Version one text.", "end");
      await b.keyboard.type(" After restore.");
      await expect(editor(a)).toContainText("Version one text. After restore.");
    } finally {
      await ctxB?.close();
      await trashDoc(page.request, id);
    }
  });
});
