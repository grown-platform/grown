import { test as setup, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { BASE_URL, STORAGE_STATE } from "./helpers";

// Shared authentication. Runs once before the test projects and saves the
// signed-in session to storageState, so every spec starts already
// authenticated instead of re-driving the Zitadel OIDC login each time. This
// also means the collaboration WebSocket (which needs the session cookie)
// connects normally in the test browser.
//
// The dev stack (deploy/process-compose) provisions a Zitadel user with
// loginName "admin" / password "DevPassword!1" via create-oidc-app.sh.

setup("authenticate", async ({ page }) => {
  fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true });

  // Start the OIDC flow directly: the SPA's sign-in page is now an in-app
  // email/password form, while the backend login route still redirects to
  // Zitadel's hosted login (the same path auth.spec.ts exercises).
  await page.goto(`${BASE_URL}/api/v1/auth/login`);
  await expect(page).toHaveURL(/localhost:8081/);

  // Zitadel hosted login: username then password, each behind a submit.
  await page
    .locator('input[name="loginName"], input[id="loginName"]')
    .fill("admin");
  await page.locator('button[type="submit"]').first().click();
  await page
    .locator('input[name="password"], input[id="password"]')
    .fill("DevPassword!1");
  await page.locator('button[type="submit"]').first().click();

  // Land back on the app origin.
  await page.waitForURL(
    new RegExp("^" + BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/?$"),
    { timeout: 30_000 },
  );

  // Confirm the session is live before persisting it.
  const who = await page.request.get(`${BASE_URL}/api/v1/whoami`);
  expect(who.status()).toBe(200);

  await page.context().storageState({ path: STORAGE_STATE });
});
