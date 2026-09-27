import { describe, it, expect } from "vitest";
import {
  cacheUsageLabel,
  cacheUsageHint,
  cacheUsageFraction,
  retentionLabel,
} from "./radioCache";
import type { Station } from "./types";

const GiB = 1024 ** 3;

describe("radio cache helpers", () => {
  it("labels usage against the limit", () => {
    expect(
      cacheUsageLabel({
        used_bytes: 3.2 * GiB,
        songs: 812,
        max_bytes: 5 * GiB,
        max_days: 30,
      }),
    ).toBe("Radio cache: 3.2 GB of 5.0 GB · 812 songs");
  });
  it("handles empty and unlimited caches", () => {
    expect(
      cacheUsageLabel({ used_bytes: 0, songs: 1, max_bytes: 0, max_days: 0 }),
    ).toBe("Radio cache: 0 B · 1 song");
    expect(
      cacheUsageFraction({
        used_bytes: 5,
        songs: 1,
        max_bytes: 0,
        max_days: 0,
      }),
    ).toBeNull();
  });
  it("clamps the fraction", () => {
    expect(
      cacheUsageFraction({
        used_bytes: 10,
        songs: 1,
        max_bytes: 5,
        max_days: 0,
      }),
    ).toBe(1);
    expect(
      cacheUsageFraction({
        used_bytes: 1,
        songs: 1,
        max_bytes: 4,
        max_days: 0,
      }),
    ).toBe(0.25);
  });
  it("explains the limits and the saved-song guarantee", () => {
    const h = cacheUsageHint({
      used_bytes: 0,
      songs: 0,
      max_bytes: 5 * GiB,
      max_days: 30,
    });
    expect(h).toContain("5.0 GB");
    expect(h).toContain("30 days");
    expect(h).toContain("never erased");
  });
  it("labels retention", () => {
    const s = { retention_mode: "days", retention_days: 14 } as Station;
    expect(retentionLabel(s)).toBe("Erase after 14d");
    expect(retentionLabel({ ...s, retention_mode: "keep" })).toBe(
      "Keep until cache is full",
    );
  });
});
