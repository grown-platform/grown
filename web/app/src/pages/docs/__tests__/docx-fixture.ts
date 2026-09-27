// Self-generated .docx fixtures for the DOCX reader/writer tests (Docs M6).
// Everything is built in code from ECMA-376 structures; no third-party
// sample files are committed.
import JSZip from "jszip";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"';
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const RELNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** A 1x1 PNG. */
export const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export interface FixtureParts {
  body: string;
  styles?: string;
  numbering?: string;
  footnotes?: string;
  endnotes?: string;
  comments?: string;
  commentsExtended?: string;
  header?: string;
  footer?: string;
  theme?: string;
  /** Extra document relationships: [id, type suffix, target, external]. */
  rels?: [string, string, string, boolean?][];
  media?: Record<string, string>;
  /** The body's final sectPr (header/footer references are added). */
  sectPr?: string;
  /** word/settings.xml (M9). */
  settings?: string;
  /** More parts under word/ (e.g. "header2.xml"); relate them with `rels`. */
  extraParts?: Record<string, string>;
}

/** buildDocx packages parts into a .docx (Uint8Array). */
export async function buildDocx(p: FixtureParts): Promise<Uint8Array> {
  const zip = new JSZip();
  const rels: string[] = [];
  const overrides: string[] = [];
  const part = (name: string, type: string, xml: string | undefined, rel: string) => {
    if (!xml) return;
    zip.file(`word/${name}`, DECL + xml);
    overrides.push(`<Override PartName="/word/${name}" ContentType="application/vnd.openxmlformats-officedocument.${type}"/>`);
    rels.push(`<Relationship Id="rId${name.replace(/\W/g, "")}" Type="${rel.startsWith("http") ? rel : `${RELNS}/${rel}`}" Target="${name}"/>`);
  };
  part("styles.xml", "wordprocessingml.styles+xml", p.styles, "styles");
  part("numbering.xml", "wordprocessingml.numbering+xml", p.numbering, "numbering");
  part("footnotes.xml", "wordprocessingml.footnotes+xml", p.footnotes, "footnotes");
  part("endnotes.xml", "wordprocessingml.endnotes+xml", p.endnotes, "endnotes");
  part("comments.xml", "wordprocessingml.comments+xml", p.comments, "comments");
  part(
    "commentsExtended.xml",
    "wordprocessingml.commentsExtended+xml",
    p.commentsExtended,
    "http://schemas.microsoft.com/office/2011/relationships/commentsExtended",
  );
  part("header1.xml", "wordprocessingml.header+xml", p.header, "header");
  part("footer1.xml", "wordprocessingml.footer+xml", p.footer, "footer");
  part("theme/theme1.xml", "theme+xml", p.theme, "theme");
  part("settings.xml", "wordprocessingml.settings+xml", p.settings, "settings");
  for (const [name, xml] of Object.entries(p.extraParts ?? {})) zip.file(`word/${name}`, DECL + xml);
  for (const [id, type, target, external] of p.rels ?? [])
    rels.push(`<Relationship Id="${id}" Type="${RELNS}/${type}" Target="${target}"${external ? ' TargetMode="External"' : ""}/>`);
  for (const [name, b64] of Object.entries(p.media ?? {})) zip.file(`word/media/${name}`, b64, { base64: true });
  const refs =
    (p.header ? '<w:headerReference w:type="default" r:id="rIdheader1xml"/>' : "") +
    (p.footer ? '<w:footerReference w:type="default" r:id="rIdfooter1xml"/>' : "");
  const sect = p.sectPr ?? '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>';
  zip.file("word/document.xml", `${DECL}<w:document ${W}><w:body>${p.body}<w:sectPr>${refs}${sect}</w:sectPr></w:body></w:document>`);
  zip.file("word/_rels/document.xml.rels", `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`);
  zip.file(
    "_rels/.rels",
    `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RELNS}/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "[Content_Types].xml",
    `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${overrides.join("")}</Types>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

const p = (body: string, pPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${body}</w:p>`;
const r = (text: string, rPr = "") => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const ps = (style: string) => `<w:pStyle w:val="${style}"/>`;
const num = (id: number, lvl: number) => `<w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="${id}"/></w:numPr>`;

export const THEME = `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office"><a:themeElements><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;

export const STYLES = `<w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="0"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/><w:color w:val="2F5496"/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Titel"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:sz w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="Callout"><w:name w:val="Callout Box"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:pBdr><w:left w:val="single" w:sz="24" w:space="4" w:color="1A73E8"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="E8F0FE"/><w:ind w:left="360"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="BigHeading"><w:name w:val="Big Heading"/><w:basedOn w:val="Heading1"/><w:rPr><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListNumbered"><w:name w:val="Numbered Steps"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="4"/></w:numPr></w:pPr></w:style>
<w:style w:type="character" w:customStyle="1" w:styleId="Marker"><w:name w:val="Marker"/><w:rPr><w:b/><w:color w:val="C00000"/></w:rPr></w:style>
<w:style w:type="character" w:customStyle="1" w:styleId="Unused"><w:name w:val="Unused Style"/><w:rPr><w:b/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>
</w:styles>`;

export const NUMBERING = `<w:numbering ${W}>
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val=""/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperLetter"/><w:lvlText w:val="Step %1)"/><w:suff w:val="space"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="0" w:firstLine="0"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
<w:num w:numId="3"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/></w:lvlOverride></w:num>
<w:num w:numId="4"><w:abstractNumId w:val="2"/></w:num>
<w:num w:numId="9"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

const drawing = (rid: string, cx: number, cy: number, descr: string) =>
  `<w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Picture 1" descr="${descr}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="p.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

export const TABLE = `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="1500"/><w:gridCol w:w="3000"/><w:gridCol w:w="4500"/></w:tblGrid>
<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc>${p(r("Name"))}</w:tc><w:tc>${p(r("Role"))}</w:tc><w:tc>${p(r("Notes"))}</w:tc></w:tr>
<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:shd w:val="clear" w:color="auto" w:fill="FCE8B2"/></w:tcPr>${p(r("Merged across"))}</w:tc><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>${p(r("Merged down"))}</w:tc></w:tr>
<w:tr><w:tc>${p(r("Ada"))}</w:tc><w:tc>${p(r("Engineer"))}</w:tc><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr>
</w:tbl>`;

/** The "everything" fixture: one of each construct the reader maps. */
export function richParts(): FixtureParts {
  const body = [
    p(r("Quarterly report"), ps("Titel")),
    p(r("Introduction"), ps("Heading1")),
    p(
      r("Plain ") +
        r("bold", "<w:b/>") +
        r(" ") +
        r("italic", "<w:i/>") +
        r(" ") +
        r("under", '<w:u w:val="single"/>') +
        r(" ") +
        r("struck", "<w:strike/>") +
        r(" ") +
        r("red", '<w:color w:val="FF0000"/>') +
        r(" ") +
        r("big", '<w:sz w:val="28"/>') +
        r(" ") +
        r("serif", '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/>') +
        r(" ") +
        r("marked", '<w:highlight w:val="yellow"/>') +
        r(" x") +
        r("2", '<w:vertAlign w:val="superscript"/>') +
        r(" ") +
        r("styled", '<w:rStyle w:val="Marker"/>') +
        '<w:r><w:tab/></w:r>' +
        '<w:hyperlink r:id="rIdLink"><w:r><w:rPr><w:rStyle w:val="DefaultParagraphFont"/></w:rPr><w:t>example</w:t></w:r></w:hyperlink>' +
        r(" ") +
        '<w:hyperlink w:anchor="intro"><w:r><w:t>see intro</w:t></w:r></w:hyperlink>',
    ),
    p(
      r("Formatted paragraph"),
      '<w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="999999"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="EEEEEE"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9360"/></w:tabs><w:spacing w:before="120" w:after="240" w:line="360" w:lineRule="auto"/><w:ind w:left="720" w:right="360" w:firstLine="360"/><w:jc w:val="center"/>',
    ),
    p(r("First item"), num(1, 0)),
    p(r("Sub item"), num(1, 1)),
    p(r("Second item"), num(1, 0)),
    p(r("Bullet one"), num(2, 0)),
    p(r("Bullet two"), num(2, 0)),
    p(r("Restarted at five"), num(3, 0)),
    p(r("Through the style"), ps("ListNumbered")),
    p(r("Also through the style"), ps("ListNumbered")),
    p(r("A callout"), ps("Callout")),
    p(r("Custom heading"), ps("BigHeading")),
    TABLE,
    p(drawing("rIdImg", 952500, 476250, "Logo")),
    p(r("See note") + '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r>' + r(" and end") + '<w:r><w:endnoteReference w:id="2"/></w:r>'),
    p(
      r("Before ") +
        '<w:commentRangeStart w:id="0"/>' +
        r("commented text") +
        '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>' +
        r(" after"),
    ),
    p(
      r("Kept ") +
        '<w:ins w:id="10" w:author="Alice" w:date="2026-01-02T03:04:05Z">' +
        r("added") +
        "</w:ins>" +
        r(" ") +
        '<w:del w:id="11" w:author="Bob" w:date="2026-01-02T03:04:05Z"><w:r><w:delText>removed</w:delText></w:r></w:del>',
    ),
    p(
      r("Date: ") +
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> DATE \\@ "yyyy-MM-dd" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        r("2026-09-26") +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
        r(" ") +
        '<w:fldSimple w:instr=" HYPERLINK &quot;https://grown.example/&quot; ">' +
        r("field link") +
        "</w:fldSimple>" +
        '<w:bookmarkStart w:id="5" w:name="intro"/><w:bookmarkEnd w:id="5"/>',
    ),
    p('<w:r><w:br w:type="page"/></w:r>'),
    p(r("After the break")),
  ].join("\n");
  return {
    body,
    styles: STYLES,
    numbering: NUMBERING,
    theme: THEME,
    footnotes: `<w:footnotes ${W}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r>${r(" The footnote text.")}</w:p></w:footnote></w:footnotes>`,
    endnotes: `<w:endnotes ${W}><w:endnote w:id="2"><w:p><w:r><w:endnoteRef/></w:r>${r(" An endnote.")}</w:p><w:p>${r("Second line.")}</w:p></w:endnote></w:endnotes>`,
    comments: `<w:comments ${W}><w:comment w:id="0" w:author="Carol" w:initials="C" w:date="2026-02-03T04:05:06Z"><w:p w14:paraId="1A2B3C4D"><w:r><w:annotationRef/></w:r>${r("Please check.")}</w:p></w:comment><w:comment w:id="1" w:author="Dan" w:date="2026-02-04T04:05:06Z"><w:p w14:paraId="1A2B3C4E">${r("Checked.")}</w:p></w:comment></w:comments>`,
    commentsExtended: `<w15:commentsEx ${W}><w15:commentEx w15:paraId="1A2B3C4D" w15:done="0"/><w15:commentEx w15:paraId="1A2B3C4E" w15:paraIdParent="1A2B3C4D" w15:done="0"/></w15:commentsEx>`,
    header: `<w:hdr ${W}>${p(r("Company header", "<w:b/>"), '<w:jc w:val="center"/>')}</w:hdr>`,
    footer: `<w:ftr ${W}>${p(r("Page footer"), '<w:jc w:val="right"/>')}</w:ftr>`,
    rels: [
      ["rIdLink", "hyperlink", "https://example.com/", true],
      ["rIdImg", "image", "media/image1.png"],
    ],
    media: { "image1.png": PNG_1PX },
    sectPr: '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:pgMar w:top="1080" w:right="1440" w:bottom="1080" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>',
  };
}
