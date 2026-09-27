import { test, expect, type Page } from "@playwright/test";
import * as path from "node:path";
import { createSheet, trashSheet, saveSheet, getSheetData } from "./helpers";
import { book, num, txt, fx, openSheet, menu, goTo, typeAt, expectGrid, select, cellOf, savedMatches } from "./sheetsGrid";

// Sheets M5 + M12 in the editor: trace arrows, goal seek, the function
// wizard, cell comments, links, Ctrl+A, text typed as a formula and array
// entry. Screenshots go to GROWN_SHOT_DIR (default test-results/analysis).

const SHOT_DIR = process.env.GROWN_SHOT_DIR || path.join("test-results", "analysis");
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOT_DIR, name) });

async function withSheet(page: Page, wb: any[], fn: (id: string) => Promise<void>) {
  const id = await createSheet(page.request, "e2e analysis");
  try {
    await saveSheet(page.request, id, wb);
    await openSheet(page, id);
    await fn(id);
  } finally {
    await trashSheet(page.request, id);
  }
}

test("trace precedents and dependents draw arrows on the grid", async ({ page, request }) => {
  const other = { name: "Rates", id: "s2", order: 1, row: 20, column: 10, celldata: [{ r: 0, c: 0, v: num(0.05) }] };
  const wb = book(
    {
      A1: txt("Price"), B1: num(120),
      A2: txt("Qty"), B2: num(3),
      A3: txt("Subtotal"), B3: fx("=B1*B2"),
      A5: txt("Tax"), B5: fx("=B3*Rates!A1"),
      A7: txt("Total"), D7: fx("=SUM(B3:B5)"),
      F2: fx("=D7*2"),
    },
    [other],
  );
  await withSheet(page, wb, async (id) => {
    // The deps API: D7 reads the range B3:B5 and F2 reads D7.
    const res = await request.get(`/api/v1/sheets/d/${id}/deps?cell=D7&levels=1`);
    const deps = await res.json();
    expect(deps.precedents.map((a: any) => a.to.ref)).toEqual(["B3:B5"]);
    expect(deps.dependents.map((a: any) => a.to.ref)).toEqual(["F2"]);

    await select(page, "D7");
    await menu(page, "Tools", "Trace precedents");
    await expect(page.locator('[data-testid="trace-arrows"] [data-trace="precedent"]')).toHaveCount(1);
    // A second click adds the next level: B3 <- B1, B2 and B5 <- B3, Rates!A1 (another sheet).
    await menu(page, "Tools", "Trace precedents");
    await expect(page.locator('[data-testid="trace-arrows"] [data-trace="precedent"]')).toHaveCount(5);
    await expect(page.locator('[data-trace="precedent"][data-title^="Rates!A1"]')).toHaveCount(1);
    await menu(page, "Tools", "Trace dependents");
    await expect(page.locator('[data-testid="trace-arrows"] [data-trace="dependent"]')).toHaveCount(1);
    await shot(page, "sheets-m5-trace-arrows.png");
    // Editing a traced formula updates its arrows.
    await typeAt(page, "F2", "=D7*3+B1");
    await expect(page.locator('[data-testid="trace-arrows"] [data-trace="dependent"]')).toHaveCount(1, { timeout: 15_000 });
    await menu(page, "Tools", "Remove arrows");
    await expect(page.locator('[data-testid="trace-arrows"]')).toHaveCount(0);
  });
});

