import { test, expect, request as pwRequest } from "@playwright/test";
import { BASE_URL } from "./helpers";

// Settings > API tokens > "Connect Home Assistant" mints a no-expiry token with
// the HA integration's scopes and shows it once with setup instructions. The
// token then works against the endpoints the HA `grown` integration uses.

const HA_SCOPES = [
  "calendar:read",
  "calendar:write",
  "tasks:read",
  "tasks:write",
  "notifications:read",
  "notifications:write",
];

test("Connect Home Assistant preset", async ({ page, request }) => {
  await page.goto(`${BASE_URL}/settings`);
  await page.getByTestId("connect-homeassistant").click();
  const panel = page.getByTestId("homeassistant-token-panel");
  await expect(panel).toBeVisible();
  const token = (await page.getByTestId("homeassistant-token").textContent())!.trim();
  expect(token).toMatch(/^grw_/);
  await expect(page.getByTestId("homeassistant-grown-url")).toHaveText(new URL(BASE_URL).origin);
  await expect(panel).toContainText("Devices & services");
  await expect(panel.getByRole("link", { name: /grown\.zip/ })).toHaveAttribute(
    "href",
    "/integrations/homeassistant/grown.zip",
  );

  // Token-only client (no session cookie).
  const api = await pwRequest.newContext({
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  try {
    const info = await api.get(`${BASE_URL}/api/v1/integrations/homeassistant/info`);
    expect(info.status()).toBe(200);
    const body = await info.json();
    expect(body.scopes).toEqual(HA_SCOPES);
    expect(body.user_id).toBeTruthy();
    expect(body.version).toBeTruthy();

    expect((await api.get(`${BASE_URL}/api/v1/calendar/events`)).status()).toBe(200);
    expect((await api.get(`${BASE_URL}/api/v1/tasks/lists`)).status()).toBe(200);
    expect((await api.get(`${BASE_URL}/api/v1/drive/files`)).status()).toBe(403);
    const push = await api.post(`${BASE_URL}/api/v1/notifications/push`, {
      data: { title: "e2e: Home Assistant", message: "Front door opened", link: "/homeassistant" },
    });
    expect(push.status()).toBe(201);
    const { id } = await push.json();
    // Shows up in the caller's feed; clean it up.
    const list = await (await api.get(`${BASE_URL}/api/v1/notifications`)).json();
    const n = list.notifications.find((x: { id: string }) => x.id === id);
    expect(n?.type).toBe("homeassistant");
    expect((await api.delete(`${BASE_URL}/api/v1/notifications/${id}`)).ok()).toBe(true);
  } finally {
    await api.dispose();
    // Revoke the preset token(s) this test created.
    const { tokens } = await (await request.get(`${BASE_URL}/api/v1/me/tokens`)).json();
    for (const t of tokens as { id: string; name: string; prefix: string }[]) {
      if (t.name === "Home Assistant" && token.startsWith(t.prefix)) {
        await request.delete(`${BASE_URL}/api/v1/me/tokens/${t.id}`);
      }
    }
  }
});
