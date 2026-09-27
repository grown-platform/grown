import { test, expect, type Page } from "@playwright/test";
import { createSheet, trashSheet, saveSheet } from "./helpers";
import { book, num, txt, fx, openSheet, select, enter, editorText, isEditing, savedMatches, cellOf, menu } from "./sheetsGrid";

// Sheets M12: the keyboard shortcuts OnlyOffice's shortcuts suite exercises
// (cell editor and "table hotkeys"), driven through real key presses. The
// graphic-object tests, Opera's NumLock/ScrollLock handling and table
// (ListObject) info are not applicable.
//
// Key presses that follow a selection change wait for the name box first
// (select() does), so a shortcut never races the grid's selection update;
// the editor itself reads the live selection when a command runs.
//
// Text-navigation keys inside the cell editor are the browser's own, so they
// follow the platform: ⌘/⌥ on macOS, Ctrl elsewhere.

const mac = process.platform === "darwin";
const MOD = mac ? "Meta" : "Control";
const WORD = mac ? "Alt" : "Control";
// Start / end of the (single-line) text: ⌘←/⌘→ on macOS, Ctrl+Home/End elsewhere.
const DOC_START = mac ? "Meta+ArrowLeft" : "Control+Home";
const DOC_END = mac ? "Meta+ArrowRight" : "Control+End";

async function withSheet(page: Page, wb: any[], fn: (id: string) => Promise<void>) {
  const id = await createSheet(page.request, "e2e shortcuts");
  try {
    await saveSheet(page.request, id, wb);
    await openSheet(page, id);
    await fn(id);
  } finally {
    await trashSheet(page.request, id);
  }
}

// Caret offset / selected text inside the cell editor.
const caret = (page: Page) =>
  page.locator(".luckysheet-cell-input").evaluate((el) => {
    const s = window.getSelection();
    if (!s || !s.rangeCount) return -1;
    const r = s.getRangeAt(0);
    const pre = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(r.startContainer, r.startOffset);
    return pre.toString().length;
  });
const selected = (page: Page) => page.evaluate(() => window.getSelection()?.toString() ?? "");

function today(kind: "date" | "time"): RegExp {
  const d = new Date();
  if (kind === "date") return new RegExp(`^${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}$`);
  return /^\d{1,2}:\d{2}:\d{2} (AM|PM)$/;
}

