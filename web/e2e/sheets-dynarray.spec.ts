import { test, expect, type Page } from "@playwright/test";
import { createSheet, trashSheet, saveSheet, getSheetData } from "./helpers";
import { book, num, txt, openSheet, goTo, expectGrid, typeAt, clearAt, undo, redo, select, cellOf } from "./sheetsGrid";

// Sheets M5: dynamic arrays in the editor. The cases OnlyOffice's
// DynamicArraysTests runs through its edit, undo/redo, paste and autofill
// paths (the engine semantics are ported in Go: dynarray_parity_test.go).
// Formulas are typed into the grid; the spilled values come from the server
// engine (the editor applies them after the autosave, without an undo step),
// so every check waits for the grid to show the expected text.
//
// OnlyOffice also asserts its xlsx rich-value metadata (vm/cm indexes) for
// each state; Grown keeps no such metadata in the workbook, so those asserts
// are replaced by the states they describe (expanded, #SPILL!, deleted).

test.describe.configure({ timeout: 180_000 });

async function withSheet(page: Page, cells: Record<string, any>, fn: (id: string) => Promise<void>, extra: any[] = []) {
  const id = await createSheet(page.request, "e2e dynamic arrays");
  try {
    await saveSheet(page.request, id, book(cells, extra, { column: 30 }));
    await openSheet(page, id);
    await fn(id);
  } finally {
    await trashSheet(page.request, id);
  }
}

// The before/after/undo/redo walk of the suite's checkUndoRedo.
async function undoRedo(page: Page, before: () => Promise<void>, after: () => Promise<void>, lastUndo = false) {
  await after();
  await undo(page);
  await before();
  await redo(page);
  await after();
  if (lastUndo) {
    await undo(page);
    await before();
  }
}

const SPILL = "#SPILL!";

test("oo:cell/spreadsheet-calculation/DynamicArraysTests.js#Dynamic array metadata and deletion with undo/redo", async ({ page }) => {
  const cells = {
    A1: num(1), A2: num(2), A3: num(3), C2: txt("Block1"),
    E1: num(5), E2: num(10), G2: txt("Block2"),
    I1: num(100), I2: num(200), I3: num(300), I4: num(400), K2: txt("Block3"),
  };
  await withSheet(page, cells, async () => {
    await typeAt(page, "C1", "=A1:A3*10");
    await typeAt(page, "G1", "=SIN(E1:E2)");
    await typeAt(page, "K1", "=SQRT(I1:I4)");
    const three = () => expectGrid(page, { C1: SPILL, G1: SPILL, K1: SPILL });
    const two = () => expectGrid(page, { C1: "", G1: SPILL, K1: SPILL });
    const one = () => expectGrid(page, { C1: "", G1: "", K1: SPILL });
    const none = () => expectGrid(page, { C1: "", G1: "", K1: "" });
    await three();
    await clearAt(page, "C1");
    await undoRedo(page, three, two);
    await clearAt(page, "G1");
    await undoRedo(page, two, one);
    await clearAt(page, "K1");
    await undoRedo(page, one, none);
  });
});

test("oo:cell/spreadsheet-calculation/DynamicArraysTests.js#Complex dynamic array metadata with expanded and blocked arrays - delete with undo/redo", async ({ page }) => {
  const cells = {
    A1: num(10), A2: num(20), E1: num(5), E2: num(10), G2: txt("Block"),
    A5: num(1), A6: num(2), B5: num(3), B6: num(4),
    A10: num(100), A11: num(200), C11: txt("Y"),
  };
  await withSheet(page, cells, async () => {
    await typeAt(page, "C1", "=A1:A2*2");
    await typeAt(page, "G1", "=SQRT(E1:E2)");
    await typeAt(page, "D5", "=A5:B6*10");
    await typeAt(page, "C10", "=A10:A11/10");
    const all = () => expectGrid(page, { C1: "20", C2: "40", G1: SPILL, D5: "10", E5: "30", D6: "20", E6: "40", C10: SPILL, C11: "Y" });
    const first = () => expectGrid(page, { C1: "", C2: "", G1: SPILL, D5: "10", E6: "40", C10: SPILL });
    const second = () => expectGrid(page, { C1: "", G1: "", D5: "10", E6: "40", C10: SPILL });
    const third = () => expectGrid(page, { C1: "", G1: "", D5: "", E6: "", C10: SPILL });
    const none = () => expectGrid(page, { C1: "", G1: "", D5: "", C10: "", C11: "Y" });
    await all();
    await clearAt(page, "C1");
    await undoRedo(page, all, first);
    await clearAt(page, "G1");
    await undoRedo(page, first, second);
    await clearAt(page, "D5");
    await undoRedo(page, second, third);
    await clearAt(page, "C10");
    await undoRedo(page, third, none);
  });
});

