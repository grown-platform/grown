import { test, expect } from "@playwright/test";

const BASE_URL =
  process.env.GROWN_HTTP_URL ?? "http://workspace.localtest.me:8080";

test("OIDC login flow yields a working session", async ({ page }) => {
  await page.goto(`${BASE_URL}/api/v1/auth/login`);

  // The backend redirects (302) to Zitadel. Playwright follows.
  await expect(page).toHaveURL(/localhost:8081/);

  // Zitadel login: username on screen 1, password on screen 2.
  // The user is provisioned with loginName "admin" via create-oidc-app.sh.
  await page
    .locator('input[name="loginName"], input[id="loginName"]')
    .fill("admin");
  await page.locator('button[type="submit"]').first().click();

  await page
    .locator('input[name="password"], input[id="password"]')
    .fill("DevPassword!1");
  await page.locator('button[type="submit"]').first().click();

  // After successful login, Zitadel redirects to /api/v1/auth/callback?code=...&state=...
  // The backend then redirects to "/". Wait for the final navigation back to our origin.
  await page.waitForURL(
    new RegExp("^" + BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/?$"),
    { timeout: 30_000 },
  );

  // /api/v1/whoami should now return the authenticated user.
  const who = await page.request.get(`${BASE_URL}/api/v1/whoami`);
  expect(who.status()).toBe(200);
  const body = await who.json();
  expect(body.user.email).toBe("admin@grown.localtest.me");
  expect(body.org.slug).toBe("default");

  // Logout.
  const logout = await page.request.post(`${BASE_URL}/api/v1/auth/logout`, {
    data: {},
  });
  expect(logout.status()).toBe(200);

  // Whoami should now be unauthorized (401 from the gateway when the gRPC
  // service returns codes.Unauthenticated).
  const after = await page.request.get(`${BASE_URL}/api/v1/whoami`);
  expect(after.status()).toBe(401);
});
