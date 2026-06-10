import { describe, it, expect } from "vitest";
import { apps, type AppTile } from "./apps";

describe("catalog/apps", () => {
  it("exposes a non-empty list of tiles", () => {
    expect(Array.isArray(apps)).toBe(true);
    expect(apps.length).toBeGreaterThan(10);
  });

  it("every tile has a unique non-empty id", () => {
    const ids = new Set<string>();
    for (const a of apps) {
      expect(a.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(ids.has(a.id)).toBe(false);
      ids.add(a.id);
    }
  });

  it("every tile has a name, accent color, and at least one phase tag", () => {
    for (const a of apps) {
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.accentColor).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(a.phase).toBeGreaterThanOrEqual(1);
      expect(a.phase).toBeLessThanOrEqual(4);
      expect(typeof a.iconName).toBe("string");
      expect(a.iconName.length).toBeGreaterThan(0);
    }
  });

  it("includes the core editor tiles", () => {
    const ids = new Set(apps.map((a) => a.id));
    for (const required of [
      "drive",
      "calendar",
      "mail",
      "docs",
      "sheets",
      "slides",
      "meet",
      "chat",
      "whiteboard",
    ]) {
      expect(ids.has(required)).toBe(true);
    }
  });

  it("AppTile type is exported and usable", () => {
    // Compile-time + runtime check that AppTile is exported.
    const sample: AppTile["id"] = apps[0].id;
    expect(typeof sample).toBe("string");
  });
});
