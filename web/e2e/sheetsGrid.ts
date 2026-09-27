import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { getSheetData } from "./helpers";

// Grid helpers for the Sheets specs (M5/M12). FortuneSheet paints to a
// canvas, so the specs drive it with the keyboard from A1, read the name box
// (DOM) and read cell contents from the saved workbook (the editor autosaves
// 1.5 s after an edit).

export type Cell = Record<string, any>;
export const num = (v: number): Cell => ({ v, m: String(v), ct: { fa: "General", t: "n" } });
export const txt = (v: string): Cell => ({ v, m: v, ct: { fa: "General", t: "g" } });
export const fx = (f: string): Cell => ({ f });

/** A one-sheet workbook from {A1: cell} (plus optional extra sheets). */
export function book(cells: Record<string, Cell>, extra: any[] = [], sheet: Record<string, any> = {}): any[] {
  const celldata = Object.entries(cells).map(([ref, v]) => {
    const { r, c } = rc(ref);
    return { r, c, v };
  });
  return [{ name: "Sheet1", id: "s1", order: 0, row: 60, column: 20, celldata, ...sheet }, ...extra];
}

export function rc(ref: string): { r: number; c: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
  let c = 0;
  for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64;
  return { r: Number(m[2]) - 1, c: c - 1 };
}

export async function openSheet(page: Page, id: string) {
  await page.goto(`/sheets/d/${id}`);
  await expect(page.locator(".fortune-sheet-canvas")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("live", { exact: true })).toBeVisible({ timeout: 20_000 });
  // The grid re-seeds its selection shortly after opening (sheets.md §11.4).
  await page.waitForTimeout(1_500);
}

export async function menu(page: Page, top: string, item: string | RegExp) {
  await page.getByRole("button", { name: top, exact: true }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

const colName = (c: number) => {
  let s = "";
  let n = c + 1;
  while (n > 0) {
    const x = (n - 1) % 26;
    s = String.fromCharCode(65 + x) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

/**
 * Selects a cell with the keyboard from A1, then extends by (dr, dc). Waits
 * for the name box after every step, so a key press never races the grid's
 * selection update.
 */
export async function select(page: Page, ref: string, dr = 0, dc = 0) {
  const { r: row, c: col } = rc(ref);
  const box = page.locator(".fortune-name-box");
  await expect(async () => {
    await page.locator(".fortune-cell-area").click({ position: { x: 30, y: 10 } });
    await expect(box).toHaveText("A1", { timeout: 1_000 });
    for (let i = 0; i < col; i++) await page.keyboard.press("ArrowRight");
    for (let i = 0; i < row; i++) await page.keyboard.press("ArrowDown");
    await expect(box).toHaveText(ref, { timeout: 1_000 });
    for (let i = 0; i < dc; i++) await page.keyboard.press("Shift+ArrowRight");
    for (let i = 0; i < dr; i++) await page.keyboard.press("Shift+ArrowDown");
    if (dr || dc) await expect(box).toHaveText(`${ref}:${colName(col + dc)}${row + dr + 1}`, { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

/** Types into the active cell and commits with Enter. */
export async function enter(page: Page, text: string) {
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

export function cellOf(sheet: any, ref: string): Cell | undefined {
  const { r, c } = rc(ref);
  return sheet?.celldata?.find((x: any) => x.r === r && x.c === c)?.v;
}

/** Polls the saved workbook until `check` passes (autosave is debounced). */
export async function savedMatches(request: APIRequestContext, id: string, check: (wb: any[]) => void, timeout = 15_000) {
  await expect(async () => {
    const wb = await getSheetData(request, id);
    check(wb);
  }).toPass({ timeout });
}

/** The cell editor's text (FortuneSheet's contenteditable input). */
export async function editorText(page: Page): Promise<string> {
  return page.locator(".luckysheet-cell-input").evaluate((el) => (el as HTMLElement).innerText.replace(/\n$/, ""));
}

/** Whether FortuneSheet's cell editor is open. */
export async function isEditing(page: Page): Promise<boolean> {
  return page.locator(".luckysheet-input-box").evaluate((el) => (el as HTMLElement).style.zIndex === "19");
}

/**
 * Selects `ref` by clicking it (default column widths / row heights: 73 px +
 * 1 px gridline, 19 px + 1 px) and checks the name box; falls back to arrow
 * keys from A1 for cells outside the visible area.
 */
export async function goTo(page: Page, ref: string) {
  const box = page.locator(".fortune-name-box");
  const { r, c } = rc(ref);
  await expect(async () => {
    if (c < 15 && r < 20) {
      await page.locator(".fortune-cell-area").click({ position: { x: c * 74 + 30, y: r * 20 + 10 } });
    } else {
      await page.locator(".fortune-cell-area").click({ position: { x: 30, y: 10 } });
      await expect(box).toHaveText("A1", { timeout: 1_000 });
      for (let i = 0; i < c; i++) await page.keyboard.press("ArrowRight");
      for (let i = 0; i < r; i++) await page.keyboard.press("ArrowDown");
    }
    await expect(box).toHaveText(ref, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/** The display text of a cell as the grid shows it (FortuneSheet's screen-reader line). */
export async function shown(page: Page, ref: string): Promise<string> {
  await goTo(page, ref);
  const t = ((await page.locator("#sr-selection").textContent()) ?? "").replace(/\s+$/, "");
  return t.replace(/^[A-Z]+\. \d+ ?/, "");
}

/** Waits until the grid shows each cell's text (values follow the server engine after an edit). */
export async function expectGrid(page: Page, want: Record<string, string>, timeout = 15_000) {
  await expect(async () => {
    for (const [ref, text] of Object.entries(want)) expect(await shown(page, ref), ref).toBe(text);
  }).toPass({ timeout });
}

/** Types into a cell (moving there first) and commits with Enter. */
export async function typeAt(page: Page, ref: string, text: string) {
  await goTo(page, ref);
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

/** Clears a cell with Delete. */
export async function clearAt(page: Page, ref: string) {
  await goTo(page, ref);
  await page.keyboard.press("Delete");
}

const mac = process.platform === "darwin";
export const undo = (page: Page) => page.keyboard.press(mac ? "Meta+z" : "Control+z");
export const redo = (page: Page) => page.keyboard.press(mac ? "Meta+Shift+z" : "Control+y");
