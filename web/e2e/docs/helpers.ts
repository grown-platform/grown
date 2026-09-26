import { expect, type Page } from "@playwright/test";
import { BASE_URL } from "../helpers";

// Shared helpers for Docs e2e specs (docs.spec.ts and the OnlyOffice ports in
// web/e2e/docs/oo-*.spec.ts). Doc creation/trash via the API lives in
// ../helpers.ts (createDoc / trashDoc).

/** runCommand runs a command from the editor's command palette (Alt+/),
 *  matching by label. */
export async function runCommand(page: Page, label: string) {
  await page.keyboard.press("Alt+Slash");
  const search = page.getByPlaceholder("Search the menus");
  await expect(search).toBeVisible();
  await search.fill(label);
  await page
    .locator(".MuiListItemButton-root", { hasText: label })
    .first()
    .click();
}

/** openDoc opens a doc in the editor and waits for the collab provider. */
export async function openDoc(page: Page, id: string) {
  await page.goto(`${BASE_URL}/docs/d/${id}`);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  // Give the collab provider a moment to connect before editing.
  await page.waitForTimeout(1500);
}

/** typeInto clicks into the document body and types text at the caret. */
export async function typeInto(page: Page, text: string) {
  await page.locator(".ProseMirror").first().click();
  await page.keyboard.type(text);
}
