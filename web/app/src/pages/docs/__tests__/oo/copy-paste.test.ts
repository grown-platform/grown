// Ports of OnlyOffice's Word copy/paste tests (behaviour only):
// word/copypaste/copy-paste-tests.js.
//
// OnlyOffice pastes an HTML element through its PasteProcessor and compares
// its internal JSON (and, for "copy back", its own mso-styled HTML). Grown
// pastes through ProseMirror's clipboard pipeline (view.pasteHTML /
// pasteText, so ClipboardHandling's normalisation runs) and asserts the
// resulting document structure, marks and the HTML/text a copy produces.
// Differences: Grown doesn't add OnlyOffice's trailing empty paragraph,
// keeps inline colours that OnlyOffice's stubbed test paste drops, and
// copies semantic HTML rather than Word-style inline CSS.
//
// Tag note: QUnit names containing quotes are written without them (the
// scoreboard's tag syntax ends a case at a quote).
import { describe, expect, it } from "vitest";
import type { Editor, JSONContent } from "@tiptap/core";
import {
  blockPaths,
  docText,
  makeEditor,
  marksAt,
  paragraphText,
  paragraphTexts,
  selectAll,
} from "../harness";
import { pasteHTML, pastePlainText, selectionToHTML, selectionToText } from "../../clipboard";

/** A fresh empty document with `html` pasted into it. */
function pasted(html: string): Editor {
  const e = makeEditor("<p></p>");
  expect(pasteHTML(e, html)).toBe(true);
  return e;
}

/** Select all, then return what a copy would put on the clipboard. */
function copyAll(e: Editor): { html: string; text: string } {
  selectAll(e);
  return { html: selectionToHTML(e), text: selectionToText(e) };
}

/** Clipboard HTML without ProseMirror's slice bookkeeping attribute. */
const bare = (html: string) => html.replace(/ data-pm-slice="[^"]*"/g, "");

const types = (e: Editor) => (e.getJSON().content ?? []).map((n: JSONContent) => n.type);

const COMPLEX = `
  <div>
    <h1 style="color: red;">Title</h1>
    <p>Paragraph with <strong>bold</strong> and <em>italic</em> text.</p>
    <ul>
      <li>List item 1</li>
      <li>List item 2</li>
    </ul>
  </div>`;

describe("OnlyOffice copy/paste: paste callbacks", () => {
  it("oo:word/copypaste/copy-paste-tests.js#Test: callback tests paste plain text", () => {
    const e = makeEditor("<p></p>");
    expect(pastePlainText(e, "test")).toBe(true);
    expect(docText(e)).toBe("test");
  });

  it("oo:word/copypaste/copy-paste-tests.js#Test: callback tests paste HTML", () => {
    const e = pasted("test HTML content");
    expect(docText(e)).toBe("test HTML content");
  });

  it("oo:word/copypaste/copy-paste-tests.js#Test: callback tests paste Internal format", () => {
    // Grown's internal format is ProseMirror's clipboard HTML (with a
    // data-pm-slice attribute): copying from one doc and pasting into
    // another reproduces the structure exactly.
    const src = makeEditor(
      '<h2>Head</h2><p><strong>b</strong> <span style="color: #ff0000">red</span></p><ul><li><p>x</p></li></ul>',
    );
    selectAll(src);
    const html = selectionToHTML(src);
    expect(html).toContain("data-pm-slice");
    const dst = pasted(html);
    expect(dst.getJSON()).toEqual(src.getJSON());
    // An empty internal payload is accepted and changes nothing.
    const empty = makeEditor("<p>keep</p>");
    pasteHTML(empty, "");
    expect(docText(empty)).toBe("keep");
  });
});

