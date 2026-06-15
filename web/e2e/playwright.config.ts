import { defineConfig, devices } from "@playwright/test";
import { STORAGE_STATE } from "./helpers";

// E2e config for the Grown workspace. Tests run against a locally-running dev
// stack (see deploy/process-compose). A "setup" project authenticates once and
// saves the session to storageState; the main "authed" project reuses it so
// every spec starts signed in (and the collab WebSocket connects normally).
export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.GROWN_HTTP_URL ?? "http://workspace.localtest.me:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // 1) Authenticate once, persist the session.
    { name: "setup", testMatch: /auth\.setup\.ts/ },

    // 2) Specs needing a signed-in session reuse storageState.
    {
      name: "authed",
      testMatch: /\.spec\.ts$/,
      testIgnore: /(auth|health)\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
    },

    // 3) Specs that manage their own auth (the login flow itself) or need no
    //    session (health) run without the shared storageState.
    {
      name: "standalone",
      testMatch: /(auth|health)\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
