import { describe, it, expect } from "vitest";
import {
  buildPreset,
  buildCustom,
  classify,
  parseCustom,
  describe as describeRule,
  DAY_CODES,
  type RecurrenceKind,
  type CustomFreq,
} from "./recurrence";

// Fixed anchor dates with known weekdays (local time):
//   2024-01-01 is a Monday  → getDay() === 1 → "MO"
//   2024-01-03 is a Wednesday → getDay() === 3 → "WE"
const MON = new Date(2024, 0, 1);
const WED = new Date(2024, 0, 3);

describe("DAY_CODES", () => {
  it("is the iCal weekday code list starting at Sunday", () => {
    expect(DAY_CODES).toEqual(["SU", "MO", "TU", "WE", "TH", "FR", "SA"]);
  });
});

describe("buildPreset", () => {
  const cases: [RecurrenceKind, Date, string][] = [
    ["none", MON, ""],
    ["daily", MON, "FREQ=DAILY"],
    ["weekly", MON, "FREQ=WEEKLY;BYDAY=MO"],
    ["weekly", WED, "FREQ=WEEKLY;BYDAY=WE"],
    ["monthly", MON, "FREQ=MONTHLY"],
    ["yearly", MON, "FREQ=YEARLY"],
    ["weekday", MON, "FREQ=WEEKDAY"],
    ["custom", MON, ""], // default branch
  ];
  it.each(cases)("preset %s → %s", (kind, start, expected) => {
    expect(buildPreset(kind, start)).toBe(expected);
  });
});

describe("buildCustom", () => {
  const cases: [string, CustomFreq, number, string[], string][] = [
    ["daily, interval 1 omits INTERVAL", "DAILY", 1, [], "FREQ=DAILY"],
    ["daily, interval 3", "DAILY", 3, [], "FREQ=DAILY;INTERVAL=3"],
    [
      "weekly with BYDAY",
      "WEEKLY",
      1,
      ["MO", "WE", "FR"],
      "FREQ=WEEKLY;BYDAY=MO,WE,FR",
    ],
    [
      "weekly interval 2 with BYDAY (order INTERVAL then BYDAY)",
      "WEEKLY",
      2,
      ["TU"],
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU",
    ],
    ["weekly with empty BYDAY drops BYDAY", "WEEKLY", 1, [], "FREQ=WEEKLY"],
    [
      "BYDAY ignored for non-weekly freq",
      "MONTHLY",
      1,
      ["MO"],
      "FREQ=MONTHLY",
    ],
    ["yearly interval 5", "YEARLY", 5, [], "FREQ=YEARLY;INTERVAL=5"],
  ];
  it.each(cases)("%s", (_label, freq, interval, byDay, expected) => {
    expect(buildCustom(freq, interval, byDay)).toBe(expected);
  });
});

describe("classify", () => {
  const cases: [string, string, Date, RecurrenceKind][] = [
    ["empty string → none", "", MON, "none"],
    ["whitespace → none", "   ", MON, "none"],
    ["rule with no FREQ → none", "INTERVAL=2", MON, "none"],
    ["FREQ=DAILY → daily", "FREQ=DAILY", MON, "daily"],
    ["FREQ=WEEKDAY → weekday", "FREQ=WEEKDAY", MON, "weekday"],
    ["FREQ=MONTHLY → monthly", "FREQ=MONTHLY", MON, "monthly"],
    ["FREQ=YEARLY → yearly", "FREQ=YEARLY", MON, "yearly"],
    ["interval > 1 → custom", "FREQ=DAILY;INTERVAL=2", MON, "custom"],
    ["weekly no BYDAY → weekly", "FREQ=WEEKLY", MON, "weekly"],
    [
      "weekly single BYDAY matching start day → weekly",
      "FREQ=WEEKLY;BYDAY=MO",
      MON,
      "weekly",
    ],
    [
      "weekly single BYDAY NOT matching start day → custom",
      "FREQ=WEEKLY;BYDAY=MO",
      WED,
      "custom",
    ],
    [
      "weekly multi BYDAY → custom",
      "FREQ=WEEKLY;BYDAY=MO,WE",
      MON,
      "custom",
    ],
    ["RRULE: prefix is stripped", "RRULE:FREQ=DAILY", MON, "daily"],
    ["lowercase + spacing normalized", " freq=daily ", MON, "daily"],
    ["unknown FREQ → custom", "FREQ=HOURLY", MON, "custom"],
  ];
  it.each(cases)("%s", (_label, rule, start, expected) => {
    expect(classify(rule, start)).toBe(expected);
  });
});

describe("parseCustom", () => {
  it("returns sensible defaults for empty input", () => {
    expect(parseCustom("")).toEqual({
      freq: "WEEKLY",
      interval: 1,
      byDay: [],
    });
  });

  it("maps WEEKDAY freq to DAILY", () => {
    expect(parseCustom("FREQ=WEEKDAY")).toEqual({
      freq: "DAILY",
      interval: 1,
      byDay: [],
    });
  });

  it("falls back to WEEKLY for unrecognized freq", () => {
    expect(parseCustom("FREQ=HOURLY")).toEqual({
      freq: "WEEKLY",
      interval: 1,
      byDay: [],
    });
  });

  it("extracts freq, interval and byDay", () => {
    expect(parseCustom("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE")).toEqual({
      freq: "WEEKLY",
      interval: 2,
      byDay: ["MO", "WE"],
    });
  });

  it("invalid INTERVAL falls back to 1", () => {
    expect(parseCustom("FREQ=DAILY;INTERVAL=abc").interval).toBe(1);
  });

  it("round-trips with buildCustom", () => {
    const rule = buildCustom("WEEKLY", 3, ["TU", "TH"]);
    expect(parseCustom(rule)).toEqual({
      freq: "WEEKLY",
      interval: 3,
      byDay: ["TU", "TH"],
    });
  });
});

describe("describe", () => {
  const cases: [string, string, Date, string][] = [
    ["empty → does not repeat", "", MON, "Does not repeat"],
    ["no FREQ → does not repeat", "INTERVAL=2", MON, "Does not repeat"],
    ["daily", "FREQ=DAILY", MON, "Daily"],
    ["every N days", "FREQ=DAILY;INTERVAL=3", MON, "Every 3 days"],
    ["weekday", "FREQ=WEEKDAY", MON, "Every weekday (Mon–Fri)"],
    [
      "weekly uses start day when no BYDAY",
      "FREQ=WEEKLY",
      MON,
      "Every week on Mon",
    ],
    [
      "weekly with BYDAY list",
      "FREQ=WEEKLY;BYDAY=MO,WE,FR",
      MON,
      "Every week on Mon, Wed, Fri",
    ],
    [
      "weekly with interval",
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU",
      WED,
      "Every 2 week on Tue",
    ],
    ["monthly", "FREQ=MONTHLY", MON, "Monthly"],
    ["every N months", "FREQ=MONTHLY;INTERVAL=4", MON, "Every 4 months"],
    ["yearly", "FREQ=YEARLY", MON, "Annually"],
    ["every N years", "FREQ=YEARLY;INTERVAL=2", MON, "Every 2 years"],
    ["unknown freq echoes the rule", "FREQ=HOURLY", MON, "FREQ=HOURLY"],
  ];
  it.each(cases)("%s", (_label, rule, start, expected) => {
    expect(describeRule(rule, start)).toBe(expected);
  });
});
