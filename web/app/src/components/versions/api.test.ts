import { describe, expect, it } from "vitest";
import { VERSION_RESTORED_MSG, isVersionRestoredMsg } from "./api";

describe("isVersionRestoredMsg", () => {
  it("recognises the restore broadcast in every editor's message shape", () => {
    expect(isVersionRestoredMsg(VERSION_RESTORED_MSG)).toBe(true);
    expect(isVersionRestoredMsg(JSON.parse(JSON.stringify(VERSION_RESTORED_MSG)))).toBe(true);
    expect(isVersionRestoredMsg({ t: "versionRestored" })).toBe(true);
    expect(isVersionRestoredMsg({ type: "presence" })).toBe(false);
    expect(isVersionRestoredMsg([{ op: "replace" }])).toBe(false);
    expect(isVersionRestoredMsg(null)).toBe(false);
  });
});
