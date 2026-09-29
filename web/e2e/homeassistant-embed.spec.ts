import { test, expect, type APIRequestContext } from "@playwright/test";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";
import { BASE_URL } from "./helpers";

// The Home Assistant tile opens /homeassistant, which frames the org's HA URL
// under grown's header. A tiny local HTTP server stands in for HA so the frame
// really loads cross-origin content.

const SETTINGS = `${BASE_URL}/api/v1/admin/service-settings`;

async function setHA(request: APIRequestContext, url: string) {
  const res = await request.put(SETTINGS, {
    data: { settings: [{ service_id: "homeassistant", enabled: true, external_url: url }] },
  });
  expect(res.ok(), `PUT service-settings: ${res.status()}`).toBe(true);
}

let stub: http.Server;
let stubURL = "";
let stubHits = 0;

test.describe.serial("home assistant embedded view", () => {
  test.beforeAll(async ({ request }) => {
    stub = http.createServer((req, res) => {
      if (req.url === "/" || req.url?.startsWith("/?")) stubHits++;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        `<!doctype html><html><head><title>Stub HA</title></head>` +
          `<body style="font-family:sans-serif;background:#f5f7fa;margin:0">` +
          `<div style="background:#18BCF2;color:#fff;padding:16px 24px;font-size:20px">Home Assistant</div>` +
          `<h1 id="ha-stub" style="padding:0 24px">Stub Home Assistant</h1>` +
          `<p style="padding:0 24px">Living room lights: on &middot; Thermostat: 21&deg;C</p></body></html>`,
      );
    });
    await new Promise<void>((r) => stub.listen(0, "127.0.0.1", () => r()));
    stubURL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}/`;
    await setHA(request, stubURL);
  });

  test.afterAll(async ({ request }) => {
    await setHA(request, "");
    await new Promise<void>((r) => stub.close(() => r()));
  });

  test("tile opens the in-app view and the frame loads inside grown", async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    const tile = page.getByTestId("tile-homeassistant");
    await expect(tile).toBeVisible();
    await tile.click();
    await expect(page).toHaveURL(/\/homeassistant$/);

    // Grown's header stays (hamburger services menu), with the HA toolbar.
    await expect(page.getByTestId("services-menu")).toBeVisible();
    await expect(page.getByTestId("homeassistant-url")).toHaveText(stubURL);
    const open = page.getByTestId("homeassistant-open-new-tab");
    await expect(open).toHaveAttribute("href", stubURL);
    await expect(open).toHaveAttribute("target", "_blank");

    const frame = page.getByTestId("homeassistant-frame");
    await expect(frame).toHaveAttribute("src", stubURL);
    await expect(
      page.frameLocator('[data-testid="homeassistant-frame"]').locator("#ha-stub"),
    ).toHaveText("Stub Home Assistant");
    // The frame fills the space below the header.
    const box = await frame.boundingBox();
    const vp = page.viewportSize()!;
    expect(box!.height).toBeGreaterThan(vp.height * 0.6);
    await expect(page.getByTestId("homeassistant-fallback")).toHaveCount(0);

    await page.screenshot({
      path: path.join("test-results", "homeassistant-embed.png"),
      fullPage: false,
    });
  });

  test("sign in opens SSO in a popup and reloads the frame when it closes", async ({ page }) => {
    await page.goto("/homeassistant");
    await expect(
      page.frameLocator('[data-testid="homeassistant-frame"]').locator("#ha-stub"),
    ).toBeVisible();
    const hits = () => stubHits;
    const before = hits();
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      page.getByTestId("homeassistant-sign-in").click(),
    ]);
    await popup.waitForLoadState();
    expect(popup.url()).toBe(stubURL);
    const opened = hits();
    expect(opened).toBeGreaterThan(before); // the popup loaded HA
    await popup.close();
    // The frame reloads once the popup is gone (the SSO session is now shared).
    await expect.poll(hits, { timeout: 5000 }).toBeGreaterThan(opened);
    await expect(
      page.frameLocator('[data-testid="homeassistant-frame"]').locator("#ha-stub"),
    ).toBeVisible();
  });

  test("help explains how to allow framing", async ({ page }) => {
    await page.goto(`${BASE_URL}/homeassistant`);
    await page.getByRole("button", { name: "Embedding help" }).click();
    const help = page.getByTestId("homeassistant-fallback");
    await expect(help).toContainText("use_x_frame_options: false");
    await expect(help.getByRole("link", { name: /new tab/ })).toHaveAttribute("href", stubURL);
  });

  test("/home-assistant redirects to the view", async ({ page }) => {
    await page.goto(`${BASE_URL}/home-assistant`);
    await expect(page).toHaveURL(/\/homeassistant$/);
    await expect(page.getByTestId("homeassistant-frame")).toBeVisible();
  });

  test("unconfigured shows a setup message instead of a frame", async ({ page, request }) => {
    await setHA(request, "");
    await page.goto(`${BASE_URL}/homeassistant`);
    await expect(page.getByTestId("homeassistant-fallback")).toContainText("isn't set up");
    await expect(page.getByTestId("homeassistant-frame")).toHaveCount(0);
    await setHA(request, stubURL);
  });
});
