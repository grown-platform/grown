// Port of OnlyOffice's merge-documents tests (behaviour only):
// word/merge-documents/mergeDocuments.js. OnlyOffice's "combine" merges a
// revised copy into the original: text the copy has and the original
// lacks becomes an insertion, text it lacks a deletion, both by the
// combining user (here "Reviser"), and revisions the copy already carries
// (another author's insertions) are kept with their own author and date.
// The upstream fixtures are binary documents and Cyrillic / CJK strings;
// these are Grown-authored fixtures expressing the same cases.
//
// Semantic differences (grown-variant, see docs.md §6.14): a replaced word
// shows its deletion before its insertion (Word's order; OnlyOffice puts the
// insertion first), and formatting differences become tracked formatting
// changes (OnlyOffice's combine applies the copy's formatting untracked).
// Bookmark and comment merging cases need anchors in the result and are
// covered by Grown's comment model separately; they are not re-expressed.
import { describe, expect, it } from "vitest";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { makeEditor } from "../harness";
import { combineDocs, htmlToDoc } from "../../diff";
import { collectParts, resolveParts } from "../../changes";

let cached: Schema | null = null;
const schema = () => (cached ??= makeEditor("<p></p>").schema);

type Run = string | { text: string; add?: string; del?: string; b?: boolean; i?: boolean; sup?: boolean };

const JOHN = "John Smith";
const DATE = "2020-01-01T00:00:00Z";

function para(runs: Run[]): string {
  return `<p>${runs
    .map((r) => {
      if (typeof r === "string") return r;
      let h = r.text;
      if (r.b) h = `<strong>${h}</strong>`;
      if (r.i) h = `<em>${h}</em>`;
      if (r.sup) h = `<sup>${h}</sup>`;
      if (r.add) h = `<span data-suggestion="insert" data-author="${r.add}" data-date="${DATE}">${h}</span>`;
      if (r.del) h = `<span data-suggestion="delete" data-author="${r.del}" data-date="${DATE}">${h}</span>`;
      return h;
    })
    .join("")}</p>`;
}
const doc = (...paras: Run[][]) => htmlToDoc(schema(), paras.map(para).join(""));

/** [review type, text, author] runs of the first paragraph. */
function authored(d: PMNode): [string, string, string][] {
  const out: [string, string, string][] = [];
  d.firstChild!.forEach((n) => {
    const del = n.marks.find((m) => m.type.name === "deletion");
    const ins = n.marks.find((m) => m.type.name === "insertion");
    const t = del ? "remove" : ins ? "add" : "common";
    const who = String((del ?? ins)?.attrs.author ?? "");
    const last = out[out.length - 1];
    if (last && last[0] === t && last[2] === who) last[1] += n.text ?? "";
    else out.push([t, n.text ?? "", who]);
  });
  return out;
}

function resolved(d: PMNode, accept: boolean): string {
  const tr = EditorState.create({ doc: d }).tr;
  resolveParts(tr, collectParts(d), accept);
  return tr.doc.textContent;
}

interface Case {
  name: string;
  original: Run[];
  revised: Run[];
  expected: [string, string, string][];
}

function check(c: Case, granularity: "word" | "char") {
  const orig = doc(c.original);
  const rev = doc(c.revised);
  const r = combineDocs(orig, rev, null, { authorA: "Reviser", dateA: "2026-03-01T00:00:00Z", granularity });
  r.check();
  expect(authored(r), c.name).toEqual(c.expected);
  // Rejecting the combining user's changes gives the original's text back;
  // accepting everything gives the copy's (existing revisions included).
  const accepted = htmlToDoc(schema(), para(c.revised));
  expect(resolved(r, true), c.name).toBe(resolved(accepted, true));
}

const R = "Reviser";

