import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { statusWordCount, throttleTrailing } from "../docStats";

describe("statusWordCount", () => {
  it("counts runs of non-space characters", () => {
    expect(statusWordCount("")).toBe(0);
    expect(statusWordCount("   ")).toBe(0);
    expect(statusWordCount("Tour heading Some body text for the visual tour.")).toBe(9);
    expect(statusWordCount("well-known e.g.\tdone now")).toBe(4);
  });
});

describe("throttleTrailing (status bar word count)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps running while calls arrive faster than the interval", () => {
    const fn = vi.fn();
    const t = throttleTrailing(fn, 250);
    // A keystroke every 50 ms for 1 s: a restarted debounce would never fire.
    for (let i = 0; i < 20; i++) {
      t.schedule();
      vi.advanceTimersByTime(50);
    }
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(fn.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("runs once more after the last call, and not at all when idle", () => {
    const fn = vi.fn();
    const t = throttleTrailing(fn, 250);
    t.schedule();
    t.schedule();
    vi.advanceTimersByTime(249);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
    t.schedule();
    vi.advanceTimersByTime(250);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("cancel drops a pending run", () => {
    const fn = vi.fn();
    const t = throttleTrailing(fn, 250);
    t.schedule();
    t.cancel();
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
  });
});
