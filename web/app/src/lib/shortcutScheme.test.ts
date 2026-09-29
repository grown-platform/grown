import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getShortcutScheme,
  resetShortcutSchemesForTest,
  resolveScheme,
  schemesFromExtra,
  setShortcutScheme,
  syncShortcutSchemes,
  withScheme,
} from "./shortcutScheme";

describe("scheme resolution", () => {
  it("accepts office and google, anything else is office", () => {
    expect(resolveScheme("office")).toBe("office");
    expect(resolveScheme("google")).toBe("google");
    for (const v of [undefined, null, "", "Google", "mac", 1, {}, ["google"]]) expect(resolveScheme(v)).toBe("office");
  });

  it("reads both apps from the preferences extra bag", () => {
    expect(schemesFromExtra(undefined)).toEqual({ docs: "office", sheets: "office" });
    expect(schemesFromExtra("not json")).toEqual({ docs: "office", sheets: "office" });
    expect(schemesFromExtra("[1]")).toEqual({ docs: "office", sheets: "office" });
    expect(schemesFromExtra('{"docs_shortcut_scheme":"google","sheets_shortcut_scheme":"excel"}')).toEqual({
      docs: "google",
      sheets: "office",
    });
  });

  it("writes one app's scheme and keeps every other key", () => {
    const x = withScheme('{"spell":{"enabled":true,"words":["grown"]},"sheets_shortcut_scheme":"google"}', "docs", "google");
    expect(JSON.parse(x)).toEqual({
      spell: { enabled: true, words: ["grown"] },
      sheets_shortcut_scheme: "google",
      docs_shortcut_scheme: "google",
    });
    expect(JSON.parse(withScheme("", "sheets", "office"))).toEqual({ sheets_shortcut_scheme: "office" });
  });
});

describe("preferences round-trip", () => {
  let server: { extra: string };
  let patches: unknown[];

  beforeEach(() => {
    resetShortcutSchemesForTest();
    try {
      localStorage.clear();
    } catch {
      /* Node's stub localStorage has no clear() */
    }
    server = { extra: '{"spell":{"enabled":false,"words":[]}}' };
    patches = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe("/api/v1/me/preferences");
        if (init?.method === "PATCH") {
          const body = JSON.parse(String(init.body)) as { extra: string; update_mask: string[] };
          patches.push(body);
          server.extra = body.extra;
        }
        return new Response(JSON.stringify({ user_id: "u", language: "en", extra: server.extra }), { status: 200 });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("saves the scheme into extra with an extra-only mask, then reads it back", async () => {
    expect(getShortcutScheme("docs")).toBe("office");
    const saved = await setShortcutScheme("docs", "google");
    expect(getShortcutScheme("docs")).toBe("google"); // applies at once
    expect(patches).toEqual([{ extra: expect.any(String), update_mask: ["extra"] }]);
    expect(JSON.parse(saved!)).toEqual({ spell: { enabled: false, words: [] }, docs_shortcut_scheme: "google" });

    // A fresh page load (another device) picks it up from the server.
    resetShortcutSchemesForTest();
    expect(getShortcutScheme("docs")).toBe("office");
    await syncShortcutSchemes();
    expect(getShortcutScheme("docs")).toBe("google");
    expect(getShortcutScheme("sheets")).toBe("office");
  });

  it("an unknown stored value falls back to office", async () => {
    server.extra = '{"sheets_shortcut_scheme":"lotus"}';
    await syncShortcutSchemes(true);
    expect(getShortcutScheme("sheets")).toBe("office");
  });

  it("keeps the local choice when the server is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    expect(await setShortcutScheme("sheets", "google")).toBeNull();
    expect(getShortcutScheme("sheets")).toBe("google");
    await syncShortcutSchemes(true);
    expect(getShortcutScheme("sheets")).toBe("google");
  });
});
