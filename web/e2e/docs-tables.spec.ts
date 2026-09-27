import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { BASE_URL, createDoc, trashDoc } from "./helpers";
import { openDoc, runCommand } from "./docs/helpers";

// Docs M4: tables in the real app. Inserts a table with the size picker,
// styles it from the Table settings panel (template + look, custom outer
// and cell borders, vertical alignment), merges cells, reloads to check
// the Yjs log kept every attribute, then downloads it as .docx and imports
// the download. A second test covers text <-> table, repeat header row
// and split table.
//
// Set DOCS_M4_SCREENSHOT to save a screenshot of the styled table.

const editor = (page: Page) => page.locator(".ProseMirror").first();
const table = (page: Page, i = 0) => editor(page).locator("table").nth(i);
const cellAt = (page: Page, r: number, c: number, t = 0) =>
  table(page, t).locator(":scope > tbody > tr").nth(r).locator(":scope > td, :scope > th").nth(c);

async function dragCells(page: Page, from: [number, number], to: [number, number]) {
  const a = (await cellAt(page, ...from).boundingBox())!;
  const b = (await cellAt(page, ...to).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(editor(page).locator(".selectedCell").first()).toBeVisible();
}

async function tableMenu(page: Page, item: string) {
  await page.getByRole("button", { name: "Format", exact: true }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

async function importFromHome(page: Page, name: string, buffer: Buffer): Promise<string> {
  await page.goto(`${BASE_URL}/`);
  await page.getByTestId("tile-docs").click();
  await expect(page.getByTestId("docs-import")).toBeVisible();
  await page.getByTestId("docs-import-input").setInputFiles({
    name,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer,
  });
  await page.waitForURL(/\/docs\/d\/[^/]+$/, { timeout: 20_000 });
  await expect(page.getByTestId("collab-status")).toHaveText("connected", { timeout: 15_000 });
  return page.url().split("/").pop()!;
}

/** What the styled table must look like, in the editor or after import. */
async function expectStyled(page: Page) {
  const t = table(page);
  await expect(t).toHaveAttribute("data-table-style", "GridTable4-Accent1");
  await expect(t).toHaveAttribute("data-look", /header/);
  await expect(t.locator(":scope > tbody > tr")).toHaveCount(5);
  // Header row fill and white bold text from the template.
  await expect(cellAt(page, 0, 1)).toHaveCSS("background-color", "rgb(68, 114, 196)");
  await expect(cellAt(page, 0, 1)).toHaveCSS("color", "rgb(255, 255, 255)");
  // Banded rows: the first row after the header is band 1.
  await expect(cellAt(page, 1, 2)).toHaveCSS("background-color", "rgb(217, 226, 243)");
  await expect(cellAt(page, 2, 2)).not.toHaveCSS("background-color", "rgb(217, 226, 243)");
  // Custom outer border: 3pt double dark red.
  await expect(cellAt(page, 0, 0)).toHaveCSS("border-top-style", "double");
  await expect(cellAt(page, 0, 0)).toHaveCSS("border-top-color", "rgb(192, 0, 0)");
  await expect(cellAt(page, 4, 0)).toHaveCSS("border-bottom-style", "double");
  // A cell with its own dashed blue bottom border, vertically centred.
  await expect(cellAt(page, 2, 2)).toHaveCSS("border-bottom-style", "dashed");
  await expect(cellAt(page, 2, 2)).toHaveCSS("border-bottom-color", "rgb(0, 112, 192)");
  await expect(cellAt(page, 2, 2)).toHaveCSS("vertical-align", "middle");
  // Merged "Total" cell spanning two columns.
  await expect(t.locator('td[colspan="2"]')).toHaveText("Total");
}

test.describe.serial("docs tables", () => {
  test("picker, style, borders, merge persist and survive a .docx round trip", async ({ page }) => {
    const ids: string[] = [];
    try {
      const id = await createDoc(page.request, "e2e tables");
      ids.push(id);
      await openDoc(page, id);
      await editor(page).click();
      await page.keyboard.type("Sales by region");
      await page.keyboard.press("Enter");

      // Size picker: hover shows the size, click inserts 4 columns x 5 rows.
      await page.getByRole("button", { name: "Insert table" }).click();
      await page.getByTestId("table-size-5x4").hover();
      await expect(page.getByTestId("table-size-label")).toHaveText("4 × 5");
      await page.getByTestId("table-size-5x4").click();
      await expect(table(page).locator(":scope > tbody > tr")).toHaveCount(5);
      await expect(table(page).locator(":scope > tbody > tr").first().locator("th")).toHaveCount(4);

      const data = [
        ["Region", "Q1", "Q2", "Q3"],
        ["North", "120", "135", "150"],
        ["South", "98", "110", "104"],
        ["West", "143", "151", "160"],
        ["Total", "", "396", "414"],
      ];
      for (const [r, row] of data.entries())
        for (const [c, text] of row.entries()) {
          if (text) await page.keyboard.type(text);
          if (r < data.length - 1 || c < row.length - 1) await page.keyboard.press("Tab");
        }

      // Merge "Total" with the empty cell next to it.
      await dragCells(page, [4, 0], [4, 1]);
      await tableMenu(page, "Merge / split cells");
      await expect(table(page).locator('td[colspan="2"]')).toHaveText("Total");

      // Table settings panel: template, look, custom outer border.
      await cellAt(page, 1, 1).click();
      await tableMenu(page, "Table settings…");
      const panel = page.getByTestId("table-settings");
      await expect(panel).toBeVisible();
      await panel.getByTestId("table-style-GridTable4-Accent1").click();
      await panel.getByRole("radio", { name: "Whole table" }).check();
      await panel.getByRole("combobox", { name: "Border style" }).click();
      await page.getByRole("option", { name: "Double" }).click();
      await panel.getByRole("combobox", { name: "Border width" }).click();
      await page.getByRole("option", { name: "3 pt", exact: true }).click();
      await panel.getByLabel("Border color").fill("#c00000");
      await panel.getByTestId("border-preset-outer").click();

      // A cell border and vertical alignment on one cell.
      await cellAt(page, 2, 2).click();
      await panel.getByRole("radio", { name: "Selected cells" }).check();
      await panel.getByRole("combobox", { name: "Border style" }).click();
      await page.getByRole("option", { name: "Dashed" }).click();
      await panel.getByRole("combobox", { name: "Border width" }).click();
      await page.getByRole("option", { name: "1.5 pt", exact: true }).click();
      await panel.getByLabel("Border color").fill("#0070c0");
      await panel.getByTestId("border-preset-bottom").click();
      await panel.getByTestId("valign-middle").click();

      await expectStyled(page);
      const shot = process.env.DOCS_M4_SCREENSHOT;
      if (shot) {
        await page.getByRole("button", { name: "Close table settings" }).click();
        await cellAt(page, 3, 3).click();
        await table(page).screenshot({ path: shot.replace(/\.png$/, "-table.png") });
        await page.screenshot({ path: shot, fullPage: false });
      }

      // Everything comes back from the collab log (as in docs-styles.spec,
      // wait for the content rather than the status chip after a reload).
      await page.waitForTimeout(2500);
      await page.reload();
      await expect(editor(page)).toContainText("Total", { timeout: 15_000 });
      await expectStyled(page);

      // .docx out and back in.
      await page.getByRole("button", { name: "File", exact: true }).click();
      await page.getByText("Download", { exact: true }).click();
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("menuitem", { name: "Microsoft Word (.docx)" }).click(),
      ]);
      const bytes = await readFile((await download.path())!);
      expect(bytes.subarray(0, 2).toString()).toBe("PK");
      ids.push(await importFromHome(page, "M4 tables.docx", bytes));
      await expectStyled(page);
    } finally {
      for (const id of ids) await trashDoc(page.request, id);
    }
  });

  test("text to table and back, repeat header row, split table", async ({ page }) => {
    const id = await createDoc(page.request, "e2e tables convert");
    try {
      await openDoc(page, id);
      await editor(page).click();
      for (const [i, line] of [["Name", "Age"], ["Ada", "36"], ["Grace", "45"]].entries()) {
        await page.keyboard.type(line[0]);
        await page.keyboard.press("Tab");
        await page.keyboard.type(line[1]);
        if (i < 2) await page.keyboard.press("Enter");
      }
      await page.keyboard.press("Control+a");
      await page.getByRole("button", { name: "Insert", exact: true }).click();
      await page.getByRole("menuitem", { name: "Convert text to table…" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Convert" }).click();
      await expect(table(page).locator(":scope > tbody > tr")).toHaveCount(3);
      await expect(cellAt(page, 1, 1)).toHaveText("36");

      await cellAt(page, 0, 0).click();
      await tableMenu(page, "Repeat header row");
      await expect(table(page).locator("tr[data-repeat-header]")).toHaveCount(1);

      await cellAt(page, 2, 0).click();
      await tableMenu(page, "Split table");
      await expect(editor(page).locator("table")).toHaveCount(2);
      await expect(table(page, 1).locator("tr")).toHaveCount(1);

      await cellAt(page, 0, 0, 1).click();
      await runCommand(page, "Convert table to text");
      await expect(editor(page).locator("table")).toHaveCount(1);
      // The command palette acts on the selection too.
      await expect(editor(page).locator("table")).toHaveCount(1);
      await expect(editor(page).locator(":scope > p").last()).toHaveText("Grace\t45");
    } finally {
      await trashDoc(page.request, id);
    }
  });
});
