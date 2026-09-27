import { test, expect, type Page } from "@playwright/test";
import { createSheet, trashSheet, saveSheet, getSheetData } from "./helpers";
import { book, num, txt, fx, openSheet, select, menu, savedMatches, cellOf, goTo, expectGrid, typeAt } from "./sheetsGrid";

// Excel tables (ListObjects): Insert ▸ Table with the style gallery, a
// calculated column, auto-expand, the total row (Ctrl+Shift+R, the
// OnlyOffice shortcuts case), structured references computed by the server
// engine, column and table renames followed by formulas, the name box, the
// header filter buttons, and the engine through the JSON API. (Column names
// avoid function-name prefixes: FortuneSheet's function autocomplete would
// take Enter while "[@Price" is typed.)

const mac = process.platform === "darwin";
const MOD = mac ? "Meta" : "Control";
const SHOT = process.env.GROWN_TABLES_SHOT;

async function withSheet(page: Page, wb: any[], fn: (id: string) => Promise<void>) {
  const id = await createSheet(page.request, "e2e tables");
  try {
    await saveSheet(page.request, id, wb);
    await openSheet(page, id);
    await fn(id);
  } finally {
    await trashSheet(page.request, id);
  }
}

const tablesOf = (wb: any[]) => (Array.isArray(wb[0]?.grownTables) ? wb[0].grownTables : []);

