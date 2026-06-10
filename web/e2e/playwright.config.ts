import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.GROWN_HTTP_URL ?? "http://127.0.0.1:8080",
  },
  reporter: [["list"]],
});
