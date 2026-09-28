import { test, expect, type APIRequestContext } from "@playwright/test";
import * as path from "node:path";
import { BASE_URL } from "./helpers";

// Home Assistant is a bring-your-own tile: hidden until an org admin sets the
// org's HA URL (Admin > Services, or Settings in a personal org), then it
// opens the in-app /homeassistant view that frames that URL (dashboard tile +
// header launchers; see homeassistant-embed.spec.ts). The signed-in e2e user
// is its org's admin.

const HA_URL = "http://homeassistant.e2e.test:8123/";
const SETTINGS = `${BASE_URL}/api/v1/admin/service-settings`;

async function setHA(request: APIRequestContext, url: string) {
  const res = await request.put(SETTINGS, {
    data: {
      settings: [
        { service_id: "homeassistant", enabled: true, external_url: url },
      ],
    },
  });
  expect(res.ok(), `PUT service-settings: ${res.status()}`).toBe(true);
}

test.describe.serial("home assistant tile", () => {
  // Start (and end) with no org URL. The shared dev DB is used by other runs,
  // so always clear what this spec set.
  test.beforeAll(async ({ request }) => setHA(request, ""));
  test.afterAll(async ({ request }) => setHA(request, ""));

  test("hidden until configured; admin sets URL; tile links to it", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/`);
    await expect(page.getByTestId("tile-drive")).toBeVisible();
    await expect(page.getByTestId("tile-homeassistant")).toHaveCount(0);

    // Team orgs configure it in Admin > Services; personal orgs (no Admin
    // app) in Settings. Drive whichever this session's org uses.
    const who = await (
      await page.request.get(`${BASE_URL}/api/v1/admin/whoami`)
    ).json();
    if (who.isPersonal) {
      await page.goto(`${BASE_URL}/settings`);
      const section = page.getByTestId("settings-homeassistant");
      await expect(section).toBeVisible();
      await page.getByLabel("Home Assistant URL").fill(HA_URL);
      await page.getByTestId("settings-homeassistant-save").click();
      await expect(page.getByTestId("settings-homeassistant-clear")).toBeVisible();
      await section.screenshot({
        path: path.join("test-results", "homeassistant-settings.png"),
      });
    } else {
      await page.goto(`${BASE_URL}/admin/services`);
      const row = page.getByTestId("admin-service-homeassistant");
      await expect(row).toBeVisible();
      await expect(
        page.getByTestId("admin-service-needs-url-homeassistant"),
      ).toBeVisible();
      await expect(row).toContainText("Home Assistant URL");
      await page.getByLabel("External URL for Home Assistant").fill(HA_URL);
      await page.getByTestId("admin-service-exturl-save-homeassistant").click();
      await expect(
        page.getByTestId("admin-service-needs-url-homeassistant"),
      ).toHaveCount(0);
    }

    // Dashboard: the tile appears and opens the in-app embedded view.
    await page.goto(`${BASE_URL}/`);
    const tile = page.getByTestId("tile-homeassistant");
    await expect(tile).toBeVisible();
    await expect(tile).toHaveAttribute("href", "/homeassistant");
    await expect(tile).not.toHaveAttribute("target", "_blank");
    await expect(tile).toContainText("Home Assistant");
    await page.screenshot({
      path: path.join("test-results", "homeassistant-dashboard.png"),
      fullPage: true,
    });

    // Header 9-dot launcher uses the same resolved catalog.
    await page.getByRole("button", { name: "apps" }).click();
    const mini = page.getByTestId("switcher-homeassistant");
    await expect(mini).toBeVisible();
    await expect(mini).toHaveAttribute("href", "/homeassistant");
    await page.keyboard.press("Escape");

    // Hamburger services menu too.
    await page.getByTestId("services-menu").click();
    await expect(page.getByTestId("services-menu-homeassistant")).toHaveAttribute(
      "href",
      "/homeassistant",
    );
  });

  test("disabling the service hides the tile but keeps the URL", async ({
    page,
    request,
  }) => {
    const res = await request.put(SETTINGS, {
      data: {
        settings: [
          { service_id: "homeassistant", enabled: false, external_url: HA_URL },
        ],
      },
    });
    expect(res.ok()).toBe(true);
    await page.goto(`${BASE_URL}/`);
    await expect(page.getByTestId("tile-drive")).toBeVisible();
    await expect(page.getByTestId("tile-homeassistant")).toHaveCount(0);
    await page.getByRole("button", { name: "apps" }).click();
    await expect(page.getByTestId("switcher-drive")).toBeVisible();
    await expect(page.getByTestId("switcher-homeassistant")).toHaveCount(0);

    const got = await (await request.get(SETTINGS)).json();
    const ha = (got.settings ?? []).find(
      (s: { service_id: string }) => s.service_id === "homeassistant",
    );
    expect(ha?.external_url).toBe(HA_URL);
  });
});
