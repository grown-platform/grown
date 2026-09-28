import { describe, it, expect } from "vitest";
import { apps, type AppTile } from "./apps";
import { applyServiceSettings } from "./serviceSettings";

const base: AppTile = {
  id: "x",
  name: "X",
  blurb: "",
  accentColor: "#000000",
  phase: 4,
  comingSoon: false,
  iconName: "Apps",
};
const drive: AppTile = { ...base, id: "drive", name: "Drive" };
const admin: AppTile = { ...base, id: "admin", name: "Admin" };
const ha: AppTile = {
  ...base,
  id: "homeassistant",
  name: "Home Assistant",
  requiresExternalUrl: true,
};
const catalog = [drive, admin, ha];
const ids = (xs: AppTile[]) => xs.map((a) => a.id);

describe("catalog: Home Assistant tile", () => {
  it("is a bring-your-own external tile with an icon", () => {
    const t = apps.find((a) => a.id === "homeassistant");
    expect(t).toBeDefined();
    expect(t!.requiresExternalUrl).toBe(true);
    expect(t!.comingSoon).toBe(false);
    // No baked-in URL: the org (or the chart default) must supply it.
    expect(t!.externalUrl).toBeUndefined();
    expect(t!.iconName.length).toBeGreaterThan(0);
  });

  it("is hidden in the real catalog until a URL is configured", () => {
    expect(ids(applyServiceSettings(apps, []))).not.toContain("homeassistant");
    const got = applyServiceSettings(apps, [
      {
        service_id: "homeassistant",
        enabled: true,
        external_url: "http://homeassistant.local:8123",
      },
    ]).find((a) => a.id === "homeassistant");
    expect(got?.externalUrl).toBe("http://homeassistant.local:8123");
  });
});

describe("applyServiceSettings", () => {
  it("hides bring-your-own tiles with no URL, even when settings failed", () => {
    expect(ids(applyServiceSettings(catalog, null))).toEqual([
      "drive",
      "admin",
    ]);
    expect(ids(applyServiceSettings(catalog, []))).toEqual(["drive", "admin"]);
    expect(
      ids(
        applyServiceSettings(catalog, [
          { service_id: "homeassistant", enabled: true, external_url: "  " },
        ]),
      ),
    ).toEqual(["drive", "admin"]);
  });

  it("shows a bring-your-own tile linking to the org URL", () => {
    const out = applyServiceSettings(catalog, [
      {
        service_id: "homeassistant",
        enabled: true,
        external_url: " https://ha.example.com ",
      },
    ]);
    expect(ids(out)).toEqual(["drive", "admin", "homeassistant"]);
    expect(out[2].externalUrl).toBe("https://ha.example.com");
  });

  it("hides disabled services (never admin) unless hideDisabled is false", () => {
    const settings = [
      { service_id: "drive", enabled: false },
      { service_id: "admin", enabled: false },
      {
        service_id: "homeassistant",
        enabled: false,
        external_url: "https://ha.example.com",
      },
    ];
    expect(ids(applyServiceSettings(catalog, settings))).toEqual(["admin"]);
    expect(
      ids(applyServiceSettings(catalog, settings, { hideDisabled: false })),
    ).toEqual(["drive", "admin", "homeassistant"]);
  });

  it("overrides built-in tiles' URLs without mutating the catalog", () => {
    const out = applyServiceSettings(catalog, [
      { service_id: "drive", enabled: true, external_url: "https://nc.example" },
    ]);
    expect(out[0].externalUrl).toBe("https://nc.example");
    expect(drive.externalUrl).toBeUndefined();
  });
});