test("oo:cell/spreadsheet-calculation/DynamicArraysTests.js#Metadata add test", async ({ page }) => {
  await withSheet(page, {}, async () => {
    await typeAt(page, "A1", "=SEQUENCE(3,2)");
    await typeAt(page, "D1", "=SEQUENCE(2,3)");
    await expectGrid(page, { A1: "1", B3: "6", D1: "1", F2: "6" });
    await clearAt(page, "A1");
    await expectGrid(page, { A1: "", B3: "", D1: "1", F2: "6" });
    await clearAt(page, "D1");
    await expectGrid(page, { D1: "", F2: "" });
  });
});

test("oo:cell/spreadsheet-calculation/DynamicArraysTests.js#Richdata add test", async ({ page }) => {
  await withSheet(page, {}, async () => {
    await typeAt(page, "A1", "=SEQUENCE(3,2)");
    await expectGrid(page, { A1: "1", A2: "3", B3: "6" });
    // A value typed into the spill range blocks the array.
    await typeAt(page, "A2", "test");
    await expectGrid(page, { A1: SPILL, A2: "test", B1: "", B3: "" });
    // Clearing it lets the array spill again.
    await clearAt(page, "A2");
    await expectGrid(page, { A1: "1", A2: "3", B3: "6" });
  });
});

test("oo:cell/spreadsheet-calculation/DynamicArraysTests.js#Multiple richdata formulas collapse and delete", async ({ page }) => {
  await withSheet(page, {}, async () => {
    await typeAt(page, "A1", "=SEQUENCE(3,2)");
    await typeAt(page, "D1", "=SEQUENCE(2,3)");
    await typeAt(page, "G1", "=SEQUENCE(4,1)");
    await typeAt(page, "A2", "test1");
    await typeAt(page, "D2", "test2");
    await typeAt(page, "G2", "test3");
    await expectGrid(page, { A1: SPILL, D1: SPILL, G1: SPILL });
    await clearAt(page, "A1");
    await expectGrid(page, { A1: "", D1: SPILL, G1: SPILL });
    await clearAt(page, "D1");
    await expectGrid(page, { D1: "", G1: SPILL });
    await clearAt(page, "G1");
    await expectGrid(page, { G1: "", A2: "test1", D2: "test2", G2: "test3" });
  });
});

test("oo:cell/spreadsheet-calculation/DynamicArraysTests.js#Delete head cell of expanded and collapsed array", async ({ page }) => {
  await withSheet(page, {}, async () => {
    await typeAt(page, "A1", "=SEQUENCE(3,2)");
    await expectGrid(page, { A1: "1", A2: "3", A3: "5", B1: "2", B2: "4", B3: "6" });
    await clearAt(page, "A1");
    await expectGrid(page, { A1: "", A2: "", A3: "", B1: "", B2: "", B3: "" });
    await typeAt(page, "D1", "=SEQUENCE(3,2)");
    await typeAt(page, "D2", "block");
    await expectGrid(page, { D1: SPILL, D2: "block" });
    await clearAt(page, "D1");
    await expectGrid(page, { D1: "", D2: "block" });
  });
});

test("oo:cell/spreadsheet-calculation/DynamicArraysTests.js#Replace dynamic array with different sizes", async ({ page, request }) => {
  await withSheet(page, {}, async (id) => {
    await typeAt(page, "A1", "=SEQUENCE(3,2)");
    await expectGrid(page, { A1: "1", A3: "5", B3: "6" });
    await typeAt(page, "A1", "=SEQUENCE(4,3)");
    await expectGrid(page, { A1: "1", A4: "10", C4: "12" });
    await typeAt(page, "A1", "=SEQUENCE(2,1)");
    // The old spill cells are cleared.
    await expectGrid(page, { A1: "1", A2: "2", A3: "", A4: "", B1: "", C1: "" });
    await typeAt(page, "A1", "=SEQUENCE(2,1,10,5)");
    await expectGrid(page, { A1: "10", A2: "15", A3: "" });
    // The spill range the engine reports for the anchor is A1:A2.
    const wb = await getSheetData(request, id);
    const res = await request.post(`/api/v1/sheets/d/${id}/recalc`, { data: { data: JSON.stringify(wb) } });
    const anchor = (await res.json()).cells.find((c: any) => c.r === 0 && c.c === 0);
    expect([anchor.spillRows, anchor.spillCols]).toEqual([2, 1]);
  });
});

