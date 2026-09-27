// Document diff engine (Docs M12): compare, combine, version diff.
import { describe, expect, it } from "vitest";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { makeEditor } from "./harness";
import { cleanup, myers } from "../diff/myers";
import { acceptAll, combineDocs, compareDocs, diffSummary, diffVersions, htmlToDoc } from "../diff";
import { collectChanges, collectParts, resolveParts, reviewRuns, paragraphReviewType } from "../changes";

let cached: Schema | null = null;
function schema(): Schema {
  // One schema for every fixture: documents from two schemas don't mix.
  cached ??= makeEditor("<p></p>").schema;
  return cached;
}
const doc = (html: string) => htmlToDoc(schema(), html);

let n = 0;
const newId = () => `c${++n}`;

function runs(d: PMNode): [string, string][][] {
  const out: [string, string][][] = [];
  d.descendants((b) => {
    if (b.isTextblock) {
      out.push(reviewRuns(b));
      return false;
    }
    return true;
  });
  return out;
}

function resolveAll(d: PMNode, accept: boolean): PMNode {
  const tr = EditorState.create({ doc: d }).tr;
  resolveParts(tr, collectParts(d), accept);
  return tr.doc;
}

const texts = (d: PMNode) => {
  const out: string[] = [];
  d.descendants((b) => {
    if (b.isTextblock) {
      out.push(b.textContent);
      return false;
    }
    return true;
  });
  return out;
};

