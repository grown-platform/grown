// Port of OnlyOffice word/api/cross-ref.js (behaviour only).
//
// The heading sits inside a block-level content control (M10) and, for
// bug 69293, a locked one: the new paragraph reads the heading text and
// the heading gets a hidden "_Ref1" bookmark.
import { describe, expect, it } from "vitest";
import { makeEditor, paragraphText, setCursor, textblocks } from "../harness";
import { addRefToParagraph } from "../../crossref";
import { refBookmarkForParagraph } from "../../bookmarks";
import { allSdts, prOf } from "../../sdt";

const inControl = (lock?: string) =>
  `<div data-sdt-pr='${JSON.stringify({ type: "richText", ...(lock ? { lock } : {}) })}'><h1>HeadingText</h1></div><p></p>`;

describe("OnlyOffice cross-ref", () => {
  it("oo:word/api/cross-ref.js#Test adding cross-ref to a block-level sdt", () => {
    const e = makeEditor(inControl());
    expect(allSdts(e.state.doc).length).toBe(1);
    expect(paragraphText(e, 0)).toBe("HeadingText");
    const [heading, p] = textblocks(e);
    setCursor(e, p.pos);
    // AddRefToParagraph(heading, 0 = text, hyperlink, no above/below).
    expect(addRefToParagraph(e, heading.pos - 1, "text", true)).toBe(true);
    expect(paragraphText(e, 1)).toBe("HeadingText");
    expect(refBookmarkForParagraph(e.state.doc, heading.pos - 1)).toBe("_Ref1");

    // Again with a locked content control (bug 69293): same text, same
    // bookmark name.
    const f = makeEditor(inControl("sdtContentLocked"));
    expect(prOf(allSdts(f.state.doc)[0].node).lock).toBe("sdtContentLocked");
    const [h2, p2] = textblocks(f);
    setCursor(f, p2.pos);
    addRefToParagraph(f, h2.pos - 1, "text", true);
    expect(paragraphText(f, 1)).toBe("HeadingText");
    expect(refBookmarkForParagraph(f.state.doc, h2.pos - 1)).toBe("_Ref1");
    // A second reference to the same heading reuses its bookmark.
    addRefToParagraph(f, h2.pos - 1, "text", true);
    expect(paragraphText(f, 1)).toBe("HeadingTextHeadingText");
    expect(refBookmarkForParagraph(f.state.doc, h2.pos - 1)).toBe("_Ref1");
  });
});