describe("OnlyOffice copy/paste: paste HTML", () => {
  it("oo:word/copypaste/copy-paste-tests.js#Test: copy HTML with JSON verification", () => {
    const e = pasted("<p>Test HTML content</p>");
    expect(e.getJSON()).toEqual({
      type: "doc",
      content: [{ type: "paragraph", attrs: expect.any(Object), content: [{ type: "text", text: "Test HTML content" }] }],
    });
  });

  it("oo:word/copypaste/copy-paste-tests.js#Test: copy complex HTML with JSON verification", () => {
    const e = pasted(COMPLEX);
    expect(paragraphTexts(e)).toEqual([
      "Title",
      "Paragraph with bold and italic text.",
      "List item 1",
      "List item 2",
    ]);
    expect(blockPaths(e)).toEqual([
      "heading1",
      "paragraph",
      "bulletList>listItem>paragraph",
      "bulletList>listItem>paragraph",
    ]);
    expect(marksAt(e, 0, 0)).toEqual(["textStyle"]); // red title
    expect(e.getHTML()).toContain('style="color: red;"');
    expect(marksAt(e, 1, "Paragraph with ".length)).toEqual(["bold"]);
    expect(marksAt(e, 1, "Paragraph with bold and ".length)).toEqual(["italic"]);
  });

  it("oo:word/copypaste/copy-paste-tests.js#Paste simple div HTML content", () => {
    const e = pasted("<div>Simple text</div>");
    expect(types(e)).toEqual(["paragraph"]);
    expect(paragraphText(e)).toBe("Simple text");
  });

  it("oo:word/copypaste/copy-paste-tests.js#Paste paragraph and span with style", () => {
    const e = pasted("<p><span style='color:blue;'>Blue text</span></p>");
    expect(paragraphText(e)).toBe("Blue text");
    expect(e.getHTML()).toBe('<p><span style="color: blue;">Blue text</span></p>');
  });

  it("oo:word/copypaste/copy-paste-tests.js#Paste table HTML", () => {
    const e = pasted("<table><tr><td>Cell 1</td><td>Cell 2</td></tr></table>");
    expect(blockPaths(e).slice(0, 2)).toEqual([
      "table>tableRow>tableCell>paragraph",
      "table>tableRow>tableCell>paragraph",
    ]);
    expect(paragraphTexts(e).slice(0, 2)).toEqual(["Cell 1", "Cell 2"]);
    expect(copyAll(e).text.split("\n")[0]).toBe("Cell 1\tCell 2");
  });

  it("oo:word/copypaste/copy-paste-tests.js#Paste unordered list HTML", () => {
    const e = pasted("<ul><li>Item 1</li><li>Item 2</li></ul>");
    expect(blockPaths(e)).toEqual(["bulletList>listItem>paragraph", "bulletList>listItem>paragraph"]);
    expect(paragraphTexts(e)).toEqual(["Item 1", "Item 2"]);
    expect(copyAll(e).text).toBe("• Item 1\n• Item 2");
  });

  it("oo:word/copypaste/copy-paste-tests.js#Paste nested list with paragraphs HTML", () => {
    const e = pasted(`<ol>
      <li><p>test1</p><ul><li>elem1</li></ul></li>
      <li><p>test2</p><ul><li>elem2</li></ul></li>
    </ol>`);
    expect(paragraphTexts(e)).toEqual(["test1", "elem1", "test2", "elem2"]);
    expect(blockPaths(e)).toEqual([
      "orderedList>listItem>paragraph",
      "orderedList>listItem>bulletList>listItem>paragraph",
      "orderedList>listItem>paragraph",
      "orderedList>listItem>bulletList>listItem>paragraph",
    ]);
    // test1 and test2 share one ordered list, so numbering continues.
    expect(types(e)).toEqual(["orderedList"]);
    expect(copyAll(e).text).toBe("1. test1\n  • elem1\n2. test2\n  • elem2");
  });

  it("oo:word/copypaste/copy-paste-tests.js#Paste image HTML", () => {
    const src = "data:image/png;base64,R0lGODlhAQABAAAAACw=";
    const e = pasted(`<img src='${src}' alt='Test Image'>`);
    const imgs: JSONContent[] = [];
    const walk = (n: JSONContent) => {
      if (n.type === "image") imgs.push(n);
      n.content?.forEach(walk);
    };
    walk(e.getJSON());
    expect(imgs).toHaveLength(1);
    expect(imgs[0].attrs).toMatchObject({ src, alt: "Test Image" });
    // An image pointing at the copier's disk (Word's clip files) is dropped.
    const f = pasted('<p>a<img src="file:///C:/Temp/msohtmlclip1/01/clip_image001.png">b</p>');
    expect(f.getHTML()).not.toContain("<img");
    expect(docText(f)).toBe("ab");
  });

  it("oo:word/copypaste/copy-paste-tests.js#Paste bold and italic HTML", () => {
    const e = pasted("<p><b>Bold</b> and <i>Italic</i></p>");
    expect(paragraphText(e)).toBe("Bold and Italic");
    expect(marksAt(e, 0, 0)).toEqual(["bold"]);
    expect(marksAt(e, 0, 5)).toEqual([]);
    expect(marksAt(e, 0, 9)).toEqual(["italic"]);
  });

  it("oo:word/copypaste/copy-paste-tests.js#Paste underline and strikethrough HTML", () => {
    const e = pasted("<p><u>Underline</u> and <s>Strikethrough</s></p>");
    expect(paragraphText(e)).toBe("Underline and Strikethrough");
    expect(marksAt(e, 0, 0)).toEqual(["underline"]);
    expect(marksAt(e, 0, "Underline and ".length)).toEqual(["strike"]);
  });

  it("oo:word/copypaste/copy-paste-tests.js#Paste hyperlink HTML", () => {
    const e = pasted("<a href='https://example.com'>Example Link</a>");
    expect(paragraphText(e)).toBe("Example Link");
    expect(marksAt(e, 0, 0)).toEqual(["link"]);
    expect(e.getHTML()).toContain('href="https://example.com"');
  });

  it("oo:word/copypaste/copy-paste-tests.js#Paste nested HTML elements", () => {
    const e = pasted("<div><span><b>Nested</b> <i>Elements</i></span></div>");
    expect(paragraphText(e)).toBe("Nested Elements");
    expect(marksAt(e, 0, 0)).toEqual(["bold"]);
    expect(marksAt(e, 0, 7)).toEqual(["italic"]);
  });

  it("oo:word/copypaste/copy-paste-tests.js#Paste line break HTML", () => {
    const e = pasted("Line1<br>Line2");
    expect(types(e)).toEqual(["paragraph"]);
    expect(paragraphText(e)).toBe("Line1\nLine2");
    expect(e.getHTML()).toBe("<p>Line1<br>Line2</p>");
  });

  it("oo:word/copypaste/copy-paste-tests.js#Paste empty div HTML", () => {
    const e = pasted("<div></div>");
    expect(types(e)).toEqual(["paragraph"]);
    expect(docText(e)).toBe("");
  });

  it("oo:word/copypaste/copy-paste-tests.js#Paste special character HTML", () => {
    const e = pasted("<div>&copy; &euro; &amp;</div>");
    expect(paragraphText(e)).toBe("© € &");
  });

  it("oo:word/copypaste/copy-paste-tests.js#Paste formula as text HTML", () => {
    const e = pasted("<div>y = mx + b</div>");
    expect(paragraphText(e)).toBe("y = mx + b");
  });

  it("oo:word/copypaste/copy-paste-tests.js#Paste HTML with mso style", () => {
    const e = pasted('<br style="page-break-before:always;mso-break-type:section-break;">');
    expect(types(e)).toContain("pageBreak");
    // Copying a page break hands other editors Word's page-break <br>, and
    // pasting that back gives a page break again.
    const copied = copyAll(e).html;
    expect(copied).toMatch(/<br[^>]*page-break-before: always/);
    expect(types(pasted(copied))).toContain("pageBreak");
  });
});

