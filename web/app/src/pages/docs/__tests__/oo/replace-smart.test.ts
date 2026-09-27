// Port of OnlyOffice's Api.ReplaceTextSmart tests (behaviour only):
// word/js-api/api/replace-text-smart.js. Replacing a paragraph's text keeps
// the formatting of the characters that survive, and new characters take
// the formatting of the text they replace.
import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/core";
import { makeEditor, paragraphText, reviewHtml, textblocks, selectRange, type ReviewType } from "../harness";
import { collectChanges, isFormatMark } from "../../changes";
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

  // OnlyOffice diffs character by character; Grown's smart replace aligns
  // words first (diffChunks), so a replaced word becomes one deletion plus
  // one insertion instead of interleaved letters. The review rules are the
  // same: text that is already deleted is left out of the comparison and
  // stays, the user's own pending insertions are removed outright, other
  // text is marked deleted, new text is an insertion (after the text it
  // replaces) with that text's formatting, and another user's insertion is
  // kept under a deletion.
  it("oo:word/js-api/api/replace-text-smart.js#Replace text with revisions", () => {
    const runs1: Run[] = [
      { text: "full text added in review ", type: "add", tag: "em" },
      { text: "removed in review ", type: "remove", tag: "strong" },
      { text: "common text", tag: "em" },
    ];

    // Without tracking: new characters are plain, deleted text stays.
    let e = fillReview(runs1, false);
    replaceTextSmart(e, ["text added in review and another interted text"]);
    expect(reviewInfo(e)).toEqual([
      ["text added in review ", ["italic"], "add"],
      ["removed in review ", ["bold"], "remove"],
      ["and another interted text", ["italic"], "common"],
    ]);

    // With tracking.
    e = fillReview(runs1, true);
    replaceTextSmart(e, ["text added in review and another inserted text"]);
    expect(reviewInfo(e)).toEqual([
      ["text added in review ", ["italic"], "add"],
      ["removed in review ", ["bold"], "remove"],
      ["common", ["italic"], "remove"],
      ["and another inserted", ["italic"], "add"],
      [" text", ["italic"], "common"],
    ]);
    // One logical change: the replaced word and its replacement.
    expect(collectChanges(e.state.doc).map((c) => c.kind)).toEqual(["insert", "delete", "replace"]);

    // Another user replaces text around the first user's changes.
    e = fillReview(
      [
        { text: "text removed by first user and ", type: "remove", tag: "strong" },
        { text: "common text and ", tag: "em" },
        { text: "text added by first user", type: "add", tag: "strong" },
      ],
      true,
      "Second user",
    );
    replaceTextSmart(e, ["edited common text"]);
    expect(reviewInfo(e)).toEqual([
      ["text removed by first user and ", ["bold"], "remove"],
      ["edited ", ["italic"], "add"],
      ["common text", ["italic"], "common"],
      [" and ", ["italic"], "remove"],
      ["text added by first user", ["bold"], "remove"],
    ]);
    // The first user's insertion is kept under the second user's deletion.
    e.commands.rejectAllSuggestions();
    expect(paragraphText(e)).toBe("text removed by first user and common text and ");
  });
});

type Run = { text: string; type?: ReviewType; tag?: "strong" | "em" };

/** Paragraph from review runs (default author "Test user"), fully selected. */
function fillReview(runs: Run[], track: boolean, userName?: string): Editor {
  const e = makeEditor(`<p>${reviewHtml(runs)}</p>`, { suggesting: track, userName });
  const b = textblocks(e)[0];
  selectRange(e, b.pos, b.pos + b.node.content.size);
  return e;
}

/** Runs of textblock 0 as [text, formatting mark names, review type]. */
function reviewInfo(e: Editor): [string, string[], ReviewType][] {
  const b = textblocks(e)[0];
  const out: [string, string[], ReviewType][] = [];
  for (const r of runsOf(b.node, b.pos)) {
    const names = r.marks.map((m) => m.type.name);
    const type: ReviewType = names.includes("deletion") ? "remove" : names.includes("insertion") ? "add" : "common";
    const fmt = names.filter((n) => isFormatMark(n)).sort();
    const text = e.state.doc.textBetween(r.from, r.to);
    const last = out[out.length - 1];
    if (last && last[2] === type && last[1].join() === fmt.join()) last[0] += text;
    else out.push([text, fmt, type]);
  }
  return out;
}
