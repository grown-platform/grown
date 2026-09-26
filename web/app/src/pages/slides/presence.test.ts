import { describe, it, expect } from "vitest";
import { PRESENCE_COLORS, PRESENCE_TTL_MS, colorFor, prunePeers } from "./presence";

describe("colorFor", () => {
  it("is stable and drawn from the palette", () => {
    expect(colorFor("user-1")).toBe(colorFor("user-1"));
    for (const id of ["a", "b", "user-42", ""]) expect(PRESENCE_COLORS).toContain(colorFor(id));
  });
  it("spreads different ids over the palette", () => {
    const seen = new Set(Array.from({ length: 50 }, (_, i) => colorFor(`u${i}`)));
    expect(seen.size).toBeGreaterThan(3);
  });
});

describe("prunePeers", () => {
  it("drops peers older than the TTL", () => {
    const now = 100_000;
    const peers = {
      fresh: { ts: now - 1000 },
      edge: { ts: now - PRESENCE_TTL_MS },
      stale: { ts: now - PRESENCE_TTL_MS - 1 },
    };
    expect(Object.keys(prunePeers(peers, now))).toEqual(["fresh"]);
    expect(Object.keys(prunePeers(peers, now, 60_000)).sort()).toEqual(["edge", "fresh", "stale"]);
  });
});
