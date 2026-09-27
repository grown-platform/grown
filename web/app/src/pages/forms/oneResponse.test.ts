import { describe, it, expect } from "vitest";
import { fillGate, isAlreadyRespondedError, limitsOneResponse } from "./oneResponse";
import { ApiError } from "./api";
import type { FormSettings } from "./types";

const settings = (limit: boolean): { settings: FormSettings } => ({
  settings: {
    collect_email: false,
    limit_one_response: limit,
    show_progress_bar: false,
    shuffle_questions: false,
    confirmation_message: "",
    is_quiz: false,
  },
});

describe("limitsOneResponse", () => {
  it("reads the setting", () => {
    expect(limitsOneResponse(settings(true))).toBe(true);
    expect(limitsOneResponse(settings(false))).toBe(false);
    expect(limitsOneResponse(null)).toBe(false);
  });
});

describe("fillGate", () => {
  it("shows already-responded for a limited form the user answered", () => {
    expect(fillGate(settings(true), { responded: true })).toBe(
      "already_responded",
    );
  });
  it("shows the form when the user hasn't responded", () => {
    expect(fillGate(settings(true), { responded: false })).toBe("form");
  });
  it("shows the form while the status is unknown", () => {
    expect(fillGate(settings(true), null)).toBe("form");
  });
  it("ignores past responses when the form isn't limited", () => {
    expect(fillGate(settings(false), { responded: true })).toBe("form");
  });
});

describe("isAlreadyRespondedError", () => {
  it("matches a 409 ApiError", () => {
    expect(isAlreadyRespondedError(new ApiError("dup", 409))).toBe(true);
  });
  it("rejects other failures", () => {
    expect(isAlreadyRespondedError(new ApiError("bad", 400))).toBe(false);
    expect(isAlreadyRespondedError(new Error("boom"))).toBe(false);
    expect(isAlreadyRespondedError(null)).toBe(false);
  });
});
