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
    // The SPA sign-in page is an in-app form now; start OIDC at the backend.
    await page.goto(`${BASE_URL}/api/v1/auth/login`);

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

    // The shared header mounted (the old "Welcome back" line was removed).
    await expect(page.getByTestId("services-menu")).toBeVisible();
  });

  test("clicking a live tile opens the app in the SPA", async ({
    page,
  }) => {
    // Each test gets its own browser context, so we must be authenticated here too.
    const context = await page.context();
    await context.clearCookies();

    await page.goto(`${BASE_URL}/`);
    // The SPA sign-in page is an in-app form now; start OIDC at the backend.
    await page.goto(`${BASE_URL}/api/v1/auth/login`);
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

    // Every catalog app is live now (no comingSoon tiles), so a tile click
    // routes client-side into the app. Docs is the interesting one: a hard
    // load of /docs serves the public documentation site instead.
    await page.getByTestId("tile-docs").click();

    await expect(page).toHaveURL(`${BASE_URL}/docs`);
    await expect(page.getByTestId("services-menu")).toBeVisible();
    await expect(page.getByTestId("sign-in-button")).toHaveCount(0);
  });
});