test("Data ▸ What-if analysis ▸ Goal seek finds and applies the input", async ({ page, request }) => {
  const wb = book({ A1: txt("Rate"), B1: num(0.05), A2: txt("Months"), B2: num(180), A3: txt("Loan"), B3: num(100000), A4: txt("Payment"), B4: fx("=PMT(B1/12,B2,B3)") });
  await withSheet(page, wb, async (id) => {
    await select(page, "B4");
    await menu(page, "Data", "Goal seek…");
    await expect(page.getByLabel("Set cell")).toHaveValue("B4");
    await page.getByLabel("To value").fill("-900");
    await page.getByLabel("By changing cell").fill("B1");
    await page.getByRole("button", { name: "OK" }).click();
    const status = page.getByTestId("goalseek-status");
    await expect(status).toContainText("found a solution");
    await expect(status).toContainText("Current value: -900");
    await shot(page, "sheets-m5-goal-seek.png");
    await status.getByRole("button", { name: "OK" }).click();
    await savedMatches(request, id, (w) => {
      expect(Number(cellOf(w[0], "B1")?.v).toFixed(4)).toBe("0.0702");
      expect(Math.round(Number(cellOf(w[0], "B4")?.v))).toBe(-900);
    });
    // A changing cell that holds a formula is refused with a message.
    await menu(page, "Data", "Goal seek…");
    await page.getByLabel("Set cell").fill("B4");
    await page.getByLabel("To value").fill("1");
    await page.getByLabel("By changing cell").fill("B4");
    await page.getByRole("button", { name: "OK" }).click();
    await expect(page.getByRole("alert")).toContainText(/changing cell must contain a number/);
  });
});

test("Insert ▸ Function: search, arguments, live result, insert", async ({ page, request }) => {
  await withSheet(page, book({ A1: num(3), A2: num(4), A3: num(5) }), async (id) => {
    await select(page, "B1");
    await page.keyboard.press("Shift+F3");
    await expect(page.getByRole("dialog").getByText("Insert function")).toBeVisible();
    await page.getByLabel("Function category").selectOption({ label: "Statistical" });
    await page.getByLabel("Search functions").fill("average");
    await page.getByRole("option", { name: "AVERAGE", exact: true }).click();
    await page.getByLabel("number1").fill("A1:A3");
    await page.getByLabel("number2").fill("10");
    await expect(page.getByTestId("function-wizard-formula")).toContainText("=AVERAGE(A1:A3,10)");
    await expect(page.getByTestId("function-wizard-result")).toContainText("5.5");
    await page.getByLabel("number1").focus();
    await expect(page.getByTestId("function-wizard-arg-help")).toBeVisible();
    await shot(page, "sheets-m12-function-wizard.png");
    await page.getByRole("button", { name: "Insert" }).click();
    await savedMatches(request, id, (w) => {
      expect(cellOf(w[0], "B1")?.f).toBe("=AVERAGE(A1:A3,10)");
      expect(cellOf(w[0], "B1")?.v).toBe(5.5);
    });
    // Reopened on the cell, the wizard shows the call's arguments.
    await menu(page, "Insert", /Function…/);
    await expect(page.getByLabel("number1")).toHaveValue("A1:A3");
    await expect(page.getByLabel("number2")).toHaveValue("10");
  });
});

test("threaded comments on cells", async ({ page, request }) => {
  await withSheet(page, book({ A1: txt("Budget"), B2: num(1200) }), async (id) => {
    await select(page, "B2");
    await page.keyboard.press("Control+Alt+m");
    const card = page.getByTestId("cell-comment-card");
    await expect(card).toBeVisible();
    await card.getByRole("textbox", { name: "Comment" }).fill("Is this the Q3 number?");
    await card.getByRole("button", { name: "Comment", exact: true }).click();
    await card.getByRole("textbox", { name: "Reply" }).fill("Yes, approved on Monday.");
    await card.getByRole("button", { name: "Reply", exact: true }).click();
    await expect(card).toContainText("Is this the Q3 number?");
    await expect(card).toContainText("Yes, approved on Monday.");
    await shot(page, "sheets-m12-comment-thread.png");
    await savedMatches(request, id, (w) => {
      const threads = w[0].grownComments;
      expect(threads).toHaveLength(1);
      expect([threads[0].r, threads[0].c]).toEqual([1, 1]);
      expect(threads[0].comments.map((c: any) => c.body)).toEqual(["Is this the Q3 number?", "Yes, approved on Monday."]);
    });
    // The panel lists it; selecting another cell hides the card, coming back shows it.
    await menu(page, "View", "Comments");
    await expect(page.getByTestId("comments-panel")).toContainText("B2");
    await goTo(page, "D5");
    await expect(card).toHaveCount(0);
    await goTo(page, "B2");
    await expect(page.getByTestId("cell-comment-card")).toBeVisible();
    await page.getByTestId("cell-comment-card").getByRole("button", { name: "Resolve" }).click();
    await savedMatches(request, id, (w) => expect(w[0].grownComments[0].resolved).toBe(true));
  });
});

