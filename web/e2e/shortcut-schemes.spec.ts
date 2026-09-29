import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { BASE_URL, createDoc, trashDoc, createSheet, trashSheet, saveSheet } from "./helpers";
import { openDoc, typeInto } from "./docs/helpers";
import { book, txt, openSheet, select, savedMatches, cellOf } from "./sheetsGrid";

// Keyboard shortcut styles: Office (Word / Excel, the default) and Google
// (Google Docs / Google Sheets), switched from the editors' Help ▸ Keyboard
// shortcuts dialog and from Settings, and saved in the user's preferences.
// Both styles change the signed-in user's preference, so the tests run one
// after another and put it back to "office" at the end. The browser reports a
// Windows platform (playwright.config.ts), so chords use Control, not ⌘.

test.describe.configure({ mode: "serial" });

const PREFS = `${BASE_URL}/api/v1/me/preferences`;

async function extra(request: APIRequestContext): Promise<Record<string, unknown>> {
  const r = await request.get(PREFS);
  expect(r.ok()).toBeTruthy();
  const body = (await r.json()) as { extra?: string };
  return JSON.parse(body.extra || "{}");
}

async function setSchemes(request: APIRequestContext, docs: string, sheets: string) {
  const x = await extra(request);
  x.docs_shortcut_scheme = docs;
  x.sheets_shortcut_scheme = sheets;
  const r = await request.patch(PREFS, { data: { extra: JSON.stringify(x), update_mask: ["extra"] } });
  expect(r.ok()).toBeTruthy();
}

/** Opens Help ▸ Keyboard shortcuts (Ctrl/⌘+/) and picks a style. */
async function switchScheme(page: Page, testid: string, scheme: "office" | "google") {
  await page.keyboard.press("Control+Slash");
  const list = page.getByTestId(testid);
  await expect(list).toBeVisible();
  await page.getByTestId("shortcut-scheme-switch").locator(`[data-scheme="${scheme}"]`).click();
  await expect(list).toHaveAttribute("data-scheme", scheme);
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
}

const alignOf = (page: Page) =>
  page.locator(".ProseMirror p").first().evaluate((el) => getComputedStyle(el).textAlign);

test.beforeAll(async ({ request }) => setSchemes(request, "office", "office"));
test.afterAll(async ({ request }) => setSchemes(request, "office", "office"));

test("Docs: Word style by default (Ctrl+E centres); Google style centres with Ctrl+Shift+E", async ({ page }) => {
  const id = await createDoc(page.request, "e2e shortcut schemes");
  try {
    await openDoc(page, id);
    await typeInto(page, "Centre me");

    // Office (default): Ctrl+E centres, pressing it again goes back to left.
    await page.keyboard.press("Control+e");
    await expect.poll(() => alignOf(page)).toBe("center");
    await page.keyboard.press("Control+e");
    await expect.poll(() => alignOf(page)).toMatch(/^(left|start)$/);

    await switchScheme(page, "docs-shortcuts", "google");
    await expect.poll(async () => (await extra(page.request)).docs_shortcut_scheme).toBe("google");
    await page.locator(".ProseMirror").first().click();

    // Google: Ctrl+Shift+E centres; Ctrl+E no longer does.
    await page.keyboard.press("Control+Shift+e");
    await expect.poll(() => alignOf(page)).toBe("center");
    await page.keyboard.press("Control+Shift+l");
    await expect.poll(() => alignOf(page)).toMatch(/^(left|start)$/);
    await page.keyboard.press("Control+e");
    await page.waitForTimeout(200);
    expect(await alignOf(page)).toMatch(/^(left|start)$/);

    // Google: Alt+Shift+5 strikes through the selection.
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Alt+Shift+Digit5");
    await expect(page.locator(".ProseMirror s").first()).toHaveText(/Centre me/);

    // The menu hint follows the style.
    await page.getByRole("button", { name: "Format", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: /Strikethrough/ })).toContainText("Alt+Shift+5");
    await page.keyboard.press("Escape");
  } finally {
    await trashDoc(page.request, id);
  }
});

test("Sheets: Excel style by default (Ctrl+5, Ctrl+Shift+= inserts a row, Ctrl+9 hides one)", async ({ page }) => {
  const id = await createSheet(page.request, "e2e shortcut schemes");
  try {
    await saveSheet(page.request, id, book({ A1: txt("strike"), A2: txt("pushed down"), A3: txt("hide me") }));
    await openSheet(page, id);
    await select(page, "A1");
    await page.keyboard.press("Control+Digit5");
    // Alt+Shift+5 also strikes through in the Excel style (a Grown extra):
    // pressing it again turns strikethrough off.
    await page.keyboard.press("Alt+Shift+Digit5");
    await page.keyboard.press("Control+Digit5");
    await select(page, "A3");
    await page.keyboard.press("Control+Digit9");
    await select(page, "A2");
    await page.keyboard.press("Control+Shift+Equal");
    await savedMatches(page.request, id, (wb) => {
      expect(cellOf(wb[0], "A1")?.cl).toBe(1);
      expect(cellOf(wb[0], "A2")?.v ?? null).toBeNull(); // the new row
      expect(cellOf(wb[0], "A3")?.v).toBe("pushed down");
      expect(wb[0].config?.rowhidden ?? {}).toHaveProperty("3"); // "hide me", moved down a row
    });
  } finally {
    await trashSheet(page.request, id);
  }
});

test("Sheets: Google style strikes through with Alt+Shift+5 and hides rows with Ctrl+Alt+9", async ({ page }) => {
  const id = await createSheet(page.request, "e2e shortcut schemes");
  try {
    await saveSheet(page.request, id, book({ A1: txt("strike"), A2: txt("plain"), A3: txt("hide me") }));
    await openSheet(page, id);

    await switchScheme(page, "sheet-shortcuts", "google");
    await expect.poll(async () => (await extra(page.request)).sheets_shortcut_scheme).toBe("google");

    await select(page, "A1");
    await page.keyboard.press("Alt+Shift+Digit5");
    // Ctrl+5 is Excel's; in the Google style it is left alone.
    await select(page, "A2");
    await page.keyboard.press("Control+Digit5");
    await select(page, "A3");
    await page.keyboard.press("Control+Alt+Digit9");
    await savedMatches(page.request, id, (wb) => {
      expect(cellOf(wb[0], "A1")?.cl).toBe(1);
      expect(cellOf(wb[0], "A2")?.cl ?? 0).toBe(0);
      expect(wb[0].config?.rowhidden ?? {}).toHaveProperty("2");
    });
  } finally {
    await trashSheet(page.request, id);
  }
});

test("Settings: the Keyboard shortcuts section saves both styles", async ({ page }) => {
  await setSchemes(page.request, "office", "office");
  await page.goto(`${BASE_URL}/settings`);
  const section = page.getByTestId("settings-shortcuts");
  await expect(section).toBeVisible();
  await section.getByRole("combobox", { name: "Sheets shortcuts" }).click();
  await page.getByRole("option", { name: /Google Sheets style/ }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  const x = await extra(page.request);
  expect(x.sheets_shortcut_scheme).toBe("google");
  expect(x.docs_shortcut_scheme).toBe("office");
});
