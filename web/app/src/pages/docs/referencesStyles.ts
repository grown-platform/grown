// Editor CSS for references and fields (Docs M8): field shading, field
// codes (Alt+F9), TOC entries with right-aligned page numbers after a tab
// leader, the TOC's Update button, and link ScreenTips.
export const referencesSx = {
  // Fields: Word's grey shading on hover / when selected.
  "& .ProseMirror .doc-field": { borderRadius: "2px", cursor: "default" },
  "& .ProseMirror .doc-field:hover, & .ProseMirror .doc-field.ProseMirror-selectednode": {
    background: "rgba(0,0,0,0.08)",
    outline: "none",
  },
  "& .ProseMirror .doc-field[data-field-link]": { cursor: "pointer" },
  "& .ProseMirror.show-field-codes .doc-field": { fontSize: 0 },
  "& .ProseMirror.show-field-codes .doc-field::before": {
    content: '"{ " attr(data-field-instr) " }"',
    fontSize: "0.9rem",
    fontFamily: "monospace",
    background: "rgba(0,0,0,0.06)",
  },
  // Point bookmarks take no room.
  "& .ProseMirror .doc-bookmark-point": { display: "inline" },
  // Table of contents / figures.
  "& .ProseMirror .doc-toc": {
    position: "relative",
    margin: "0.5em 0 1em",
    padding: "4px 0",
    borderRadius: "4px",
  },
  "& .ProseMirror .doc-toc:hover, & .ProseMirror .doc-toc:focus-within": {
    outline: "1px dashed #c7d2fe",
    outlineOffset: "4px",
  },
  "& .ProseMirror .doc-toc-bar": {
    position: "absolute",
    top: "-22px",
    left: 0,
    display: "none",
    zIndex: 2,
  },
  "& .ProseMirror .doc-toc:hover .doc-toc-bar, & .ProseMirror .doc-toc:focus-within .doc-toc-bar": { display: "block" },
  "& .ProseMirror .doc-toc-bar button": {
    font: "12px/1.4 inherit",
    padding: "1px 8px",
    border: "1px solid #c7d2fe",
    borderRadius: "4px",
    background: "#eef2ff",
    color: "#1a3fb0",
    cursor: "pointer",
  },
  "& .ProseMirror p.doc-toc-entry": {
    display: "flex",
    alignItems: "baseline",
    margin: "0 0 0.35em",
    textIndent: 0,
  },
  "& .ProseMirror p.doc-toc-entry .toc-text": { flex: "0 1 auto", minWidth: "1ch" },
  "& .ProseMirror p.doc-toc-entry .toc-leader": {
    flex: "1 1 auto",
    minWidth: "1.5em",
    margin: "0 4px",
    borderBottom: "2px dotted #9aa0a6",
    transform: "translateY(-0.3em)",
  },
  "& .ProseMirror .doc-toc[data-leader='dash'] .toc-leader": { borderBottomStyle: "dashed" },
  "& .ProseMirror .doc-toc[data-leader='underline'] .toc-leader": { borderBottom: "1px solid #5f6368", transform: "none" },
  "& .ProseMirror .doc-toc[data-leader='none'] .toc-leader": { borderBottom: "none" },
  "& .ProseMirror .doc-toc[data-no-pages] .toc-leader, & .ProseMirror .doc-toc[data-no-pages] .toc-page": { display: "none" },
  "& .ProseMirror p.doc-toc-entry .toc-page": { flex: "none", minWidth: "1.5ch", textAlign: "right" },
  "& .ProseMirror p.doc-toc-entry a": { color: "inherit", textDecoration: "none" },
  ...Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [
      `& .ProseMirror p.doc-toc-entry[data-level='${i + 1}']`,
      { paddingLeft: `${i * 1.5}em`, fontWeight: i === 0 ? 600 : 400 },
    ]),
  ),
  "& .ProseMirror .doc-toc[data-kind='figures'] p.doc-toc-entry": { fontWeight: 400 },
  // A distinct key so it doesn't replace editorPageSx's own "@media print".
  "@media print and (min-width: 0px)": {
    "& .ProseMirror .doc-toc-bar": { display: "none !important" },
    "& .ProseMirror .doc-toc:hover": { outline: "none" },
    "& .ProseMirror .doc-field:hover": { background: "none" },
  },
};
