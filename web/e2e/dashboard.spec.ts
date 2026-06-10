import { test, expect } from "@playwright/test";

const BASE_URL =
  process.env.GROWN_HTTP_URL ?? "http://workspace.localtest.me:8080";

test.describe.serial("dashboard", () => {
  test("sign-in screen renders when not authenticated", async ({ page }) => {
    // Use a fresh context (no cookies) to guarantee the unauthenticated state.
    const context = await page.context();
    await context.clearCookies();

    await page.goto(`${BASE_URL}/`);
    await expect(page.getByTestId("sign-in-button")).toBeVisible();
  });

  test("after OIDC login, dashboard shows the catalog of tiles", async ({
    page,
  }) => {
    const context = await page.context();
    await context.clearCookies();

    await page.goto(`${BASE_URL}/`);
    await page.getByTestId("sign-in-button").click();

    // Now we're on the Zitadel login form.
    await page
      .locator('input[name="loginName"], input[id="loginName"]')
      .fill("admin");
    await page.locator('button[type="submit"]').first().click();
    await page
      .locator('input[name="password"], input[id="password"]')
      .fill("DevPassword!1");
    await page.locator('button[type="submit"]').first().click();

    // Land back on dashboard.
    await page.waitForURL(
      new RegExp(
        "^" + BASE_URL.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&") + "/?$",
      ),
      { timeout: 30_000 },
    );

    // Several tiles should be visible.
    await expect(page.getByTestId("tile-drive")).toBeVisible();
    await expect(page.getByTestId("tile-docs")).toBeVisible();
    await expect(page.getByTestId("tile-whiteboard")).toBeVisible();

    // Welcome line uses the admin's display name or email.
    await expect(page.getByText(/Welcome back/i)).toBeVisible();
  });

  test("clicking a non-live tile navigates to its coming-soon page", async ({
    page,
  }) => {
    // Each test gets its own browser context, so we must be authenticated here too.
    const context = await page.context();
    await context.clearCookies();

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
    await page.waitForURL(
      new RegExp(
        "^" + BASE_URL.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&") + "/?$",
      ),
      { timeout: 30_000 },
    );

    // Docs is not yet live — clicking it should show the coming-soon page.
    await page.getByTestId("tile-docs").click();

    await expect(page).toHaveURL(`${BASE_URL}/coming-soon/docs`);
    await expect(page.getByText("Coming soon", { exact: false })).toBeVisible();
    await expect(page.getByTestId("back-to-dashboard")).toBeVisible();
  });
});
