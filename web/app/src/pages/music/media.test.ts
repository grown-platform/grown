import { describe, it, expect } from "vitest";
import { formatDuration, formatClock, formatBytes } from "./media";

// probeAudio is intentionally NOT tested here: it relies on browser-only APIs
// (URL.createObjectURL, document.createElement("audio"), <audio> metadata
// events, window timers) and has no pure logic to exercise in isolation. The
// three formatters below are pure and fully covered.

describe("formatDuration", () => {
  // formatDuration returns "" for falsy/negative/non-finite, else M:SS or H:MM:SS.
  const cases: [number, string][] = [
    [0, ""], // falsy → empty
    [-1, ""], // negative → empty
    [-3600, ""], // large negative → empty
    [NaN, ""], // non-finite → empty
    [Infinity, ""], // non-finite → empty
    [-Infinity, ""], // non-finite → empty
    [1, "0:01"],
    [9, "0:09"],
    [59, "0:59"],
    [60, "1:00"],
    [61, "1:01"],
    [125, "2:05"],
    [599, "9:59"],
    [600, "10:00"],
    [3599, "59:59"],
    [3600, "1:00:00"], // crosses into H:MM:SS
    [3661, "1:01:01"],
    [3725, "1:02:05"],
    [7322, "2:02:02"],
    [36000, "10:00:00"],
    [90061, "25:01:01"], // > 24h, hours not wrapped
    [12.9, "0:12"], // fractional seconds floored
    [59.9, "0:59"],
    [119.999, "1:59"],
  ];

  it.each(cases)("formatDuration(%p) === %p", (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });
});

describe("formatClock", () => {
  // formatClock returns "0:00" for non-finite/negative, else M:SS or H:MM:SS.
  const cases: [number, string][] = [
    [0, "0:00"], // zero is a valid clock, not empty
    [-1, "0:00"], // negative → 0:00
    [-9999, "0:00"],
    [NaN, "0:00"], // non-finite → 0:00
    [Infinity, "0:00"],
    [-Infinity, "0:00"],
    [1, "0:01"],
    [9, "0:09"],
    [59, "0:59"],
    [60, "1:00"],
    [61, "1:01"],
    [125, "2:05"],
    [3599, "59:59"],
    [3600, "1:00:00"],
    [3661, "1:01:01"],
    [90061, "25:01:01"],
    [12.9, "0:12"], // fractional floored
    [0.5, "0:00"], // sub-second floors to 0
  ];

  it.each(cases)("formatClock(%p) === %p", (input, expected) => {
    expect(formatClock(input)).toBe(expected);
  });
});

describe("formatBytes", () => {
  // formatBytes returns "" for falsy/negative, else a human-readable size.
  // Decimals: 0 when value >= 10 or unit is "B" (i===0), else 1 decimal.
  const cases: [number, string][] = [
    [0, ""], // falsy → empty
    [-1, ""], // negative → empty
    [-2048, ""], // large negative → empty
    [1, "1 B"], // i===0 → no decimals
    [512, "512 B"],
    [1023, "1023 B"], // just under 1 KB stays in B
    [1024, "1.0 KB"], // exactly 1 KB → 1 decimal (n<10)
    [1536, "1.5 KB"], // 1.5 KB
    [10240, "10 KB"], // n>=10 → no decimals
    [1048575, "1024 KB"], // just under 1 MB: n≈1024 >=10 → toFixed(0)="1024"
    [1048576, "1.0 MB"], // exactly 1 MB
    [5242880, "5.0 MB"], // 5 MB
    [15728640, "15 MB"], // 15 MB, n>=10 → no decimals
    [1073741824, "1.0 GB"], // 1 GB
    [1099511627776, "1.0 TB"], // 1 TB (largest unit)
    [1125899906842624, "1024 TB"], // beyond TB stays in TB (capped unit), n>=10 → no decimals
  ];

  it.each(cases)("formatBytes(%p) === %p", (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });

  it("rounds to one decimal for small-unit fractional values", () => {
    // 1234 bytes = 1.205 KB → toFixed(1) = "1.2 KB"
    expect(formatBytes(1234)).toBe("1.2 KB");
  });
});
