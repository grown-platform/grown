// Port of OnlyOffice's Api.ReplaceTextSmart tests (behaviour only):
// word/js-api/api/replace-text-smart.js. Replacing a paragraph's text keeps
// the formatting of the characters that survive, and new characters take
// the formatting of the text they replace.
import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { makeEditor, textblocks, selectRange } from "../harness";
import { runsOf } from "../../textOps";
import { replaceTextSmart } from "../../search";

type RunInfo = [string, string[]];

/** Runs of textblock 0 as [text, sorted mark names]. */
function runsInfo(e: Editor): RunInfo[] {
  const b = textblocks(e)[0];
  return runsOf(b.node, b.pos).map((r) => [
    e.state.doc.textBetween(r.from, r.to),
    r.marks.map((m) => m.type.name).sort(),
  ]);
}

/** Paragraph built from runs; pr "b" bold, "i" italic. */
function fill(runs: [string, ("b" | "i")?][]): Editor {
  const html = runs
    .map(([t, pr]) => (pr === "b" ? `<strong>${t}</strong>` : pr === "i" ? `<em>${t}</em>` : t))
    .join("");
  const e = makeEditor(`<p>${html}</p>`);
  const b = textblocks(e)[0];
  selectRange(e, b.pos, b.pos + b.node.content.size);
  return e;
}

describe("OnlyOffice ReplaceTextSmart", () => {
  it("oo:word/js-api/api/replace-text-smart.js#Replace text without revisions", () => {
    let e = fill([["E", "i"], ["x"], ["a", "b"], ["m"], ["p", "i"], ["l", "b"], ["e"], [" Test"]]);
    replaceTextSmart(e, ["Sample Test"]);
    expect(runsInfo(e)).toEqual([
      ["S", ["italic"]],
      ["a", ["bold"]],
      ["m", []],
      ["p", ["italic"]],
      ["l", ["bold"]],
      ["e Test", []],
    ]);

    e = fill([["Start "], ["Bold", "b"], [" and "], ["Italic", "i"], [" End"]]);
    replaceTextSmart(e, ["Start Strong and Soft End"]);
    expect(runsInfo(e)).toEqual([
      ["Start ", []],
      ["Strong", ["bold"]],
      [" and ", []],
      ["Soft", ["italic"]],
      [" End", []],
    ]);

    e = fill([["User: "], ["admin123", "i"], [" logged in"]]);
    replaceTextSmart(e, ["User: guest logged in"]);
    expect(runsInfo(e)).toEqual([
      ["User: ", []],
      ["guest", ["italic"]],
      [" logged in", []],
    ]);

    e = fill([["Your code is "], ["WRONG", "b"], ["!"]]);
    replaceTextSmart(e, ["Your code is RIGHT!"]);
    expect(runsInfo(e)).toEqual([
      ["Your code is ", []],
      ["RIGHT", ["bold"]],
      ["!", []],
    ]);
  });

  // Grown has Suggesting mode but its smart replace under tracking would
  // need per-run review types and change ids (M5 track changes v2).
  it.skip("oo:word/js-api/api/replace-text-smart.js#Replace text with revisions", () => {
    // TODO(M5): replaced characters become deletions and new characters
    // insertions, keeping formatting and review type per run.
  });
});
