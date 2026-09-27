import { test, expect, type Browser, type Page } from "@playwright/test";
import { STORAGE_STATE, createSheet, getSheetData, saveSheet, trashSheet } from "../helpers";
import { book, num, txt, openSheet, goTo, shown, typeAt, undo } from "../sheetsGrid";
import { cellAt } from "./sheets-helpers";

// Two editors on one spreadsheet (two browser contexts, same user). Edits
// are relayed as FortuneSheet ops over the collab socket and each editor
// autosaves the whole workbook, so both grids and the saved copy must agree:
// different cells at once, the same cell at once, formatting in one while
// the other types, undo in one, and the same content after a reload.

const MOD = process.platform === "darwin" ? "Meta" : "Control";

async function editor(browser: Browser, id: string): Promise<Page> {
  const ctx = await browser.newContext({ storageState: STORAGE_STATE, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await openSheet(page, id);
  return page;
}

async function expectBoth(a: Page, b: Page, want: Record<string, string>) {
  for (const p of [a, b]) {
    await expect(async () => {
      for (const [ref, text] of Object.entries(want)) expect(await shown(p, ref), ref).toBe(text);
    }).toPass({ timeout: 20_000 });
  }
}

test("sheets: two editors converge on concurrent edits, formatting, undo and reload", async ({ browser, page }) => {
  test.setTimeout(240_000);
  const id = await createSheet(page.request, "e2e sheets collab");
  const pages: Page[] = [];
  try {
    await saveSheet(page.request, id, book({ A1: txt("head"), B1: num(1) }));
    const a = await editor(browser, id);
    const b = await editor(browser, id);
    pages.push(a, b);

    // 1. Different cells at the same time.
    await Promise.all([typeAt(a, "A3", "from A"), typeAt(b, "C4", "from B")]);
    await expectBoth(a, b, { A3: "from A", C4: "from B", A1: "head" });

    // 2. A bolds a cell B typed, while B keeps typing elsewhere.
    await typeAt(b, "E6", "typed");
    await expectBoth(a, b, { E6: "typed" });
    await Promise.all([
      (async () => {
        await goTo(a, "E6");
        await a.keyboard.press(`${MOD}+b`);
      })(),
      typeAt(b, "F7", "meanwhile"),
    ]);
    await expectBoth(a, b, { E6: "typed", F7: "meanwhile" });

    // 3. Undo in A removes only A's last edit.
    await typeAt(a, "B9", "oops");
    await expectBoth(a, b, { B9: "oops" });
    await goTo(a, "A1");
    await undo(a);
    await expectBoth(a, b, { B9: "", F7: "meanwhile", A3: "from A", C4: "from B" });

    // The saved copy has all of it (autosave is debounced; both editors save).
    const want = (wb: any[]) => {
      const s = wb[0];
      expect(cellAt(s, "A3")?.v).toBe("from A");
      expect(cellAt(s, "C4")?.v).toBe("from B");
      expect(cellAt(s, "E6")).toMatchObject({ v: "typed", bl: 1 });
      expect(cellAt(s, "F7")?.v).toBe("meanwhile");
      expect(cellAt(s, "B9")?.v ?? "").toBe("");
      expect(cellAt(s, "B1")?.v).toBe(1);
    };
    await expect(async () => want(await getSheetData(page.request, id))).toPass({ timeout: 20_000 });

    // After a reload of both, the grids still match the saved copy.
    await Promise.all([openSheet(a, id), openSheet(b, id)]);
    await expectBoth(a, b, { A3: "from A", C4: "from B", E6: "typed", F7: "meanwhile", B9: "" });
    want(await getSheetData(page.request, id));

    // 4. The same cell from both at the same time, a few times over. The hub
    // relays ops without conflict resolution and each editor saves the whole
    // workbook, last writer wins (sheets.md §1.1 "Collaboration" and §2.10
    // "op relay, no conflict resolution, last-writer-wins persistence"), so
    // the two grids may disagree until a reload. Neither typed value may be
    // lost, though: each grid shows one of them, never an empty cell.
    const cells = ["D11", "E12", "F13", "G14"];
    for (const ref of cells) {
      await Promise.all([typeAt(a, ref, "left"), typeAt(b, ref, "right")]);
    }
    for (const p of [a, b]) {
      await expect(async () => {
        for (const ref of cells) expect(["left", "right"], `${ref} on ${p === a ? "A" : "B"}`).toContain(await shown(p, ref));
      }).toPass({ timeout: 20_000 });
    }
    // Let both debounced autosaves land, then reload: both show the saved copy.
    await a.waitForTimeout(3_000);
    await Promise.all([openSheet(a, id), openSheet(b, id)]);
    const saved = (await getSheetData(page.request, id))[0];
    const final: Record<string, string> = {};
    for (const ref of cells) {
      final[ref] = String(cellAt(saved, ref)?.v ?? "");
      expect(["left", "right"], ref).toContain(final[ref]);
    }
    await expectBoth(a, b, final);
  } finally {
    for (const p of pages) await p.context().close();
    await trashSheet(page.request, id);
  }
});
