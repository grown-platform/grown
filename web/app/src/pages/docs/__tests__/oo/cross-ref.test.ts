// Port of OnlyOffice word/api/cross-ref.js (behaviour only).
//
// OnlyOffice puts the heading inside a block-level content control (and,
// for bug 69293, a locked one). Grown has no content controls until M10,
// so the heading stands on its own; the reference behaviour is the same:
// the new paragraph reads the heading text and the heading gets a hidden
// "_Ref1" bookmark.
import { describe, expect, it } from "vitest";
import { makeEditor, paragraphText, setCursor, textblocks } from "../harness";
import { addRefToParagraph } from "../../crossref";
import { refBookmarkForParagraph } from "../../bookmarks";

describe("OnlyOffice cross-ref", () => {
  it("oo:word/api/cross-ref.js#Test adding cross-ref to a block-level sdt", () => {
    const e = makeEditor("<h1>HeadingText</h1><p></p>");
    expect(paragraphText(e, 0)).toBe("HeadingText");
    const [heading, p] = textblocks(e);
    setCursor(e, p.pos);
    // AddRefToParagraph(heading, 0 = text, hyperlink, no above/below).
    expect(addRefToParagraph(e, heading.pos - 1, "text", true)).toBe(true);
    expect(paragraphText(e, 1)).toBe("HeadingText");
    expect(refBookmarkForParagraph(e.state.doc, heading.pos - 1)).toBe("_Ref1");

    // Again in a fresh document (upstream: a locked content control, bug
    // 69293; locking arrives with M10): same text, same bookmark name.
    const f = makeEditor("<h1>HeadingText</h1><p></p>");
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
