import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { deckToPptx } from "./write";
import { readPptx } from "./read";
import type { DeckDoc, SlideElement } from "../model";
import { newComment, newReply, type SlideComment } from "../comments";

const box = { id: "box", type: "rect", x: 100, y: 60, w: 200, h: 100, fill: "#4285f4", stroke: "none", strokeWidth: 0 } as SlideElement;
const ann = { id: "u-ann", name: "Ann Lee" };
const bob = { id: "u-bob", name: "Bob" };
const t0 = new Date("2026-09-27T10:00:00.000Z");
const t1 = new Date("2026-09-27T10:05:00.000Z");

function deck(): DeckDoc {
  const onBox: SlideComment = {
    ...newComment(ann, "s1", "Bigger & bolder <please>", { el: box, now: t0, id: "c1" }),
    resolved: true,
    resolvedBy: "Bob",
    replies: [newReply(bob, "Done", t1, "r1")],
  };
  // The element moved after the comment was made: its marker follows.
  const moved = { ...box, x: 140 };
  return {
    slides: [
      { id: "s1", background: "#ffffff", elements: [moved] },
      { id: "s2", background: "#ffffff", elements: [] },
    ],
    comments: [onBox, newComment(bob, "s2", "Slide-level note", { at: { x: 480, y: 270 }, now: t1, id: "c2" })],
  };
}

describe("pptx comments", () => {
  it("writes PowerPoint comment parts", async () => {
    const zip = await JSZip.loadAsync(await deckToPptx(deck()));
    const authors = await zip.file("ppt/commentAuthors.xml")!.async("string");
    expect(authors).toContain('name="Ann Lee" initials="AL" lastIdx="1"');
    expect(authors).toContain('name="Bob" initials="B" lastIdx="2"');
    const c1 = await zip.file("ppt/comments/comment1.xml")!.async("string");
    expect(c1).toContain("<p:text>Bigger &amp; bolder &lt;please&gt;</p:text>");
    expect(c1).toContain('<p15:parentCm authorId="0" idx="1"/>');
    // 340 px of 960 on a 10 in slide = 3.54 in = 2040 units.
    expect(c1).toContain('<p:pos x="2040" y="360"/>');
    expect(await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string")).toContain("../comments/comment1.xml");
    expect(await zip.file("ppt/slides/_rels/slide2.xml.rels")!.async("string")).toContain("../comments/comment2.xml");
    expect(await zip.file("ppt/_rels/presentation.xml.rels")!.async("string")).toContain("commentAuthors.xml");
    const ct = await zip.file("[Content_Types].xml")!.async("string");
    expect(ct).toContain('PartName="/ppt/comments/comment2.xml"');
    expect(ct).toContain('PartName="/ppt/commentAuthors.xml"');
  });

  it("round-trips threads, replies, resolved state and the element anchor", async () => {
    const r = await readPptx(await deckToPptx(deck()));
    const [s1, s2] = r.deck.slides;
    const cs = r.deck.comments!;
    expect(cs).toHaveLength(2);
    const a = cs.find((c) => c.id === "c1")!;
    expect(a).toMatchObject({
      slideId: s1.id,
      elId: s1.elements[0].id,
      authorId: "u-ann",
      authorName: "Ann Lee",
      body: "Bigger & bolder <please>",
      resolved: true,
      resolvedBy: "Bob",
      createdAt: t0.toISOString(),
      x: 340,
      y: 60,
    });
    expect(a.replies).toEqual([{ id: "r1", authorId: "u-bob", authorName: "Bob", body: "Done", createdAt: t1.toISOString() }]);
    expect(cs.find((c) => c.id === "c2")).toMatchObject({ slideId: s2.id, x: 480, y: 270, body: "Slide-level note" });
  });

  it("reads foreign comments (no Grown extension) from their position", async () => {
    const zip = await JSZip.loadAsync(await deckToPptx(deck()));
    for (const f of zip.file(/^ppt\/comments\//)) {
      const x = await f.async("string");
      zip.file(f.name, x.replace(/<p:ext uri="\{8A3C5B61[^]*?<\/p:ext>/g, ""));
    }
    const r = await readPptx(await zip.generateAsync({ type: "uint8array" }));
    const cs = r.deck.comments!;
    expect(cs.map((c) => c.body).sort()).toEqual(["Bigger & bolder <please>", "Slide-level note"]);
    const head = cs.find((c) => c.body.startsWith("Bigger"))!;
    expect(head).toMatchObject({ authorId: "pptx:Ann Lee", x: 340, y: 60 });
    expect(head.elId).toBeUndefined();
    expect(head.resolved).toBeUndefined();
    expect(head.replies.map((x) => [x.authorName, x.body])).toEqual([["Bob", "Done"]]);
  });

  it("writes nothing for a deck without comments", async () => {
    const zip = await JSZip.loadAsync(await deckToPptx({ slides: deck().slides }));
    expect(zip.file("ppt/commentAuthors.xml")).toBeNull();
  });
});