test.describe("cell editor shortcuts", () => {
  test("oo:cell/shortcuts/shortcuts.js#Check actions with text movements", async ({ page }) => {
    await withSheet(page, book({}), async () => {
      await select(page, "A1");
      const text = "Hello World Hello World Hello World";
      await page.keyboard.type(text);
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("ArrowLeft");
      expect(await caret(page)).toBe(text.length - 2);
      await page.keyboard.press("End");
      expect(await caret(page)).toBe(text.length);
      await page.keyboard.press("Home");
      expect(await caret(page)).toBe(0);
      await page.keyboard.press("ArrowRight");
      expect(await caret(page)).toBe(1);
      await page.keyboard.press(DOC_END);
      expect(await caret(page)).toBe(text.length);
      await page.keyboard.press(DOC_START);
      expect(await caret(page)).toBe(0);
      await page.keyboard.press("Shift+End");
      expect(await selected(page)).toBe(text);
      await page.keyboard.press("End");
      await page.keyboard.press(`${WORD}+Shift+ArrowLeft`);
      expect(await selected(page)).toBe("World");
      await page.keyboard.press(mac ? "Meta+Shift+ArrowLeft" : "Control+Shift+Home");
      expect(await selected(page)).toBe(text);
    });
  });

  test("oo:cell/shortcuts/shortcuts.js#Check remove parts of text", async ({ page }) => {
    await withSheet(page, book({}), async () => {
      await select(page, "A1");
      await page.keyboard.type("Hello Hello Hello Hello Hello");
      await page.keyboard.press("Backspace");
      expect(await editorText(page)).toBe("Hello Hello Hello Hello Hell");
      await page.keyboard.press(`${WORD}+Backspace`);
      expect(await editorText(page)).toBe("Hello Hello Hello Hello ");
      await page.keyboard.press("Home");
      await page.keyboard.press("Delete");
      expect(await editorText(page)).toBe("ello Hello Hello Hello ");
      await page.keyboard.press(`${WORD}+Delete`);
      expect((await editorText(page)).trimStart()).toBe("Hello Hello Hello ");
    });
  });

  test("oo:cell/shortcuts/shortcuts.js#Check save and moving from cell", async ({ page, request }) => {
    await withSheet(page, book({}), async (id) => {
      const box = page.locator(".fortune-name-box");
      const moves: [string, string, string][] = [
        ["Hello1", "Enter", "F7"],
        ["Hello2", "Shift+Enter", "F5"],
        ["Hello3", "Tab", "G6"],
        ["Hello4", "Shift+Tab", "E6"],
      ];
      for (const [text, key, to] of moves) {
        await select(page, "F6");
        await page.keyboard.type(text);
        await page.keyboard.press(key);
        await expect(box).toHaveText(to);
        expect(await isEditing(page)).toBe(false);
      }
      // Escape closes the editor without saving.
      await select(page, "F6");
      await page.keyboard.type("Hello5");
      await page.keyboard.press("Escape");
      await expect(box).toHaveText("F6");
      expect(await isEditing(page)).toBe(false);
      await savedMatches(request, id, (wb) => expect(cellOf(wb[0], "F6")?.v).toBe("Hello4"));
    });
  });

  test("oo:cell/shortcuts/shortcuts.js#Check change text formatting", async ({ page, request }) => {
    await withSheet(page, book({}), async (id) => {
      // While a cell is edited, strikethrough and super/subscript apply to its text.
      await select(page, "A1");
      await page.keyboard.type("Hello Hello");
      await page.keyboard.press(`${MOD}+a`);
      await page.keyboard.press("Control+5");
      await page.keyboard.press("Control+Period");
      await page.keyboard.press("Enter");
      await select(page, "A2");
      await page.keyboard.type("Hello Hello");
      await page.keyboard.press("Control+5");
      await page.keyboard.press("Control+5");
      await page.keyboard.press("Control+Period");
      await page.keyboard.press("Control+Comma");
      await page.keyboard.press("Enter");
      await savedMatches(request, id, (wb) => {
        const a1 = cellOf(wb[0], "A1");
        const a2 = cellOf(wb[0], "A2");
        expect(a1?.v).toBe("Hello Hello");
        expect(a1?.cl).toBe(1);
        expect(a1?.va).toBe(1);
        expect(a2?.v).toBe("Hello Hello");
        expect(a2?.cl ?? 0).toBe(0);
        expect(a2?.va).toBe(2);
      });
    });
  });

  test("oo:cell/shortcuts/shortcuts.js#Check enter text in cell editor", async ({ page, request }) => {
    await withSheet(page, book({}), async (id) => {
      await select(page, "A1");
      await page.keyboard.press("F2");
      await page.keyboard.press("Control+Shift+Semicolon");
      expect(await editorText(page)).toMatch(today("time"));
      await page.keyboard.press("Enter");
      await select(page, "A2");
      await page.keyboard.press("F2");
      await page.keyboard.press("Control+Semicolon");
      expect(await editorText(page)).toMatch(today("date"));
      await page.keyboard.press("Enter");
      // Alt+Enter starts a new line inside the cell.
      await select(page, "A3");
      await page.keyboard.type("one");
      await page.keyboard.press("Alt+Enter");
      await page.keyboard.type("two");
      await page.keyboard.press("Alt+Enter");
      await page.keyboard.type("three");
      expect((await editorText(page)).split("\n")).toEqual(["one", "two", "three"]);
      await page.keyboard.press("Enter");
      await savedMatches(request, id, (wb) => {
        expect(String(cellOf(wb[0], "A1")?.m)).toMatch(today("time"));
        expect(String(cellOf(wb[0], "A2")?.m)).toMatch(today("date"));
        expect(JSON.stringify(cellOf(wb[0], "A3"))).toMatch(/one.*two.*three/);
      });
    });
  });

  test("oo:cell/shortcuts/shortcuts.js#Check disabling shortcuts", async ({ page }) => {
    await withSheet(page, book({ A1: num(1) }), async () => {
      // Ctrl+P is taken over (the browser's print is prevented): Grown's print dialog opens.
      await select(page, "A1");
      await page.keyboard.press(`${MOD}+p`);
      await expect(page.getByRole("dialog").getByText(/print/i).first()).toBeVisible();
    });
  });

  test("oo:cell/shortcuts/shortcuts.js#Check select all", async ({ page }) => {
    await withSheet(page, book({}), async () => {
      await select(page, "A1");
      await page.keyboard.type("Hello");
      await page.keyboard.press(`${MOD}+a`);
      expect(await selected(page)).toBe("Hello");
      expect(await isEditing(page)).toBe(true);
    });
  });

  test("oo:cell/shortcuts/shortcuts.js#Check undo/redo in cell editor", async ({ page }) => {
    await withSheet(page, book({}), async () => {
      await select(page, "A1");
      await page.keyboard.type("Hell");
      await page.waitForTimeout(1100); // a separate typing burst
      await page.keyboard.type("o");
      expect(await editorText(page)).toBe("Hello");
      await page.keyboard.press(`${MOD}+z`);
      expect(await editorText(page)).toBe("Hell");
      await page.keyboard.press(mac ? "Meta+Shift+z" : "Control+y");
      expect(await editorText(page)).toBe("Hello");
      expect(await isEditing(page)).toBe(true);
    });
  });

  test("oo:cell/shortcuts/shortcuts.js#Check switch reference of formula", async ({ page, request }) => {
    await withSheet(page, book({ F4: num(7) }), async (id) => {
      await select(page, "A1");
      await page.keyboard.type("=F4");
      const seen: string[] = [];
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press("F4");
        seen.push(await editorText(page));
      }
      expect(seen).toEqual(["=$F$4", "=F$4", "=$F4", "=F4"]);
      await page.keyboard.press("F4");
      await page.keyboard.press("Enter");
      await savedMatches(request, id, (wb) => {
        expect(cellOf(wb[0], "A1")?.f).toBe("=$F$4");
        expect(cellOf(wb[0], "A1")?.v).toBe(7);
      });
    });
  });

  test("oo:cell/shortcuts/shortcuts.js#Test catch events", async ({ page }) => {
    await withSheet(page, book({ A1: num(1) }), async () => {
      await select(page, "B2");
      // The context-menu key opens the grid's menu at the active cell.
      await page.keyboard.press("Shift+F10");
      await expect(page.getByText("Row Above")).toBeVisible();
      await page.keyboard.press("Escape");
      const area = await page.locator(".fortune-cell-area").boundingBox();
      await page.mouse.click(area!.x + 400, area!.y + 300);
      // Print fires the print dialog.
      await select(page, "A1");
      await page.keyboard.press(`${MOD}+p`);
      await expect(page.getByRole("dialog").getByText(/print/i).first()).toBeVisible();
    });
  });
});