test("oo:cell/spreadsheet-calculation/DynamicArraysTests.js#Add dynamic array in previous cell when next cell has array", async ({ page }) => {
  await withSheet(page, {}, async () => {
    await typeAt(page, "A2", "=SEQUENCE(3,2)");
    await expectGrid(page, { A2: "1", A3: "3", A4: "5", B2: "2" });
    // A1's array would cover A2's formula: A1 is blocked, A2 keeps spilling.
    await typeAt(page, "A1", "=SEQUENCE(3,2)");
    await expectGrid(page, { A1: SPILL, A2: "1", A3: "3" });
    await clearAt(page, "A2");
    await expectGrid(page, { A1: "1", A2: "3", A3: "5", B1: "2", B3: "6", A4: "", B4: "" });
  });
});

test("oo:cell/spreadsheet-calculation/DynamicArraysTests.js#Insert dynamic array into existing spill range", async ({ page }) => {
  await withSheet(page, {}, async () => {
    await typeAt(page, "A1", "=SEQUENCE(3,2)");
    await expectGrid(page, { A1: "1", B3: "6" });
    await typeAt(page, "B2", "=SEQUENCE(2,2)");
    await expectGrid(page, { A1: SPILL, B2: "1", C2: "2", B3: "3", C3: "4", A2: "", A3: "" });
  });
});

test("oo:cell/spreadsheet-calculation/DynamicArraysTests.js#Paste with clipboard collision - dynamic array collapse/delete", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const paste = async (from: string, to: string, dr = 0, dc = 0) => {
    await select(page, from, dr, dc);
    await page.keyboard.press("ControlOrMeta+c");
    await goTo(page, to);
    await page.keyboard.press("ControlOrMeta+v");
  };
  // The copied values sit in view (the suite copies from Z1:AA2).
  await withSheet(page, { J12: num(100), J14: num(200), J15: num(201), K14: num(202), K15: num(203) }, async () => {
    // A value pasted into the spill range blocks the array.
    await typeAt(page, "A1", "=SEQUENCE(3,3)");
    await expectGrid(page, { A1: "1", C3: "9" });
    await paste("J12", "B2");
    await expectGrid(page, { B2: "100", A1: SPILL });
    await clearAt(page, "B2");
    await expectGrid(page, { A1: "1", B2: "5" });
    // A value pasted over the anchor deletes the array.
    await paste("J12", "A1");
    await expectGrid(page, { A1: "100", B2: "", C3: "" });
    // A block pasted into the middle of a larger array.
    await typeAt(page, "D5", "=SEQUENCE(4,4)");
    await expectGrid(page, { D5: "1", G8: "16" });
    await paste("J14", "E6", 1, 1);
    await expectGrid(page, { E6: "200", F7: "203", D5: SPILL });
  });
});

test("oo:cell/spreadsheet-calculation/DynamicArraysTests.js#Copy-paste dynamic array - expand vs blocked", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await withSheet(page, { H1: txt("X") }, async () => {
    await typeAt(page, "A1", "=SEQUENCE(2,2)");
    await expectGrid(page, { A1: "1", B2: "4" });
    await goTo(page, "A1");
    await page.keyboard.press("ControlOrMeta+c");
    // Into free space: the pasted formula spills.
    await goTo(page, "E1");
    await page.keyboard.press("ControlOrMeta+v");
    await expectGrid(page, { E1: "1", F1: "2", E2: "3", F2: "4" });
    // Next to a blocker: #SPILL!.
    await goTo(page, "G1");
    await page.keyboard.press("ControlOrMeta+v");
    await expectGrid(page, { G1: SPILL, H1: "X" });
  });
});