const wordCases: Case[] = [
  { name: "an empty document and a non-reviewed paragraph", original: [""], revised: ["Hello"], expected: [["add", "Hello", R]] },
  { name: "empty documents", original: [""], revised: [""], expected: [] },
  {
    name: "different paragraphs without review",
    original: ["Hello"],
    revised: ["Helloooo"],
    expected: [
      ["remove", "Hello", R],
      ["add", "Helloooo", R],
    ],
  },
  { name: "same content, different review", original: ["Hello"], revised: [{ text: "Hello", add: JOHN }], expected: [["add", "Hello", JOHN]] },
  {
    name: "different paragraphs, the second with review",
    original: ["Hello"],
    revised: [{ text: "Helloooo", add: JOHN }],
    expected: [
      ["remove", "Hello", R],
      ["add", "Helloooo", JOHN],
    ],
  },
  {
    name: "same content where part of a word has a review",
    original: ["Hello, how are you?"],
    revised: [{ text: "Hel", add: JOHN }, "lo, how are you?"],
    expected: [
      ["add", "Hel", JOHN],
      ["common", "lo, how are you?", ""],
    ],
  },
  {
    name: "identical documents, a word in the middle has another review",
    original: ["Hello Hello Hello"],
    revised: ["Hello", { text: " Hello", add: JOHN }, " Hello"],
    expected: [
      ["common", "Hello", ""],
      ["add", " Hello", JOHN],
      ["common", " Hello", ""],
    ],
  },
  {
    name: "merging to the start",
    original: ["how are you?"],
    revised: [{ text: "Hi, ", add: JOHN }, "how are you?"],
    expected: [
      ["add", "Hi, ", JOHN],
      ["common", "how are you?", ""],
    ],
  },
  {
    name: "different origins",
    original: ["Hello, how are you?"],
    revised: [{ text: "Hiya, ", add: JOHN }, "how are you?"],
    expected: [
      ["remove", "Hello", R],
      ["add", "Hiya, ", JOHN],
      ["common", "how are you?", ""],
    ],
  },
  {
    name: "differences in text with different reviews",
    original: ["Hi, how are you? Fine, and you?"],
    revised: ["Hi, how are you?", { text: " Good, and you?", add: JOHN }],
    expected: [
      ["common", "Hi, how are you?", ""],
      ["add", " ", JOHN],
      ["remove", "Fine", R],
      ["add", "Good, and you?", JOHN],
    ],
  },
  {
    name: "identical documents with reviews on letters",
    original: [{ text: "He", del: JOHN }, "llo there"],
    revised: [{ text: "He", del: JOHN }, "llo ", { text: "t", add: JOHN }, "here"],
    expected: [
      ["remove", "He", JOHN],
      ["common", "llo ", ""],
      ["add", "t", JOHN],
      ["common", "here", ""],
    ],
  },
];

const symbolCases: Case[] = [
  {
    name: "a CJK run where the copy ends differently",
    original: ["培养更培养更培养更xyz"],
    revised: ["培养更培养更培养更", { text: "培养更", add: "Mark" }],
    expected: [
      ["common", "培养更培养更培养更", ""],
      ["remove", "xyz", R],
      ["add", "培养更", "Mark"],
    ],
  },
  {
    name: "digits with two characters inserted in the middle of a word",
    original: ["4214 21423431432 2411"],
    revised: ["4214 2142343121432 2411"],
    expected: [
      ["common", "4214 21423431", ""],
      ["add", "21", R],
      ["common", "432 2411", ""],
    ],
  },
  {
    name: "letters added at the end of a word",
    original: ["Hello hello hello"],
    revised: ["Hello hello hellok k"],
    expected: [
      ["common", "Hello hello hello", ""],
      ["add", "k k", R],
    ],
  },
  {
    name: "an existing insertion with formatting in the copy",
    original: ["Hi hi "],
    revised: [{ text: "Hi hi p", add: "Mark" }, { text: "ri", add: "Mark", b: true }, { text: "vet", add: "Mark", i: true }],
    expected: [["add", "Hi hi privet", "Mark"]],
  },
];

describe("OnlyOffice merge documents (combine)", () => {
  it("oo:word/merge-documents/mergeDocuments.js#Test word document combine", () => {
    for (const c of wordCases) check(c, "word");
  });

  it("oo:word/merge-documents/mergeDocuments.js#Test symbol document combine", () => {
    for (const c of symbolCases) check(c, "char");
    // Formatting-only differences are tracked formatting changes (grown-variant).
    const r = combineDocs(doc(["Qwer", { text: "tyui", sup: true }]), doc(["Qwer", { text: "tyui", sup: true, b: true }]), null, {
      authorA: R,
      granularity: "char",
    });
    const parts = collectParts(r);
    expect(parts.map((p) => [p.kind, p.text, p.author])).toEqual([["fmt", "tyui", R]]);
  });
});
