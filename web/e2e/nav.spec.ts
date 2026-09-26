import { test, expect } from "@playwright/test";
import { BASE_URL } from "./helpers";

// Route-render smoke: navigate to each shipped app and confirm it mounts while
// authenticated — the shared Header (services-menu button) renders and the
// sign-in screen does NOT. Catches routing regressions, auth gaps, and crashes
// on first paint across the suite without depending on each app's internals.

const APPS = [
  "drive",
  // "docs" is omitted: a hard load of /docs serves the public documentation
  // site (internal/server/server.go), which shadows the Docs app's home route.
  // Docs itself is covered by docs.spec.ts via /docs/<id>.
  "sheets",
  "slides",
  "mail",
  "calendar",
  "contacts",
  "music",
  "photos",
  "projects",
  "keep",
  "tasks",
  "forms",
  "books",
  "groups",
  "meet",
];

test.describe("app route render", () => {
  for (const app of APPS) {
    test(`/${app} renders the app shell when authenticated`, async ({
      page,
    }) => {
      await page.goto(`${BASE_URL}/${app}`);
      // We stayed in the app (not bounced to the sign-in screen).
      await expect(page.getByTestId("sign-in-button")).toHaveCount(0);
      // The shared workspace header mounted.
      await expect(page.getByTestId("services-menu")).toBeVisible({
        timeout: 15_000,
      });
      // URL is the app's mount path.
      expect(page.url()).toContain(`/${app}`);
    });
  }
});
