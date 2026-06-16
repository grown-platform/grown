import { describe, it, expect, vi, afterEach } from "vitest";
import {
  MONTHS,
  DOW,
  EVENT_COLORS,
  startOfDay,
  addDays,
  addMonths,
  startOfWeek,
  sameDay,
  isToday,
  monthGrid,
  weekDays,
  fmtTime,
  toLocalInput,
  fromLocalInput,
  toDateInput,
} from "./dateutils";

// All Date construction below uses local-time components (new Date(y, m, d, ...))
// since every util reads/writes via local getters/setters.

describe("constants", () => {
  it("MONTHS has 12 entries in order", () => {
    expect(MONTHS).toHaveLength(12);
    expect(MONTHS[0]).toBe("January");
    expect(MONTHS[11]).toBe("December");
  });

  it("DOW has 7 entries starting Sunday", () => {
    expect(DOW).toHaveLength(7);
    expect(DOW[0]).toBe("Sun");
    expect(DOW[6]).toBe("Sat");
  });

  it("EVENT_COLORS are 8 hex strings", () => {
    expect(EVENT_COLORS).toHaveLength(8);
    for (const c of EVENT_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("startOfDay", () => {
  it("zeroes the time portion", () => {
    const out = startOfDay(new Date(2024, 5, 15, 13, 47, 22, 500));
    expect(out.getFullYear()).toBe(2024);
    expect(out.getMonth()).toBe(5);
    expect(out.getDate()).toBe(15);
    expect(out.getHours()).toBe(0);
    expect(out.getMinutes()).toBe(0);
    expect(out.getSeconds()).toBe(0);
    expect(out.getMilliseconds()).toBe(0);
  });

  it("does not mutate the input", () => {
    const input = new Date(2024, 5, 15, 13, 47);
    startOfDay(input);
    expect(input.getHours()).toBe(13);
  });

  it("leaves an already-midnight date unchanged", () => {
    const out = startOfDay(new Date(2024, 0, 1, 0, 0, 0, 0));
    expect(out.getTime()).toBe(new Date(2024, 0, 1).getTime());
  });
});

describe("addDays", () => {
  const cases: [string, Date, number, [number, number, number]][] = [
    ["simple +1", new Date(2024, 5, 15), 1, [2024, 5, 16]],
    ["negative", new Date(2024, 5, 15), -5, [2024, 5, 10]],
    ["zero", new Date(2024, 5, 15), 0, [2024, 5, 15]],
    ["month rollover", new Date(2024, 0, 31), 1, [2024, 1, 1]],
    ["year rollover", new Date(2024, 11, 31), 1, [2025, 0, 1]],
    ["leap day Feb 28 -> 29", new Date(2024, 1, 28), 1, [2024, 1, 29]],
    ["non-leap Feb 28 -> Mar 1", new Date(2023, 1, 28), 1, [2023, 2, 1]],
    ["large span", new Date(2024, 0, 1), 365, [2024, 11, 31]],
  ];
  it.each(cases)("%s", (_label, input, n, [y, m, d]) => {
    const out = addDays(input, n);
    expect([out.getFullYear(), out.getMonth(), out.getDate()]).toEqual([y, m, d]);
  });

  it("preserves time-of-day and does not mutate input", () => {
    const input = new Date(2024, 5, 15, 9, 30);
    const out = addDays(input, 3);
    expect(out.getHours()).toBe(9);
    expect(out.getMinutes()).toBe(30);
    expect(input.getDate()).toBe(15);
  });
});

describe("addMonths", () => {
  const cases: [string, Date, number, [number, number, number]][] = [
    ["simple +1", new Date(2024, 0, 15), 1, [2024, 1, 15]],
    ["negative", new Date(2024, 2, 15), -3, [2023, 11, 15]],
    ["year rollover", new Date(2024, 11, 10), 1, [2025, 0, 10]],
    // JS Date overflow: Jan 31 + 1mo -> Feb 31 -> Mar 2 (2024 is leap)
    ["day overflow Jan31 -> Mar2", new Date(2024, 0, 31), 1, [2024, 2, 2]],
    // Jan 31 + 1mo in non-leap 2023 -> Feb 31 -> Mar 3
    ["day overflow Jan31 -> Mar3 (non-leap)", new Date(2023, 0, 31), 1, [2023, 2, 3]],
  ];
  it.each(cases)("%s", (_label, input, n, [y, m, d]) => {
    const out = addMonths(input, n);
    expect([out.getFullYear(), out.getMonth(), out.getDate()]).toEqual([y, m, d]);
  });

  it("does not mutate input", () => {
    const input = new Date(2024, 0, 15);
    addMonths(input, 5);
    expect(input.getMonth()).toBe(0);
  });
});

describe("startOfWeek", () => {
  it("returns the Sunday of the week and zeroes time", () => {
    // 2024-06-15 is a Saturday -> week start Sun 2024-06-09
    const out = startOfWeek(new Date(2024, 5, 15, 14, 0));
    expect([out.getFullYear(), out.getMonth(), out.getDate()]).toEqual([2024, 5, 9]);
    expect(out.getDay()).toBe(0);
    expect(out.getHours()).toBe(0);
  });

  it("a Sunday maps to itself", () => {
    // 2024-06-09 is a Sunday
    const out = startOfWeek(new Date(2024, 5, 9, 10, 0));
    expect([out.getMonth(), out.getDate()]).toEqual([5, 9]);
    expect(out.getDay()).toBe(0);
  });

  it("crosses month/year boundary backwards", () => {
    // 2025-01-01 is a Wednesday -> week start Sun 2024-12-29
    const out = startOfWeek(new Date(2025, 0, 1));
    expect([out.getFullYear(), out.getMonth(), out.getDate()]).toEqual([2024, 11, 29]);
    expect(out.getDay()).toBe(0);
  });
});

describe("sameDay", () => {
  it("true for same calendar day, different times", () => {
    expect(sameDay(new Date(2024, 5, 15, 1, 0), new Date(2024, 5, 15, 23, 59))).toBe(true);
  });
  it("false across day boundary", () => {
    expect(sameDay(new Date(2024, 5, 15), new Date(2024, 5, 16))).toBe(false);
  });
  it("false for same day-of-month in different month", () => {
    expect(sameDay(new Date(2024, 5, 15), new Date(2024, 6, 15))).toBe(false);
  });
  it("false for same day/month different year", () => {
    expect(sameDay(new Date(2024, 5, 15), new Date(2023, 5, 15))).toBe(false);
  });
});

describe("isToday", () => {
  afterEach(() => vi.useRealTimers());

  it("true when the date is the mocked now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 5, 15, 12, 0));
    expect(isToday(new Date(2024, 5, 15, 8, 0))).toBe(true);
  });

  it("false for a different day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 5, 15, 12, 0));
    expect(isToday(new Date(2024, 5, 16, 8, 0))).toBe(false);
  });
});

describe("monthGrid", () => {
  it("returns 42 days starting on a Sunday", () => {
    const grid = monthGrid(new Date(2024, 5, 15));
    expect(grid).toHaveLength(42);
    expect(grid[0].getDay()).toBe(0);
    expect(grid[41].getDay()).toBe(6);
  });

  it("June 2024: first cell is Sun May 26, contains the 1st of the month", () => {
    // June 1 2024 is a Saturday -> grid starts Sun May 26 2024
    const grid = monthGrid(new Date(2024, 5, 10));
    expect([grid[0].getFullYear(), grid[0].getMonth(), grid[0].getDate()]).toEqual([
      2024, 4, 26,
    ]);
    expect(grid.some((d) => d.getMonth() === 5 && d.getDate() === 1)).toBe(true);
  });

  it("is consecutive day-by-day with zeroed time", () => {
    const grid = monthGrid(new Date(2024, 1, 14)); // Feb 2024 (leap)
    for (const d of grid) expect(d.getHours()).toBe(0);
    for (let i = 1; i < grid.length; i++) {
      const diff = grid[i].getTime() - grid[i - 1].getTime();
      // one day in ms (allowing for any DST hour the run might use)
      expect(diff).toBeGreaterThanOrEqual(23 * 3600 * 1000);
      expect(diff).toBeLessThanOrEqual(25 * 3600 * 1000);
    }
  });

  it("month with the 1st on Sunday starts that month exactly", () => {
    // Sept 2024: Sept 1 is a Sunday
    const grid = monthGrid(new Date(2024, 8, 20));
    expect([grid[0].getMonth(), grid[0].getDate()]).toEqual([8, 1]);
  });
});

describe("weekDays", () => {
  it("default count 7 starts on the week's Sunday", () => {
    const days = weekDays(new Date(2024, 5, 15)); // Saturday
    expect(days).toHaveLength(7);
    expect(days[0].getDay()).toBe(0);
    expect([days[0].getMonth(), days[0].getDate()]).toEqual([5, 9]);
    expect([days[6].getMonth(), days[6].getDate()]).toEqual([5, 15]);
  });

  it("count 1 returns the given day (startOfDay), not the week start", () => {
    const days = weekDays(new Date(2024, 5, 15, 9, 0), 1);
    expect(days).toHaveLength(1);
    expect([days[0].getMonth(), days[0].getDate()]).toEqual([5, 15]);
    expect(days[0].getHours()).toBe(0);
  });

  it("arbitrary count starts at the week's Sunday", () => {
    const days = weekDays(new Date(2024, 5, 15), 3);
    expect(days).toHaveLength(3);
    expect([days[0].getMonth(), days[0].getDate()]).toEqual([5, 9]);
    expect([days[2].getMonth(), days[2].getDate()]).toEqual([5, 11]);
  });
});

describe("fmtTime", () => {
  const cases: [string, Date, string][] = [
    ["midnight -> 12 AM", new Date(2024, 5, 15, 0, 0), "12 AM"],
    ["noon -> 12 PM", new Date(2024, 5, 15, 12, 0), "12 PM"],
    ["morning on the hour", new Date(2024, 5, 15, 9, 0), "9 AM"],
    ["afternoon with minutes", new Date(2024, 5, 15, 13, 5), "1:05 PM"],
    ["11:59 PM", new Date(2024, 5, 15, 23, 59), "11:59 PM"],
    ["1:00 AM on the hour", new Date(2024, 5, 15, 1, 0), "1 AM"],
    ["minutes zero-padded", new Date(2024, 5, 15, 8, 7), "8:07 AM"],
  ];
  it.each(cases)("%s", (_label, d, expected) => {
    expect(fmtTime(d)).toBe(expected);
  });
});

describe("toLocalInput", () => {
  it("formats YYYY-MM-DDTHH:mm with zero-padding", () => {
    expect(toLocalInput(new Date(2024, 0, 5, 3, 7))).toBe("2024-01-05T03:07");
  });
  it("handles double-digit components", () => {
    expect(toLocalInput(new Date(2024, 10, 25, 14, 30))).toBe("2024-11-25T14:30");
  });
});

describe("toDateInput", () => {
  it("formats YYYY-MM-DD with zero-padding", () => {
    expect(toDateInput(new Date(2024, 0, 5, 23, 59))).toBe("2024-01-05");
  });
  it("handles December", () => {
    expect(toDateInput(new Date(2024, 11, 31))).toBe("2024-12-31");
  });
});

describe("fromLocalInput", () => {
  it("round-trips with toLocalInput", () => {
    const d = new Date(2024, 5, 15, 14, 30);
    const parsed = fromLocalInput(toLocalInput(d));
    expect([
      parsed.getFullYear(),
      parsed.getMonth(),
      parsed.getDate(),
      parsed.getHours(),
      parsed.getMinutes(),
    ]).toEqual([2024, 5, 15, 14, 30]);
  });

  it("parses a datetime-local string in local time", () => {
    const parsed = fromLocalInput("2024-03-09T08:15");
    expect([
      parsed.getFullYear(),
      parsed.getMonth(),
      parsed.getDate(),
      parsed.getHours(),
      parsed.getMinutes(),
    ]).toEqual([2024, 2, 9, 8, 15]);
  });
});