test("oo:cell/spreadsheet-calculation/DynamicArraysTests.js#Dynamic array add/delete with undo/redo", async ({ page }) => {
  await withSheet(page, {}, async () => {
    const empty = () => expectGrid(page, { A1: "", A2: "", B2: "" });
    const arr = () => expectGrid(page, { A1: "1", A2: "3", B1: "2", B2: "4" });
    await empty();
    await typeAt(page, "A1", "=SEQUENCE(2,2)");
    await arr();
    // Delete (clear content), undo and redo, three times like the suite's
    // text / all / formula clean options (Grown has one "clear content").
    for (let i = 0; i < 3; i++) {
      await clearAt(page, "A1");
      await undoRedo(page, arr, empty, true);
    }
    // Clearing formats leaves the array in place.
    await goTo(page, "A1");
    await page.keyboard.press("ControlOrMeta+Backslash");
    await arr();
  });
});

test("oo:cell/spreadsheet-calculation/DynamicArraysTests.js#Autofill with collision - dynamic array collapse/delete", async ({ page }) => {
  await withSheet(page, {}, async () => {
    // Filling a value down into the spill range blocks the array.
    await typeAt(page, "A2", "=SEQUENCE(1,3)");
    const expanded = () => expectGrid(page, { A2: "1", B2: "2", C2: "3" });
    await expanded();
    await typeAt(page, "B1", "100");
    await select(page, "B1", 1, 0);
    await page.keyboard.press("ControlOrMeta+d");
    const collapsed = () => expectGrid(page, { B2: "100", A2: SPILL });
    await undoRedo(page, expanded, collapsed, true);
  });
  await withSheet(page, {}, async () => {
    // Filling over the anchor deletes the array.
    await typeAt(page, "A2", "=SEQUENCE(1,3)");
    const expanded = () => expectGrid(page, { A2: "1", B2: "2", C2: "3" });
    await expanded();
    await typeAt(page, "A1", "200");
    await select(page, "A1", 1, 0);
    await page.keyboard.press("ControlOrMeta+d");
    const deleted = () => expectGrid(page, { A1: "200", A2: "200", B2: "" });
    await undoRedo(page, expanded, deleted, true);
  });
});

test("oo:cell/spreadsheet-calculation/DynamicArraysTests.js#Dynamic array undo/redo with expand, collapse, and blocked states", async ({ page }) => {
  await withSheet(page, {}, async () => {
    const empty = () => expectGrid(page, { A1: "", A2: "", B1: "" });
    const expanded = () => expectGrid(page, { A1: "1", A2: "3", B1: "2", B2: "4" });
    const collapsed = () => expectGrid(page, { A1: SPILL, B1: "block" });
    await empty();
    await typeAt(page, "A1", "=SEQUENCE(2,2)");
    await undoRedo(page, empty, expanded);
    await typeAt(page, "B1", "block");
    await collapsed();
    await undoRedo(page, expanded, collapsed, true);
    // A second array blocked from the start.
    await typeAt(page, "F1", "data");
    await typeAt(page, "E1", "=SEQUENCE(1,2)");
    await undoRedo(page, () => expectGrid(page, { E1: "", F1: "data" }), () => expectGrid(page, { E1: SPILL, F1: "data" }));
  });
  await withSheet(page, { B1: txt("block") }, async () => {
    await typeAt(page, "A1", "=SEQUENCE(2,2)");
    await undoRedo(page, () => expectGrid(page, { A1: "", B1: "block" }), () => expectGrid(page, { A1: SPILL, B1: "block" }), true);
  });
});

test("oo:cell/spreadsheet-calculation/DynamicArraysTests.js#Dynamic array blocked, then unblocked with undo/redo", async ({ page }) => {
  await withSheet(page, { B1: txt("block") }, async () => {
    const blocked = () => expectGrid(page, { A1: SPILL, B1: "block" });
    const expanded = () => expectGrid(page, { A1: "1", A2: "3", B1: "2", B2: "4" });
    await typeAt(page, "A1", "=SEQUENCE(2,2)");
    await blocked();
    await clearAt(page, "B1");
    await undoRedo(page, blocked, expanded, true);
  });
  await withSheet(page, {}, async () => {
    const expanded = () => expectGrid(page, { C3: "1", C4: "3", D3: "2", D4: "4" });
    const blocked = () => expectGrid(page, { C3: SPILL, D3: "blocker" });
    await typeAt(page, "C3", "=SEQUENCE(2,2)");
    await expanded();
    await typeAt(page, "D3", "blocker");
    await blocked();
    await clearAt(page, "D3");
    await expanded();
    await undoRedo(page, blocked, expanded);
  });
});

