import { test, expect } from "@playwright/test";
import * as path from "node:path";
import * as fs from "node:fs";

const BASE_URL =
  process.env.GROWN_HTTP_URL ?? "http://workspace.localtest.me:8080";
const FIXTURE = path.join("/tmp", "drive-fixture.txt");

test.beforeAll(() => {
  fs.writeFileSync(FIXTURE, "hello from drive e2e test\n");
});

test.afterAll(() => {
  try {
    fs.unlinkSync(FIXTURE);
  } catch {}
});

test.describe.serial("drive", () => {
  test("login + click drive tile + upload + preview + trash", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // Sign in via Zitadel.
    await page.context().clearCookies();
    await page.goto(`${BASE_URL}/`);
    await page.getByTestId("sign-in-button").click();
    await page
      .locator('input[name="loginName"], input[id="loginName"]')
      .fill("admin");
    await page.locator('button[type="submit"]').first().click();
    await page
      .locator('input[name="password"], input[id="password"]')
      .fill("DevPassword!1");
    await page.locator('button[type="submit"]').first().click();

    // Wait to land back on the app root.
    await page.waitForURL(
      new RegExp("^" + BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/?$"),
      { timeout: 30_000 },
    );

    // Open Drive from the dashboard.
    await page.getByTestId("tile-drive").click();
    await page.waitForURL(`${BASE_URL}/drive`);

    // Sidebar should mention "My Drive".
    await expect(page.getByText("My Drive").first()).toBeVisible();

    // Upload via the page-level hidden dropzone input. The input lives at the
    // FileList root now (not inside the +New dropdown), so it's always in the
    // DOM — no need to open the menu first.
    const fileInput = page.getByTestId("drive-upload-input");
    await fileInput.setInputFiles(FIXTURE);

    // Wait for the row to appear.
    await expect(page.getByText("drive-fixture.txt")).toBeVisible({
      timeout: 10_000,
    });

    // Click the file row — opens the right-side details panel (not the viewer).
    await page.getByText("drive-fixture.txt").click();
    await expect(page.getByTestId("file-details-panel")).toBeVisible({
      timeout: 5_000,
    });

    // Click "Open file" in the panel to navigate to the viewer.
    await page.getByTestId("panel-open-file").click();
    await expect(page).toHaveURL(/\/drive\/file\//);

    // Back to the list.
    await page.getByRole("button", { name: /^Back$/ }).click();
    await page.waitForURL(`${BASE_URL}/drive`);

    // Open the row's triple-dot menu, then click Move to trash.
    page.once("dialog", (d) => d.accept()); // confirm() prompt
    await page.locator('[data-testid^="row-menu-"]').first().click();
    await page.locator('[data-testid^="trash-"]').first().click();

    // Row should disappear from the list.
    await expect(page.getByText("drive-fixture.txt")).toHaveCount(0, {
      timeout: 5_000,
    });
  });
});