test("insert a styled table: calculated column, auto-expand, total row, structured references, renames", async ({ page, request }) => {
  test.setTimeout(180_000);
  const data = book({
    A1: txt("Region"),
    B1: txt("Qty"),
    C1: txt("Cost"),
    A2: txt("East"),
    B2: num(2),
    C2: num(10),
    A3: txt("West"),
    B3: num(3),
    C3: num(20),
    A4: txt("North"),
    B4: num(5),
    C4: num(4),
  });
  await withSheet(page, data, async (id) => {
    // Insert ▸ Table from one cell: the dialog proposes the data around it.
    await select(page, "B2");
    await menu(page, "Insert", /^Table/);
    const dlg = page.getByRole("dialog").filter({ hasText: "Create table" });
    await expect(dlg.getByLabel("Table range")).toHaveValue("A1:C4");
    await expect(dlg.getByRole("checkbox", { name: "My table has headers" })).toBeChecked();
    await dlg.locator('[data-style="TableStyleMedium2"]').click();
    await dlg.getByRole("button", { name: "OK" }).click();
    await expect(dlg).toBeHidden();
    await savedMatches(request, id, (wb) => {
      const t = tablesOf(wb)[0];
      expect(t?.name).toBe("Table1");
      expect(t.ref).toEqual({ r1: 0, c1: 0, r2: 3, c2: 2 });
      expect(t.columns.map((c: any) => c.name)).toEqual(["Region", "Qty", "Cost"]);
      expect(t.style.name).toBe("TableStyleMedium2");
      // The header filter buttons are the M8 filter model.
      expect(wb[0].grownFilter?.table).toBe("Table1");
    });

    // Typing a header right of the table adds a column.
    await typeAt(page, "D1", "Total");
    await savedMatches(request, id, (wb) => expect(tablesOf(wb)[0].columns.map((c: any) => c.name)).toEqual(["Region", "Qty", "Cost", "Total"]));
    // A formula in one data cell fills the column (a calculated column).
    await typeAt(page, "D2", "=[@Qty]*[@Cost]");
    await savedMatches(request, id, (wb) => {
      expect(cellOf(wb[0], "D3")?.f).toBe("=[@Qty]*[@Cost]");
      expect(cellOf(wb[0], "D4")?.f).toBe("=[@Qty]*[@Cost]");
      expect(tablesOf(wb)[0].columns[3].calculatedColumnFormula).toBe("=[@Qty]*[@Cost]");
    });
    // A row typed under the table joins it and gets the calculated formula.
    await typeAt(page, "A5", "South");
    await typeAt(page, "B5", "1");
    await typeAt(page, "C5", "7");
    await savedMatches(request, id, (wb) => {
      expect(tablesOf(wb)[0].ref.r2).toBe(4);
      expect(cellOf(wb[0], "D5")?.f).toBe("=[@Qty]*[@Cost]");
    });

    // A structured reference outside the table, computed by the server engine.
    await typeAt(page, "F1", "=SUM(Table1[Total])");
    await typeAt(page, "F2", "=ROWS(Table1)");
    await expectGrid(page, { D2: "20", D4: "20", D5: "7", F1: "107", F2: "4" }, 30_000);

    // Ctrl+Shift+R: the total row (Total label, SUBTOTAL sum in the last column).
    await goTo(page, "B3");
    await page.keyboard.press("Control+Shift+R");
    await savedMatches(request, id, (wb) => {
      const t = tablesOf(wb)[0];
      expect(t.totalsRowCount).toBe(1);
      expect(t.ref.r2).toBe(5);
      expect(cellOf(wb[0], "A6")?.v).toBe("Total");
      expect(cellOf(wb[0], "D6")?.f).toBe("=SUBTOTAL(109,[Total])");
    });
    await expectGrid(page, { D6: "107" }, 30_000);

    // Ctrl+A inside the table selects its data rows: the name box shows the table.
    await goTo(page, "B3");
    await page.keyboard.press(`${MOD}+a`);
    await expect(page.getByTestId("table-name-box")).toHaveText("Table1");

    if (SHOT) {
      await goTo(page, "F1"); // the formula bar shows =SUM(Table1[Total])
      await page.waitForTimeout(500);
      await page.getByTestId("sheet-editor").screenshot({ path: SHOT });
    }

    // Renaming a header renames the column in every formula.
    await typeAt(page, "B1", "Units");
    await savedMatches(request, id, (wb) => {
      expect(tablesOf(wb)[0].columns[1].name).toBe("Units");
      expect(cellOf(wb[0], "D2")?.f).toBe("=[@Units]*[@Cost]");
      expect(cellOf(wb[0], "D5")?.f).toBe("=[@Units]*[@Cost]");
    });

    // Table properties: rename the table; formulas follow.
    await goTo(page, "A2");
    await menu(page, "Data", "Table properties…");
    const props = page.getByRole("dialog").filter({ hasText: "Table properties" });
    await props.getByLabel("Table name").fill("Sales");
    await props.getByLabel("Table name").press("Enter");
    await expect(props.getByRole("checkbox", { name: "Total row" })).toBeChecked();
    await props.getByRole("checkbox", { name: "Banded columns" }).click();
    await props.getByRole("button", { name: "Done" }).click();
    await savedMatches(request, id, (wb) => {
      const t = tablesOf(wb)[0];
      expect(t.name).toBe("Sales");
      expect(t.style.showColumnStripes).toBe(true);
      expect(cellOf(wb[0], "F1")?.f).toBe("=SUM(Sales[Total])");
      expect(cellOf(wb[0], "F2")?.f).toBe("=ROWS(Sales)");
    });
    await expectGrid(page, { F1: "107" }, 30_000);

    // The name manager lists the table.
    await menu(page, "Data", "Named ranges");
    await expect(page.getByTestId("name-manager-table")).toContainText("Sales");
    await page.keyboard.press("Escape");
  });
});

test("oo:cell/shortcuts/shortcuts.js#Change format table info", async ({ page, request }) => {
  // The suite's table: A1:C3 (test11 test12 test13 / 1 2 3 / 1 2 3).
  const wb = book(
    { A1: txt("test11"), B1: txt("test12"), C1: txt("test13"), A2: num(1), B2: num(2), C2: num(3), A3: num(1), B3: num(2), C3: num(3) },
    [],
    {
      grownTables: [
        {
          id: 1,
          name: "Table1",
          displayName: "Table1",
          ref: { r1: 0, c1: 0, r2: 2, c2: 2 },
          headerRowCount: 1,
          totalsRowCount: 0,
          totalsRowShown: false,
          insertRow: false,
          autoFilter: true,
          columns: [{ id: 1, name: "test11" }, { id: 2, name: "test12" }, { id: 3, name: "test13" }],
          style: { name: "TableStyleMedium2", showFirstColumn: false, showLastColumn: false, showRowStripes: true, showColumnStripes: false },
        },
      ],
    },
  );
  await withSheet(page, wb, async (id) => {
    await select(page, "A2");
    await page.keyboard.press("Control+Shift+R");
    await expectGrid(page, { C4: "6" }, 30_000);
    await goTo(page, "A2");
    await page.keyboard.press("Control+Shift+R");
    await savedMatches(request, id, (w) => {
      expect(tablesOf(w)[0].totalsRowCount).toBe(0);
      expect(cellOf(w[0], "C4")?.f ?? "").toBe("");
    });
  });
});