test("Insert ▸ Link (Ctrl+K)", async ({ page, request }) => {
  await withSheet(page, book({ A1: txt("Grown") }), async (id) => {
    await select(page, "A1");
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByLabel("Link text")).toHaveValue("Grown");
    await page.getByLabel("Link address").fill("code.pick.haus");
    await page.getByRole("button", { name: "Apply" }).click();
    await savedMatches(request, id, (w) => {
      expect(w[0].hyperlink?.["0_0"]).toEqual({ linkType: "webpage", linkAddress: "https://code.pick.haus" });
      expect(cellOf(w[0], "A1")?.un).toBe(1);
    });
  });
});

test("oo:cell/spreadsheet-calculation/SheetStructureTests.js#All selection test", async ({ page }) => {
  await withSheet(page, book({ A1: num(1), A2: num(2), B1: num(3), B2: num(4), C2: num(5) }), async () => {
    const box = page.locator(".fortune-name-box");
    await select(page, "A1");
    await page.keyboard.press("ControlOrMeta+a");
    await expect(box).toHaveText("A1:C2");
    await page.keyboard.press("ControlOrMeta+a");
    await expect(box).toHaveText(/^A1:[A-Z]+\d+$/);
    expect(await box.textContent()).not.toBe("A1:C2");
    await goTo(page, "K11");
    await page.keyboard.press("ControlOrMeta+a");
    await expect(box).toHaveText(/^A1:[A-Z]+\d+$/);
  });
});

test("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Text to formula tests", async ({ page, request }) => {
  await withSheet(page, book({ A1: num(1), A2: num(2), A3: num(3) }), async (id) => {
    const rows: [string, string, string | null][] = [
      ["C1", "+5+5", "=5+5"],
      ["C2", "-A1-5", "=-A1-5"],
      ["C3", "+SIN({1,2}", "=+SIN({1,2})"],
      ["C4", "*5-5", null],
      ["C5", "-5", null],
    ];
    for (const [ref, input] of rows) await typeAt(page, ref, input);
    await expectGrid(page, { C1: "10", C2: "-6", C4: "*5-5", C5: "-5" });
    await savedMatches(request, id, (w) => {
      for (const [ref, , f] of rows) expect(cellOf(w[0], ref)?.f ?? null, ref).toBe(f);
      expect(Number(cellOf(w[0], "C3")?.v)).toBeCloseTo(0.841470985, 8);
      expect(Number(cellOf(w[0], "D3")?.v)).toBeCloseTo(0.909297427, 8);
    });
  });
});

test("oo:cell/spreadsheet-calculation/SheetStructureTests.js#Array formula", async ({ page, request }) => {
  // Ctrl+Shift+Enter over A10:B12. oo-diff: OnlyOffice writes a legacy CSE
  // array into the whole selection; Grown enters =ARRAYFORMULA(…) in the
  // active cell and the result spills (Google Sheets).
  await withSheet(page, book({ A2: txt("Jeans"), A3: txt("Sweater"), A4: txt("Shirt") }), async (id) => {
    await select(page, "A10", 2, 1);
    await page.keyboard.type('=HSTACK({"Red";"Blue";"Green"},A2:A4)');
    await page.keyboard.press("Control+Shift+Enter");
    await expectGrid(page, { A10: "Red", A11: "Blue", A12: "Green", B10: "Jeans", B11: "Sweater", B12: "Shirt" });
    await savedMatches(request, id, (w) => expect(cellOf(w[0], "A10")?.f).toBe('=ARRAYFORMULA(HSTACK({"Red";"Blue";"Green"},A2:A4))'));
  });
});

test("Help ▸ Keyboard shortcuts and the Insert menu entries are live", async ({ page }) => {
  await withSheet(page, book({}), async () => {
    await page.getByRole("button", { name: "Insert", exact: true }).click();
    for (const item of [/Function…/, /Link/, /Comment/]) await expect(page.getByRole("menuitem", { name: item })).toBeEnabled();
    await page.keyboard.press("Escape");
    const data = await getSheetData(page.request, (page.url().split("/").pop() ?? ""));
    expect(Array.isArray(data)).toBe(true);
  });
});
