import { test, expect } from "@playwright/test";
import {
  createDeck,
  createDoc,
  createSheet,
  saveSheet,
  trashDeck,
  trashDoc,
  trashSheet,
  workbookWithCells,
} from "./helpers";
import { openDoc, typeInto } from "./docs/helpers";

// Visual tour: opens each editor with representative content and saves a
// full-page screenshot to test-results/tour/<name>.png for eyeballing a deploy
// (e.g. after `deploy/local/stack.sh deploy <worktree>`). Opt-in so the normal
// suite stays fast:
//
//   GROWN_TOUR=1 npx playwright test tour.spec.ts
//
// Add a shot here whenever a feature lands that is worth looking at.

test.skip(!process.env.GROWN_TOUR, "set GROWN_TOUR=1 to run the visual tour");

const shot = (name: string) => ({
  path: `test-results/tour/${name}.png`,
  fullPage: true,
});

test("tour: docs editor", async ({ page }) => {
  const id = await createDoc(page.request, "Tour doc");
  try {
    await openDoc(page, id);
    await typeInto(page, "Tour heading\nSome body text for the visual tour.");
    await page.screenshot(shot("docs"));
  } finally {
    await trashDoc(page.request, id);
  }
});

test("tour: sheets formulas", async ({ page }) => {
  const id = await createSheet(page.request, "Tour sheet");
  try {
    await saveSheet(
      page.request,
      id,
      workbookWithCells([
        { r: 0, c: 0, v: "Value" },
        { r: 1, c: 0, v: 10 },
        { r: 2, c: 0, v: 32 },
        { r: 3, c: 0, f: "=SUM(A2:A3)" },
        { r: 4, c: 0, f: '=TEXT(DATE(2026,9,26),"yyyy-mm-dd")' },
        { r: 5, c: 0, f: "=IFERROR(1/0,\"div0\")" },
      ]),
    );
    await page.goto(`/sheets/d/${id}`);
    await expect(page.locator(".fortune-sheet-canvas")).toBeVisible({
      timeout: 20_000,
    });
    await page.screenshot(shot("sheets"));
  } finally {
    await trashSheet(page.request, id);
  }
});

test("tour: slides editor", async ({ page }) => {
  const id = await createDeck(page.request, "Tour deck");
  try {
    await page.goto(`/slides/d/${id}`);
    await page.waitForLoadState("networkidle");
    await page.screenshot(shot("slides"));
  } finally {
    await trashDeck(page.request, id);
  }
});