test("table header buttons open the filter dialog for their column", async ({ page, request }) => {
  const table = {
    id: 1,
    name: "Fruit",
    displayName: "Fruit",
    ref: { r1: 0, c1: 0, r2: 3, c2: 1 },
    headerRowCount: 1,
    totalsRowCount: 0,
    totalsRowShown: false,
    insertRow: false,
    autoFilter: true,
    columns: [{ id: 1, name: "Item" }, { id: 2, name: "Qty" }],
    style: { name: "TableStyleLight9", showFirstColumn: false, showLastColumn: false, showRowStripes: true, showColumnStripes: false },
  };
  const wb = book(
    { A1: txt("Item"), B1: txt("Qty"), A2: txt("Apple"), B2: num(5), A3: txt("Pear"), B3: num(50), A4: txt("Plum"), B4: num(500), D1: fx("=SUBTOTAL(109,Fruit[Qty])") },
    [],
    {
      grownTables: [table],
      grownFilter: { range: { r1: 0, c1: 0, r2: 3, c2: 1 }, columns: {}, table: "Fruit" },
      filter_select: { row: [0, 3], column: [0, 1] },
    },
  );
  await withSheet(page, wb, async (id) => {
    await expectGrid(page, { D1: "555" }, 30_000);
    const buttons = page.locator(".luckysheet-filter-options");
    await expect(buttons).toHaveCount(2);
    await buttons.nth(1).click();
    const dlg = page.getByRole("dialog");
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText("B — Qty");
    await page.keyboard.press("Escape");
    await savedMatches(request, id, (w) => expect(w[0].grownFilter?.table).toBe("Fruit"));
  });
});

test("structured references on the server: evaluation and structure ops", async ({ request }) => {
  const id = await createSheet(request, "e2e tables api");
  try {
    const t = {
      id: 1,
      name: "T1",
      displayName: "T1",
      ref: { r1: 0, c1: 0, r2: 3, c2: 2 },
      headerRowCount: 1,
      totalsRowCount: 1,
      columns: [{ id: 1, name: "Region" }, { id: 2, name: "Qty" }, { id: 3, name: "Total", totalsRowFunction: "sum" }],
    };
    const wb = book(
      {
        A1: txt("Region"),
        B1: txt("Qty"),
        C1: txt("Total"),
        A2: txt("East"),
        B2: num(2),
        C2: fx("=[@Qty]*10"),
        A3: txt("West"),
        B3: num(3),
        C3: fx("=[@Qty]*10"),
        A4: txt("Total"),
        C4: fx("=SUBTOTAL(109,[Total])"),
        E1: fx("=SUM(T1[Qty])"),
        E2: fx("=T1[[#Totals],[Total]]"),
        E3: fx("=COUNTA(T1[#Headers])"),
        E4: fx("=INDEX(T1[#All],1,2)"),
      },
      [],
      { grownTables: [t] },
    );
    await saveSheet(request, id, wb);
    let saved = await getSheetData(request, id);
    const v = (ref: string) => cellOf(saved[0], ref)?.v;
    expect([v("C2"), v("C3"), v("C4"), v("E1"), v("E2"), v("E3"), v("E4")]).toEqual([20, 30, 50, 5, 50, 3, "Qty"]);
    // Deleting the Qty column: the table loses it and references to it become #REF!.
    const res = await request.post(`/api/v1/sheets/d/${id}/structure`, { data: { op: { kind: "delete", axis: "col", sheet: "Sheet1", index: 1, count: 1 } } });
    expect(res.ok()).toBe(true);
    saved = await getSheetData(request, id);
    expect(tablesOf(saved)[0].columns.map((c: any) => c.name)).toEqual(["Region", "Total"]);
    expect(cellOf(saved[0], "D1")?.f).toBe("=SUM(#REF!)");
    expect(cellOf(saved[0], "B2")?.f).toBe("=#REF!*10");
  } finally {
    await trashSheet(request, id);
  }
});