describe("OnlyOffice copy/paste: paste then copy back", () => {
  it("oo:word/copypaste/copy-paste-tests.js#Test: paste html, select text, copy html, check htmls for simple lists", () => {
    const e = pasted(COMPLEX);
    const { html, text } = copyAll(e);
    expect(bare(html)).toBe(
      '<h1><span style="color: red;">Title</span></h1>' +
        "<p>Paragraph with <strong>bold</strong> and <em>italic</em> text.</p>" +
        "<ul><li><p>List item 1</p></li><li><p>List item 2</p></li></ul>",
    );
    expect(text).toBe("Title\nParagraph with bold and italic text.\n• List item 1\n• List item 2");
  });

  it("oo:word/copypaste/copy-paste-tests.js#Test: paste html, select text, copy html, check htmls for marked lists", () => {
    const e = pasted("<ul><li>Элемент 1</li><li>Элемент 2</li><li>Элемент 3</li></ul>");
    expect(bare(copyAll(e).html)).toBe(
      "<ul><li><p>Элемент 1</p></li><li><p>Элемент 2</p></li><li><p>Элемент 3</p></li></ul>",
    );
  });

  it("oo:word/copypaste/copy-paste-tests.js#Test: paste html, select text, copy html, check htmls for numbered lists", () => {
    const e = pasted("<ol><li>Элемент 1</li><li>Элемент 2</li><li>Элемент 3</li></ol>");
    const { html, text } = copyAll(e);
    expect(bare(html)).toBe(
      '<ol><li><p>Элемент 1</p></li><li><p>Элемент 2</p></li><li><p>Элемент 3</p></li></ol>',
    );
    expect(text).toBe("1. Элемент 1\n2. Элемент 2\n3. Элемент 3");
  });

  it("oo:word/copypaste/copy-paste-tests.js#Test: paste html, select text, copy html, check htmls for multi-level lists", () => {
    const e = pasted(`<ul>
      <li>Первый уровень 1
        <ul><li>Второй уровень 1</li><li>Второй уровень 2</li></ul>
      </li>
      <li>Первый уровень 2</li>
    </ul>`);
    const { html, text } = copyAll(e);
    expect(bare(html)).toMatch(
      /^<ul><li><p>Первый уровень 1\s*<\/p><ul><li><p>Второй уровень 1<\/p><\/li><li><p>Второй уровень 2<\/p><\/li><\/ul><\/li><li><p>Первый уровень 2<\/p><\/li><\/ul>$/,
    );
    expect(text.split("\n").map((l) => l.trimEnd())).toEqual([
      "• Первый уровень 1",
      "  • Второй уровень 1",
      "  • Второй уровень 2",
      "• Первый уровень 2",
    ]);
  });

  it("oo:word/copypaste/copy-paste-tests.js#Paste simple div HTML, then select & copy back", () => {
    const e = pasted("<div>Simple text</div>");
    const { html, text } = copyAll(e);
    expect(bare(html)).toBe("<p>Simple text</p>");
    expect(text).toBe("Simple text");
  });

  it("oo:word/copypaste/copy-paste-tests.js#Paste paragraph + span with style, then select & copy back", () => {
    const e = pasted("<p><span style='color:blue;'>Blue text</span></p>");
    expect(bare(copyAll(e).html)).toBe('<p><span style="color: blue;">Blue text</span></p>');
  });

  it("oo:word/copypaste/copy-paste-tests.js#Paste unordered list HTML, then select & copy back", () => {
    const e = pasted("<ul><li>Item 1</li><li>Item 2</li></ul>");
    expect(bare(copyAll(e).html)).toBe("<ul><li><p>Item 1</p></li><li><p>Item 2</p></li></ul>");
  });

  it("oo:word/copypaste/copy-paste-tests.js#Paste bold/italic HTML, then select & copy back", () => {
    const e = pasted("<p><b>Bold</b> and <i>Italic</i></p>");
    expect(bare(copyAll(e).html)).toBe("<p><strong>Bold</strong> and <em>Italic</em></p>");
  });

  it("oo:word/copypaste/copy-paste-tests.js#Paste sum formula from excel to word", () => {
    // Excel's clipboard HTML: a full document with a <style> block, <col>s,
    // StartFragment comments and mso-* CSS.
    const e = pasted(`<html><head>
      <meta name=ProgId content=Excel.Sheet>
      <style><!--table {mso-displayed-decimal-separator:"\\,";} td {mso-number-format:General; font-size:11.0pt;}--></style>
      </head><body>
      <table border=0 cellpadding=0 cellspacing=0 width=256 style='border-collapse:collapse;width:192pt'>
      <!--StartFragment-->
       <col width=64 span=4 style='width:48pt'>
       <tr height=20 style='height:15.0pt'>
        <td height=20 width=64 style='height:15.0pt;width:48pt'></td><td width=64></td><td width=64></td><td width=64></td>
       </tr>
       <tr height=20 style='height:15.0pt'>
        <td height=20 align=right style='height:15.0pt;mso-number-format:General'>1</td>
        <td align=right>2</td><td align=right>3</td><td align=right>6</td>
       </tr>
      <!--EndFragment-->
      </table></body></html>`);
    expect(types(e)).toContain("table");
    const cells = blockPaths(e).filter((p) => p.startsWith("table>"));
    expect(cells).toHaveLength(8);
    expect(paragraphTexts(e).slice(0, 8)).toEqual(["", "", "", "", "1", "2", "3", "6"]);
    expect(docText(e)).not.toMatch(/mso|Excel/);
    const { html, text } = copyAll(e);
    expect(html).toMatch(/^<table/);
    expect(html).toContain("<td");
    expect(text.split("\n").slice(0, 2)).toEqual(["\t\t\t", "1\t2\t3\t6"]);
  });

  it("oo:word/copypaste/copy-paste-tests.js#Paste mso styled text from word", () => {
    // Word's clipboard HTML: VML ink shape, conditional markup, <o:p>,
    // mso-* declarations, a coloured run and a highlighted run.
    const e = pasted(`<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
      <head><meta name=ProgId content=Word.Document>
      <style><!-- p.MsoNormal {margin-bottom:8.0pt; line-height:115%; font-family:"Aptos",sans-serif;} --></style></head>
      <body lang=RU style='tab-interval:35.4pt'>
      <!--StartFragment-->
      <p class=MsoNormal><v:rect id="ink" style='position:absolute;width:1.15pt' filled="f"><v:stroke endcap="round"/><o:ink i="AE0d" annotation="t"/></v:rect><i style='mso-bidi-font-style:normal'><span lang=EN-US style='mso-ansi-language:EN-US'>a<span style='color:#EE0000'>sdfasdfas</span><span style='background:yellow;mso-highlight:yellow'>df</span><o:p></o:p></span></i></p>
      <!--EndFragment-->
      </body></html>`);
    expect(paragraphTexts(e)).toEqual(["asdfasdfasdf"]);
    expect(marksAt(e, 0, 0)).toEqual(["italic"]);
    expect(marksAt(e, 0, 1)).toEqual(["italic", "textStyle"]);
    expect(marksAt(e, 0, 10)).toEqual(["highlight", "italic"]);
    const html = e.getHTML();
    expect(html).toContain("color: rgb(238, 0, 0)");
    expect(html).toContain('data-color="#ffff00"');
    expect(html).not.toMatch(/mso-|class=|lang=/);
  });

  it.skip("oo:word/copypaste/copy-paste-tests.js#Paste Newton’s binom formula from word", () => {
    // Commented out upstream; its expected value is OnlyOffice's own copy
    // HTML. Grown pastes Word's OMML as an equation since M11 (math.test.ts).
  });

  it.skip("oo:word/copypaste/copy-paste-tests.js#Paste footnote formula from word", () => {
    // TODO(F1): an equation inside a footnote needs rich footnote bodies
    // (equations themselves paste since M11).
  });
});