describe("myers", () => {
  const s = (x: string) => Array.from(x);
  const show = (a: string, b: string, clean = false) => {
    let ops = myers(s(a), s(b))!;
    if (clean) ops = cleanup(ops, s(a), s(b), { semantic: false });
    let out = "";
    let last = "";
    for (const op of ops) {
      const ch = op.kind === "ins" ? b[op.b] : a[op.a];
      const tag = op.kind === "eq" ? "" : op.kind === "del" ? "-" : "+";
      if (tag !== last) {
        if (last) out += "]";
        if (tag) out += `[${tag}`;
      }
      out += ch;
      last = tag;
    }
    if (last) out += "]";
    return out;
  };
  it("finds a shortest edit script", () => {
    const ops = myers(s("abcabba"), s("cbabac"))!;
    expect(ops.filter((o) => o.kind !== "eq")).toHaveLength(5);
    expect(ops.filter((o) => o.kind !== "ins").map((o) => o.a)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(ops.filter((o) => o.kind !== "del").map((o) => o.b)).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it("slides split edits together", () => {
    const a = s("Hello World");
    const b = s("Hlo Wld");
    const ops = cleanup(myers(a, b)!, a, b, { semantic: false });
    const dels = ops.filter((o) => o.kind === "del").map((o) => a[o.a]).join("");
    expect(dels).toBe("elor");
    // two contiguous runs
    const runsOf = ops.map((o) => o.kind).join(",").split("eq").filter((x) => x.replace(/,/g, "")).length;
    expect(runsOf).toBe(2);
    expect(show("Hello hello", "Hello lo", true)).toBe("Hello [-hel]lo");
  });
  it("gives up past maxD", () => {
    expect(myers(s("aaaa"), s("bbbb"), 2)).toBeNull();
  });
});

describe("compareDocs", () => {
  it("marks inserted and deleted words by the revised author", () => {
    const r = compareDocs(doc("<p>The quick brown fox</p>"), doc("<p>The slow brown fox jumps</p>"), { author: "Ann", date: "2026-01-02T03:04:05Z", newId });
    expect(runs(r)).toEqual([[["common", "The "], ["remove", "quick"], ["add", "slow"], ["common", " brown fox"], ["add", " jumps"]]]);
    const changes = collectChanges(r);
    expect(changes.map((c) => [c.kind, c.author, c.date])).toEqual([
      ["replace", "Ann", "2026-01-02T03:04:05Z"],
      ["insert", "Ann", "2026-01-02T03:04:05Z"],
    ]);
    expect(texts(resolveAll(r, false))).toEqual(["The quick brown fox"]);
    expect(texts(resolveAll(r, true))).toEqual(["The slow brown fox jumps"]);
  });

  it("aligns paragraphs first and tracks added and removed paragraphs", () => {
    const oldD = doc("<p>One</p><p>Two</p><p>Three</p>");
    const newD = doc("<p>One</p><p>Three</p><p>Four</p>");
    const r = compareDocs(oldD, newD, { author: "Bo" });
    expect(texts(r)).toEqual(["One", "Two", "Three", "Four"]);
    expect(runs(r)[1]).toEqual([["remove", "Two"]]);
    expect(runs(r)[3]).toEqual([["add", "Four"]]);
    expect(texts(resolveAll(r, true))).toEqual(["One", "Three", "Four"]);
    expect(texts(resolveAll(r, false))).toEqual(["One", "Two", "Three"]);
  });

  it("tracks a paragraph split and a merge as paragraph-mark changes", () => {
    const r = compareDocs(doc("<p>Alpha beta gamma</p><p>Delta</p><p>Eps</p>"), doc("<p>Alpha beta</p><p>gamma</p><p>Delta Eps</p>"), { author: "Cy" });
    const types: string[] = [];
    r.forEach((p) => types.push(paragraphReviewType(p)));
    expect(texts(resolveAll(r, true))).toEqual(["Alpha beta", "gamma", "Delta Eps"]);
    expect(texts(resolveAll(r, false))).toEqual(["Alpha beta gamma", "Delta", "Eps"]);
    expect(types).toContain("add");
    expect(types).toContain("remove");
  });

  it("records formatting changes with the old formatting", () => {
    const r = compareDocs(doc("<p>make this bold</p>"), doc("<p>make <strong>this</strong> bold</p>"), { author: "Di" });
    const c = collectChanges(r);
    expect(c).toHaveLength(1);
    expect(c[0].kind).toBe("format");
    expect(c[0].formatted).toBe("this");
    expect(texts(resolveAll(r, false))).toEqual(["make this bold"]);
    let bold = false;
    resolveAll(r, false).descendants((n) => {
      if (n.marks.some((m) => m.type.name === "bold")) bold = true;
    });
    expect(bold).toBe(false);
  });

  it("records paragraph property changes", () => {
    const r = compareDocs(doc("<p>Title</p><p>x</p>"), doc("<h1>Title</h1><p>x</p>"), { author: "Ed" });
    const c = collectChanges(r);
    expect(c.map((x) => x.kind)).toEqual(["paragraph"]);
    expect(resolveAll(r, false).firstChild!.type.name).toBe("paragraph");
    expect(resolveAll(r, true).firstChild!.type.name).toBe("heading");
  });

  it("keeps list structure and tracks a removed list item inside the list", () => {
    const r = compareDocs(doc("<ul><li><p>a</p></li><li><p>b</p></li><li><p>c</p></li></ul>"), doc("<ul><li><p>a</p></li><li><p>c</p></li></ul>"), { author: "Fi" });
    expect(r.childCount).toBe(1);
    expect(r.firstChild!.type.name).toBe("bulletList");
    expect(r.firstChild!.childCount).toBe(3);
    expect(runs(r)[1]).toEqual([["remove", "b"]]);
  });

  it("compares table cells", () => {
    const t = (x: string) => `<table><tbody><tr><td><p>k</p></td><td><p>${x}</p></td></tr></tbody></table>`;
    const r = compareDocs(doc(t("old value")), doc(t("new value")), { author: "Gu" });
    expect(r.firstChild!.type.name).toBe("table");
    expect(runs(r)[1]).toEqual([["remove", "old"], ["add", "new"], ["common", " value"]]);
  });

  it("accepts existing tracked changes before comparing", () => {
    const oldD = doc('<p>a <span data-suggestion="insert" data-author="X">b </span>c</p>');
    const r = compareDocs(oldD, doc("<p>a b c</p>"), { author: "Hy" });
    expect(collectChanges(r)).toHaveLength(0);
    expect(acceptAll(oldD).textContent).toBe("a b c");
  });

  it("identical documents have no changes", () => {
    const html = "<h2>Head</h2><p>Some <em>text</em></p><ul><li><p>x</p></li></ul>";
    expect(diffSummary(compareDocs(doc(html), doc(html), { author: "Z" }))).toEqual({ insertions: 0, deletions: 0, formatting: 0 });
  });

  it("rewrites become one replacement, not a comb of matches", () => {
    const r = compareDocs(doc("<p>We will meet on Monday at noon.</p>"), doc("<p>Lunch is cancelled this week.</p>"), { author: "Q" });
    expect(collectChanges(r)).toHaveLength(1);
  });
});

describe("combineDocs", () => {
  it("merges two revisions under their authors", () => {
    const orig = doc("<p>The cat sat on the mat.</p>");
    const a = doc("<p>The black cat sat on the mat.</p>");
    const b = doc("<p>The cat sat on the red mat.</p>");
    const r = combineDocs(orig, a, b, { authorA: "Ann", authorB: "Ben", dateA: "2026-01-01T00:00:00Z", dateB: "2026-01-02T00:00:00Z" });
    expect(runs(r)).toEqual([[["common", "The "], ["add", "black "], ["common", "cat sat on the "], ["add", "red "], ["common", "mat."]]]);
    const cs = collectChanges(r);
    expect(cs.map((c) => [c.inserted, c.author])).toEqual([
      ["black ", "Ann"],
      ["red ", "Ben"],
    ]);
    expect(resolveAll(r, true).textContent).toBe("The black cat sat on the red mat.");
    expect(resolveAll(r, false).textContent).toBe("The cat sat on the mat.");
  });

  it("the same insertion in both copies appears once", () => {
    const r = combineDocs(doc("<p>a c</p>"), doc("<p>a b c</p>"), doc("<p>a b c</p>"), { authorA: "A", authorB: "B" });
    expect(resolveAll(r, true).textContent).toBe("a b c");
  });

  it("keeps revisions a copy already carries", () => {
    const a = doc('<p>Hello <span data-suggestion="insert" data-author="John" data-date="2020-01-01T00:00:00Z">big </span>world</p>');
    const r = combineDocs(doc("<p>Hello world</p>"), a, null, { authorA: "Val" });
    expect(collectChanges(r).map((c) => [c.inserted, c.author])).toEqual([["big ", "John"]]);
  });
});

describe("diffVersions", () => {
  it("character-level deleted text only", () => {
    const r = diffVersions(doc("<p>abc</p>"), doc("<p>ab</p>"), { author: "V", show: "deleted" });
    expect(runs(r)).toEqual([[["common", "ab"], ["remove", "c"]]]);
  });
  it("highlights insertions too", () => {
    const r = diffVersions(doc("<p>abc</p>"), doc("<p>abXc</p>"), { author: "V" });
    expect(runs(r)).toEqual([[["common", "ab"], ["add", "X"], ["common", "c"]]]);
  });
});
