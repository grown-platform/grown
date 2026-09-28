import { describe, it, expect } from "vitest";
import { embedBlockReason, resolveHomeAssistantUrl } from "./embed";
import { apps, externalHref } from "../../catalog/apps";
import { applyServiceSettings } from "../../catalog/serviceSettings";
import { isExternalTarget } from "../../api/notifications";

describe("resolveHomeAssistantUrl", () => {
  const ha = (external_url?: string, enabled = true) => [
    { service_id: "drive", enabled: true },
    { service_id: "homeassistant", enabled, external_url },
  ];
  it("returns the configured URL", () => {
    expect(resolveHomeAssistantUrl(ha("https://ha.example.com"))).toBe("https://ha.example.com/");
    expect(resolveHomeAssistantUrl(ha(" http://homeassistant.local:8123/lovelace "))).toBe(
      "http://homeassistant.local:8123/lovelace",
    );
  });
  it("is null when unset, disabled, unloaded or not http(s)", () => {
    expect(resolveHomeAssistantUrl(undefined)).toBeNull();
    expect(resolveHomeAssistantUrl(null)).toBeNull();
    expect(resolveHomeAssistantUrl([])).toBeNull();
    expect(resolveHomeAssistantUrl(ha(""))).toBeNull();
    expect(resolveHomeAssistantUrl(ha("https://ha.example.com", false))).toBeNull();
    expect(resolveHomeAssistantUrl(ha("javascript:alert(1)"))).toBeNull();
    expect(resolveHomeAssistantUrl(ha("not a url"))).toBeNull();
  });
});

describe("embedBlockReason", () => {
  it("flags http HA inside https grown (mixed content)", () => {
    expect(embedBlockReason("http://ha.lan:8123/", "https:")).toBe("mixed-content");
  });
  it("allows same-scheme, upgrade and loopback", () => {
    expect(embedBlockReason("https://ha.example.com/", "https:")).toBeNull();
    expect(embedBlockReason("http://ha.lan:8123/", "http:")).toBeNull();
    expect(embedBlockReason("https://ha.example.com/", "http:")).toBeNull();
    expect(embedBlockReason("http://localhost:8123/", "https:")).toBeNull();
  });
});

describe("Home Assistant tile opens in-app", () => {
  it("links to the in-app route, not a new tab, once configured", () => {
    const tiles = applyServiceSettings(apps, [
      { service_id: "homeassistant", enabled: true, external_url: "https://ha.example.com" },
    ]);
    const t = tiles.find((a) => a.id === "homeassistant")!;
    expect(t.externalUrl).toBe("https://ha.example.com");
    expect(t.embedInApp).toBe(true);
    expect(externalHref(t)).toBeUndefined();
  });
  it("other external tiles still open in a new tab", () => {
    const withUrl = apps.find((a) => a.externalUrl && !a.embedInApp);
    expect(withUrl).toBeDefined();
    expect(externalHref(withUrl!)).toBe(withUrl!.externalUrl);
  });
});

describe("isExternalTarget", () => {
  it("detects absolute http(s) links", () => {
    expect(isExternalTarget("https://ha.example.com/x")).toBe(true);
    expect(isExternalTarget("HTTP://ha.lan")).toBe(true);
    expect(isExternalTarget("/calendar")).toBe(false);
    expect(isExternalTarget("")).toBe(false);
  });
});
