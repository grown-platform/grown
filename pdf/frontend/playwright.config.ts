import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E test configuration for pdf
 * See https://playwright.dev/docs/test-configuration
 *
 * Run API tests only (no browser needed):
 *   npm run test:e2e -- --project=api
 *
 * Run UI tests (requires browser - use nix develop on NixOS):
 *   npm run test:e2e -- --project=chromium
 *
 * Run all tests:
 *   npm run test:e2e
 */
// Dev-server port. Defaults to 5173 (CI); override with PLAYWRIGHT_PORT when
// 5173 is already taken locally by another app.
const PORT = process.env.PLAYWRIGHT_PORT || "5173";
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { open: "never" }]],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  /* Run dev server before starting tests (if not already running) */
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_API_URL: "http://localhost:8080",
    },
  },

  projects: [
    // API tests - no browser required, can run anywhere
    {
      name: "api",
      testMatch: /api\.spec\.ts/,
      use: {
        // No browser needed for API tests
      },
    },

    // UI tests - require browser
    {
      name: "chromium",
      testMatch: /app\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },

    // Editor E2E tests - require browser
    {
      name: "editor",
      testMatch: /editor.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