test.describe("table hotkeys", () => {
  test("oo:cell/shortcuts/shortcuts.js#Check drop down menu", async ({ page }) => {
    const dv = {
      dataVerification: { "0_0": { type: "dropdown", type2: "", value1: "red,green,blue", value2: "", checked: false, remote: false, prohibitInput: false, hintShow: false, hintText: "" } },
      grownDV: [{ id: "dv1", ranges: [{ r1: 0, c1: 0, r2: 0, c2: 0 }], type: "list", operator: "between", formula1: "red,green,blue", listItems: ["red", "green", "blue"], ignoreBlank: true, showDropdown: true, errorStyle: "stop" }],
    };
    await withSheet(page, book({}, [], dv), async () => {
      await select(page, "A1");
      await expect(page.locator("#luckysheet-dataVerification-dropdown-btn")).toBeVisible();
      await page.keyboard.press("Alt+ArrowDown");
      await expect(page.locator("#luckysheet-dataVerification-dropdown-List")).toBeVisible();
      await expect(page.locator("#luckysheet-dataVerification-dropdown-List")).toContainText("green");
    });
  });

  test("oo:cell/shortcuts/shortcuts.js#Check cell movement", async ({ page }) => {
    await withSheet(page, book({ P1: txt("Hello"), A26: txt("Hello") }), async () => {
      await select(page, "A1");
      await page.keyboard.press(`${MOD}+a`);
      await expect(page.locator(".fortune-name-box")).toHaveText(/^A1:[A-Z]+\d+$/);
      const all = await page.locator(".fortune-name-box").textContent();
      expect(all).not.toBe("A1");
    });
  });

  test("oo:cell/shortcuts/shortcuts.js#Check reset actions", async ({ page }) => {
    await withSheet(page, book({ A1: num(1) }), async () => {
      await select(page, "A1");
      await page.keyboard.press(`${MOD}+x`);
      await expect(page.locator(".fortune-selection-copy")).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(page.locator(".fortune-selection-copy")).toHaveCount(0);
      await page.keyboard.press(`${MOD}+c`);
      await expect(page.locator(".fortune-selection-copy")).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(page.locator(".fortune-selection-copy")).toHaveCount(0);
    });
  });

  test("oo:cell/shortcuts/shortcuts.js#Check actions with removing", async ({ page, request }) => {
    await withSheet(page, book({ C1: txt("Hello"), A5: txt("Hello"), A6: txt("Hello") }), async (id) => {
      // Active cell C1 inside A1:C6.
      await select(page, "C1");
      await page.keyboard.press("Shift+ArrowLeft");
      await page.keyboard.press("Shift+ArrowLeft");
      for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowDown");
      await expect(page.locator(".fortune-name-box")).toHaveText(/A1:C6|C1:A6/);
      // Backspace clears the active cell only and leaves it in edit mode.
      await page.keyboard.press("Backspace");
      expect(await isEditing(page)).toBe(true);
      await page.keyboard.press("Enter");
      await savedMatches(request, id, (wb) => {
        expect(cellOf(wb[0], "C1")?.v ?? "").toBe("");
        expect(cellOf(wb[0], "A5")?.v).toBe("Hello");
        expect(cellOf(wb[0], "A6")?.v).toBe("Hello");
      });
      // Delete empties the whole selection.
      await select(page, "A1", 5, 2);
      await page.keyboard.press("Delete");
      await savedMatches(request, id, (wb) => {
        expect(cellOf(wb[0], "A5")?.v ?? "").toBe("");
        expect(cellOf(wb[0], "A6")?.v ?? "").toBe("");
      });
    });
  });

  test("oo:cell/shortcuts/shortcuts.js#Check actions with filling cell", async ({ page, request }) => {
    await withSheet(page, book({}), async (id) => {
      await select(page, "A1");
      await page.keyboard.press("Control+Semicolon");
      await select(page, "A2");
      await page.keyboard.press("Control+Shift+Semicolon");
      await savedMatches(request, id, (wb) => {
        const a1 = cellOf(wb[0], "A1");
        const a2 = cellOf(wb[0], "A2");
        expect(String(a1?.m)).toMatch(today("date"));
        expect(Number.isInteger(a1?.v)).toBe(true);
        expect(String(a2?.m)).toMatch(today("time"));
        expect(typeof a2?.v).toBe("number");
      });
    });
  });

  test("oo:cell/shortcuts/shortcuts.js#Check actions with formatting cell", async ({ page, request }) => {
    const cells: Record<string, any> = {};
    for (const r of ["A1", "A2"]) cells[r] = num(0.1);
    for (const r of ["B1", "B2", "B3", "B4", "B5"]) cells[r] = num(49990);
    for (const r of ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "D1", "D2", "D3", "D4", "D5", "E1", "E2", "E3"]) cells[r] = txt("x");
    await withSheet(page, book(cells), async (id) => {
      const press = async (ref: string, ...keys: string[]) => {
        await select(page, ref);
        for (const k of keys) await page.keyboard.press(k);
      };
      await press("A1", "Control+Shift+Digit6");
      await press("A2", "Control+Shift+Digit5");
      await press("B1", "Control+Shift+Digit4");
      await press("B2", "Control+Shift+Digit2");
      await press("B3", "Control+Shift+Digit3");
      await press("B4", "Control+Shift+Digit1");
      await press("B5", "Control+Shift+Digit4", "Control+Shift+Backquote");
      // Toggles: once on, twice off.
      await press("C1", "Control+5");
      await press("C2", "Control+5", "Control+5");
      await press("C3", `${MOD}+b`);
      await press("C4", `${MOD}+b`, `${MOD}+b`);
      await press("C5", `${MOD}+i`);
      await press("C6", `${MOD}+i`, `${MOD}+i`);
      await press("C7", `${MOD}+u`);
      await press("C8", `${MOD}+u`, `${MOD}+u`);
      // Superscript, again (baseline), again (superscript), then subscript, then subscript again (baseline).
      await press("D1", "Control+Period");
      await press("D2", "Control+Period", "Control+Period");
      await press("D3", "Control+Period", "Control+Period", "Control+Period", "Control+Comma");
      await press("D4", "Control+Comma", "Control+Comma");
      await press("D5", "Alt+Shift+5");
      // Font size: up through the list to 72 and past it, down to 8 and past it.
      await press("E1", ...Array(14).fill("Control+BracketRight"));
      await press("E2", ...Array(17).fill("Control+BracketLeft"));
      await press("E3", "Control+BracketRight", "Control+BracketRight", "Control+BracketLeft");
      await savedMatches(request, id, (wb) => {
        const m = (ref: string) => cellOf(wb[0], ref)?.m;
        const at = (ref: string, k: string) => cellOf(wb[0], ref)?.[k];
        expect(m("A1")).toBe("1.00E-01");
        expect(m("A2")).toBe("10.00%");
        expect(m("B1")).toBe("$49,990.00");
        expect(m("B2")).toBe("12:00:00 AM");
        expect(m("B3")).toBe("11/11/2036");
        // oo-diff: OnlyOffice's Number is 0.00 ("49990.00"); Grown follows Excel/Google, #,##0.00.
        expect(m("B4")).toBe("49,990.00");
        expect(m("B5")).toBe("49990");
        expect(at("C1", "cl")).toBe(1);
        expect(at("C2", "cl") ?? 0).toBe(0);
        expect(at("C3", "bl")).toBe(1);
        expect(at("C4", "bl") ?? 0).toBe(0);
        expect(at("C5", "it")).toBe(1);
        expect(at("C6", "it") ?? 0).toBe(0);
        expect(at("C7", "un")).toBe(1);
        expect(at("C8", "un") ?? 0).toBe(0);
        expect(at("D1", "va")).toBe(1);
        expect(at("D2", "va") ?? 0).toBe(0);
        expect(at("D3", "va")).toBe(2);
        expect(at("D4", "va") ?? 0).toBe(0);
        expect(at("D5", "cl")).toBe(1);
        expect(at("E1", "fs")).toBe(72);
        expect(at("E2", "fs")).toBe(8);
        expect(at("E3", "fs")).toBe(11);
      });
    });
  });

  test("oo:cell/shortcuts/shortcuts.js#Check undo/redo", async ({ page, request }) => {
    await withSheet(page, book({ B1: num(5) }), async (id) => {
      await select(page, "A1");
      await enter(page, "0.1");
      await savedMatches(request, id, (wb) => expect(cellOf(wb[0], "A1")?.v).toBe(0.1));
      await page.keyboard.press(`${MOD}+z`);
      await savedMatches(request, id, (wb) => expect(cellOf(wb[0], "A1")?.v ?? "").toBe(""));
      await page.keyboard.press(mac ? "Meta+Shift+z" : "Control+y");
      await savedMatches(request, id, (wb) => expect(String(cellOf(wb[0], "A1")?.v)).toBe("0.1"));
    });
  });

  test("oo:cell/shortcuts/shortcuts.js#Check focus on cell editor", async ({ page }) => {
    await withSheet(page, book({ A1: txt("abc") }), async () => {
      await select(page, "A1");
      expect(await isEditing(page)).toBe(false);
      await page.keyboard.press("F2");
      expect(await isEditing(page)).toBe(true);
      expect(await editorText(page)).toBe("abc");
      expect((await editorText(page)).split("\n")).toHaveLength(1);
    });
  });

  test("oo:cell/shortcuts/shortcuts.js#Check show formulas shortcut", async ({ page }) => {
    await withSheet(page, book({ A1: fx("=SUM(1+2)") }), async () => {
      await select(page, "A1");
      await page.getByRole("button", { name: "View", exact: true }).click();
      await expect(page.getByRole("menuitemcheckbox", { name: /Formulas/ })).toHaveAttribute("aria-checked", "false");
      await page.keyboard.press("Escape");
      await select(page, "A1");
      await page.keyboard.press("Control+Backquote");
      await page.getByRole("button", { name: "View", exact: true }).click();
      await expect(page.getByRole("menuitemcheckbox", { name: /Formulas/ })).toHaveAttribute("aria-checked", "true");
      await page.keyboard.press("Escape");
    });
  });

  test("oo:cell/shortcuts/shortcuts.js#Check add sum formula", async ({ page, request }) => {
    await withSheet(page, book({ A1: num(1), B1: num(2), D1: num(4), D2: num(5) }), async (id) => {
      // Far from any numbers AutoSum opens =SUM() for the arguments to be typed.
      await select(page, "H8");
      await page.keyboard.press("Alt+Equal");
      await expect.poll(() => editorText(page)).toBe("=SUM()");
      await page.keyboard.type("A1,B1");
      await page.keyboard.press("Enter");
      // Below a column of numbers it proposes that column.
      await select(page, "D3");
      await page.keyboard.press("Alt+Equal");
      await expect.poll(() => editorText(page)).toBe("=SUM(D1:D2)");
      await page.keyboard.press("Enter");
      await savedMatches(request, id, (wb) => {
        expect(cellOf(wb[0], "H8")?.f).toBe("=SUM(A1,B1)");
        expect(cellOf(wb[0], "H8")?.v).toBe(3);
        expect(cellOf(wb[0], "D3")?.v).toBe(9);
      });
    });
  });

  test("oo:cell/shortcuts/shortcuts.js#Check move on worksheets", async ({ page }) => {
    const extra = [
      { name: "name1", id: "s2", order: 1, row: 20, column: 10, celldata: [{ r: 0, c: 0, v: txt("second") }] },
      { name: "name2", id: "s3", order: 2, row: 20, column: 10, celldata: [] },
    ];
    await withSheet(page, book({ A1: txt("first") }, extra), async () => {
      const active = page.locator(".luckysheet-sheets-item-active");
      await expect(active).toContainText("Sheet1");
      await select(page, "A1");
      await page.keyboard.press("Control+PageDown");
      await expect(active).toContainText("name1");
      await page.locator(".fortune-cell-area").click({ position: { x: 30, y: 10 } });
      await page.keyboard.press("Control+PageDown");
      await expect(active).toContainText("name2");
      await page.locator(".fortune-cell-area").click({ position: { x: 30, y: 10 } });
      await page.keyboard.press("Control+PageDown"); // the last sheet stays
      await expect(active).toContainText("name2");
      await page.keyboard.press("Control+PageUp");
      await expect(active).toContainText("name1");
      await page.locator(".fortune-cell-area").click({ position: { x: 30, y: 10 } });
      await page.keyboard.press("Control+PageUp");
      await expect(active).toContainText("Sheet1");
    });
  });

  test("oo:cell/shortcuts/shortcuts.js#Check recalculating data", async ({ page }) => {
    await withSheet(page, book({ A1: num(1), B1: num(2), C1: fx("=SUM(A1+B1)") }), async () => {
      await select(page, "C1");
      // F9 asks the server engine for fresh values right away (no edit, no autosave).
      const all = page.waitForRequest((r) => r.url().endsWith("/recalc") && r.method() === "POST", { timeout: 1_000 });
      await page.keyboard.press("F9");
      await all;
      const sheet = page.waitForRequest((r) => r.url().endsWith("/recalc") && r.method() === "POST", { timeout: 1_000 });
      await page.keyboard.press("Shift+F9");
      await sheet;
    });
  });

  test("oo:cell/shortcuts/shortcuts.js#Check refresh connections", async ({ page, request }) => {
    // A pivot on the grid (M9) summing a column; Alt+F5 rewrites it from the source.
    const pivot = {
      id: "pv1",
      title: "Pivot1",
      range: { r0: 0, r1: 3, c0: 0, c1: 1 },
      sourceSheetId: "s1",
      rows: [0],
      values: [{ field: 1, agg: "sum" }],
      anchor: { sheetId: "s1", r: 0, c: 4 },
    };
    await withSheet(
      page,
      book({ A1: txt("Item"), B1: txt("Qty"), A2: txt("ad"), B2: num(1), A3: txt("ad"), B3: num(2), A4: txt("ap"), B4: num(3) }, [], { grownPivots: [pivot] }),
      async (id) => {
        await select(page, "B2");
        await enter(page, "4");
        await select(page, "A1");
        await page.keyboard.press("Alt+F5");
        await savedMatches(request, id, (wb) => {
          const text = JSON.stringify(wb[0].celldata.filter((c: any) => c.c >= 4).map((c: any) => c.v?.v));
          expect(text).toContain("6"); // ad: 4 + 2
        });
      },
    );
  });
});

test("Help ▸ Keyboard shortcuts lists the binding table", async ({ page }) => {
  await withSheet(page, book({}), async () => {
    await menu(page, "Help", /Keyboard shortcuts/);
    const list = page.getByTestId("sheet-shortcuts");
    await expect(list).toBeVisible();
    await expect(list.locator('[data-shortcut="fmtCurrency"]')).toContainText("Ctrl+Shift+4");
    await expect(list.locator('[data-shortcut="toggleRef"]')).toContainText("F4");
    await page.getByLabel("Search shortcuts").fill("sheet");
    await expect(list.locator('[data-shortcut="nextSheet"]')).toBeVisible();
    await expect(list.locator('[data-shortcut="bold"]')).toHaveCount(0);
    await page.keyboard.press("Escape");
    // Ctrl+/ opens the same dialog.
    await select(page, "A1");
    await page.keyboard.press("Control+Slash");
    await expect(page.getByTestId("sheet-shortcuts")).toBeVisible();
  });
});
