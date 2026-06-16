import { test, expect } from "@playwright/test";
import { BASE_URL } from "./helpers";

// Per-app API smoke. Authenticated GETs against each app's list endpoint —
// validates, end to end, that the route is mounted, the session authorizes, and
// the gRPC service responds without error. Cheap, broad, and not selector-
// dependent, so it's a stable regression net across the whole backend.

// Endpoints that list without required query params → expect 200.
const LIST_200 = [
  "/api/v1/docs",
  "/api/v1/sheets",
  "/api/v1/slides",
  "/api/v1/forms",
  "/api/v1/sites",
  "/api/v1/groups",
  "/api/v1/books",
  "/api/v1/photos",
  "/api/v1/photos/albums",
  "/api/v1/contacts",
  "/api/v1/contacts/groups",
  "/api/v1/keep/notes",
  "/api/v1/keep/labels",
  "/api/v1/tasks/lists",
  "/api/v1/music/tracks",
  "/api/v1/music/playlists",
  "/api/v1/music/liked",
  "/api/v1/projects/projects",
  "/api/v1/meet/rooms",
  "/api/v1/chat/channels",
  "/api/v1/live/streams",
  "/api/v1/whiteboards",
  "/api/v1/notifications",
  "/api/v1/drive/recent",
  "/api/v1/mail/labels",
];

// Endpoints that may require query params (date range, folder…). We only assert
// the route is mounted and authorized (not 401/403/404, not a 5xx) — a 400 for
// missing params still proves the service is wired up.
const REACHABLE = [
  "/api/v1/calendar/events",
  "/api/v1/mail/messages",
  "/api/v1/drive/files",
];

test.describe("per-app API smoke", () => {
  for (const path of LIST_200) {
    test(`GET ${path} → 200`, async ({ request }) => {
      const res = await request.get(`${BASE_URL}${path}`);
      expect(res.status(), path).toBe(200);
      // Body should be JSON.
      await expect(res.json()).resolves.toBeTruthy();
    });
  }

  for (const path of REACHABLE) {
    test(`GET ${path} is mounted + authorized`, async ({ request }) => {
      const res = await request.get(`${BASE_URL}${path}`);
      const s = res.status();
      expect(s, `${path} not unauthorized`).not.toBe(401);
      expect(s, `${path} not forbidden`).not.toBe(403);
      expect(s, `${path} is mounted`).not.toBe(404);
      expect(s, `${path} no server error`).toBeLessThan(500);
    });
  }

  test("whoami returns the signed-in admin", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/v1/whoami`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe("admin@grown.localtest.me");
  });
});
