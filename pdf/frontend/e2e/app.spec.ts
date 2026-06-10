import { expect, test } from "@playwright/test";

/**
 * UI E2E tests - These tests require a browser.
 * On NixOS, run within `nix develop` to use the nix-provided chromium.
 */
test.describe("Pdf Application", () => {
  test("homepage loads and shows navigation", async ({ page }) => {
    await page.goto("/");

    // Check that the app name is visible
    await expect(page.getByText("Pdf")).toBeVisible();

    // Check that navigation items are visible
    await expect(page.getByRole("link", { name: "Documents" })).toBeVisible();
    await expect(page.getByRole("link", { name: "To Sign" })).toBeVisible();
  });

  test("documents page is accessible", async ({ page }) => {
    await page.goto("/documents");

    // Check that the page loads without errors
    await expect(page).toHaveURL("/documents");
    await expect(page.getByText("Pdf")).toBeVisible();
  });

  test("create document page is accessible", async ({ page }) => {
    await page.goto("/documents/new");

    // Check that the page loads
    await expect(page).toHaveURL("/documents/new");
    await expect(page.getByText("Pdf")).toBeVisible();
  });

  test("guest signing page handles invalid token", async ({ page }) => {
    // Try to access signing page with an invalid token
    await page.goto("/sign/invalid-token");

    // Page should load (specific error handling depends on implementation)
    await expect(page).toHaveURL("/sign/invalid-token");
  });
});