describe("Word list paragraphs (Grown)", () => {
  it("turns mso-list paragraphs into nested lists and drops the typed markers", () => {
    const e = pasted(`
      <p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>1.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span></span><![endif]>One</p>
      <p class=MsoListParagraphCxSpMiddle style='margin-left:72.0pt;mso-list:l0 level2 lfo1'><![if !supportLists]><span style='font-family:"Courier New";mso-list:Ignore'>o<span>&nbsp; </span></span><![endif]>One A</p>
      <p class=MsoListParagraphCxSpLast style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>2.<span>&nbsp; </span></span><![endif]>Two</p>
      <p class=MsoNormal>After</p>`);
    expect(paragraphTexts(e)).toEqual(["One", "One A", "Two", "After"]);
    expect(blockPaths(e)).toEqual([
      "orderedList>listItem>paragraph",
      "orderedList>listItem>bulletList>listItem>paragraph",
      "orderedList>listItem>paragraph",
      "paragraph",
    ]);
  });

  it("unwraps Google Docs' non-bold wrapper", () => {
    const e = pasted(
      '<b style="font-weight:normal;" id="docs-internal-guid-abc"><p><span style="font-weight:700">Hi</span> there</p></b>',
    );
    expect(paragraphText(e)).toBe("Hi there");
    expect(marksAt(e, 0, 0)).toContain("bold");
    expect(marksAt(e, 0, 3)).not.toContain("bold");
  });

  it("pastes plain text as paragraphs without interpreting markup", () => {
    const e = makeEditor("<p></p>");
    pastePlainText(e, "<b>not bold</b>\nsecond line");
    expect(paragraphTexts(e)).toEqual(["<b>not bold</b>", "second line"]);
    expect(marksAt(e, 0, 3)).toEqual([]);
  });
});