test("oo:cell/spreadsheet-calculation/DynamicArraysTests.js#Copy worksheet with dynamic arrays", async ({ page, request }) => {
  const cells = {
    A1: txt("fruit"), B1: txt("apple"), A2: txt("fruit"), B2: txt("banana"), A3: txt("vegetable"), B3: txt("carrot"),
    D1: txt("fruit"), H2: txt("BLOCK"),
  };
  await withSheet(page, cells, async (id) => {
    await typeAt(page, "E1", "=SEQUENCE(5)");
    await typeAt(page, "F1", "=FILTER(A1:B3,A1:A3=D1)");
    await typeAt(page, "H1", "=SEQUENCE(3)");
    await expectGrid(page, { E1: "1", E5: "5", F1: "fruit", G1: "apple", F2: "fruit", G2: "banana", H1: SPILL });
    // Copy the sheet from its tab menu.
    await page.locator(".luckysheet-sheets-item-active").click({ button: "right" });
    await page.getByText(/^Copy$/).first().click();
    await page.getByText("Sheet1(Copy)").click();
    await expect(page.locator(".luckysheet-sheets-item-active")).toContainText("Sheet1(Copy)");
    await expectGrid(page, { E1: "1", E5: "5", F1: "fruit", G1: "apple", F2: "fruit", G2: "banana", H1: SPILL, H2: "BLOCK" });
    // The copy's arrays are live: unblock H1, change the FILTER criterion.
    await clearAt(page, "H2");
    await expectGrid(page, { H1: "1", H2: "2", H3: "3" });
    await typeAt(page, "D1", "vegetable");
    await expectGrid(page, { F1: "vegetable", G1: "carrot", F2: "", E1: "1", E5: "5" });
    await expect(async () => {
      const wb = await getSheetData(request, id);
      expect(wb).toHaveLength(2);
      expect(cellOf(wb[1], "F1")?.f).toBe("=FILTER(A1:B3,A1:A3=D1)");
      expect(cellOf(wb[0], "F1")?.v).toBe("fruit"); // the original is unchanged
    }).toPass({ timeout: 15_000 });
  });
});

test("oo:cell/spreadsheet-calculation/DynamicArraysTests.js#Array formula display with undo/redo", async ({ page, request }) => {
  // Ctrl+Shift+Enter enters an array formula. oo-diff: OnlyOffice shows the
  // legacy {=1} braces; Grown (like Google Sheets) wraps it in ARRAYFORMULA.
  await withSheet(page, {}, async (id) => {
    await goTo(page, "A1");
    await page.keyboard.type("=1");
    await page.keyboard.press("Control+Shift+Enter");
    const present = async () =>
      expect(async () => expect(cellOf((await getSheetData(request, id))[0], "A1")?.f).toBe("=ARRAYFORMULA(1)")).toPass({ timeout: 15_000 });
    const absent = async () =>
      expect(async () => expect(cellOf((await getSheetData(request, id))[0], "A1")?.f ?? "").toBe("")).toPass({ timeout: 15_000 });
    await present();
    await expectGrid(page, { A1: "1" });
    await goTo(page, "A1");
    await undoRedo(page, absent, present, true);
  });
});

test("oo:cell/spreadsheet-calculation/DynamicArraysTests.js#Ctrl+Enter with range formula - offset behavior", async ({ page, request }) => {
  await withSheet(page, { A2: num(1), B2: num(2), C2: num(3) }, async (id) => {
    await select(page, "A1", 0, 1);
    await page.keyboard.type("=A2:B2");
    await page.keyboard.press("Control+Enter");
    await expect(async () => {
      const wb = await getSheetData(request, id);
      expect(cellOf(wb[0], "A1")?.f).toBe("=A2:B2");
      expect(cellOf(wb[0], "B1")?.f).toBe("=B2:C2");
    }).toPass({ timeout: 15_000 });
    // A1 would spill over B1's formula (#SPILL!); B1 spills into C1.
    await expectGrid(page, { A1: SPILL, B1: "2", C1: "3" });
  });
});
