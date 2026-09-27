// Port of OnlyOffice's change-case test (behaviour only, clean-room):
//   cell/spreadsheet-calculation/CellSettingsTests.js — "changeTextCase"
// against ../textCase.ts. The cell holds rich text split into runs that cut
// through words; the conversion must see whole words and sentences.

import { describe, expect, it } from "vitest";
import { changeRunsCase, type TextCase } from "../textCase";

const runs = (parts: string[]) => parts.map((v) => ({ v, fs: 10 }));
const joined = (parts: string[], mode: TextCase) =>
  changeRunsCase(runs(parts), mode)
    .map((r) => r.v)
    .join("");

describe("sheets parity: change case", () => {
  it('oo:cell/spreadsheet-calculation/CellSettingsTests.js#changeTextCase', () => {
    const one = ["te", "st TES", "T", " t", "Es", "t  Te", "st\nt", "Est te", "s", "t   Tee", "est ", "tesT", "\n", "TEST te", "st Test"];
    expect(one.join("")).toBe("test TEST tEst  Test\ntEst test   Teeest tesT\nTEST test Test");
    expect(joined(one, "lower")).toBe("test test test  test\ntest test   teeest test\ntest test test");
    expect(joined(one, "upper")).toBe("TEST TEST TEST  TEST\nTEST TEST   TEEEST TEST\nTEST TEST TEST");
    expect(joined(one, "toggle")).toBe("TEST test TeST  tEST\nTeST TEST   tEEEST TESt\ntest TEST tEST");
    expect(joined(one, "capitalize")).toBe("Test TEST Test  Test\nTest Test   Teeest Test\nTEST Test Test");
    expect(joined(one, "sentence")).toBe("Test TEST test  Test\nTest test   Teeest test\nTEST test Test");

    const two = ["te", "st TE", "ST tEst  T", "est\ntE", "st. test   TeE", "Est. te", "ST\nTEST te", "st Test teEEst\ntes", "t.test\ntest,test", ";test,tEst\\tes", "t\nteSt T", "est Test TESt TES", "T tesT"];
    expect(two.join("")).toBe(
      "test TEST tEst  Test\ntEst. test   TeEEst. teST\nTEST test Test teEEst\ntest.test\ntest,test;test,tEst\\test\nteSt Test Test TESt TEST tesT",
    );
    expect(joined(two, "lower")).toBe(
      "test test test  test\ntest. test   teeest. test\ntest test test teeest\ntest.test\ntest,test;test,test\\test\ntest test test test test test",
    );
    expect(joined(two, "upper")).toBe(
      "TEST TEST TEST  TEST\nTEST. TEST   TEEEST. TEST\nTEST TEST TEST TEEEST\nTEST.TEST\nTEST,TEST;TEST,TEST\\TEST\nTEST TEST TEST TEST TEST TEST",
    );
    expect(joined(two, "toggle")).toBe(
      "TEST test TeST  tEST\nTeST. TEST   tEeeST. TEst\ntest TEST tEST TEeeST\nTEST.TEST\nTEST,TEST;TEST,TeST\\TEST\nTEsT tEST tEST tesT test TESt",
    );
    expect(joined(two, "capitalize")).toBe(
      "Test TEST Test  Test\nTest. Test   Teeest. Test\nTEST Test Test Teeest\nTest.Test\nTest,Test;Test,Test\\Test\nTest Test Test Test TEST Test",
    );
    expect(joined(two, "sentence")).toBe(
      "Test TEST test  Test\nTest. Test   teeest. Test\nTEST test Test teeest\nTest.Test\nTest,test;test,test\\test\nTest Test Test test TEST test",
    );
    // Runs keep their formatting and length.
    const out = changeRunsCase(runs(one), "upper");
    expect(out.map((r) => r.v.length)).toEqual(one.map((p) => p.length));
    expect(out.every((r) => r.fs === 10)).toBe(true);
  });
});
