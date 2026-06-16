import type { SxProps } from "@mui/joy/styles/types";
import type { Indents } from "./Ruler";

const PX_PER_INCH = 96;
const PAGE_GAP = 10; // gray gap drawn between pages

export type Orientation = "portrait" | "landscape";

/** pageDims returns the page width/height in px for the orientation. */
export function pageDims(orientation: Orientation): { w: number; h: number } {
  const long = 11 * PX_PER_INCH,
    short = 8.5 * PX_PER_INCH;
  return orientation === "landscape"
    ? { w: long, h: short }
    : { w: short, h: long };
}

/** editorPageSx styles the white "page": Letter size, 1" margins, a drop
 *  shadow, and a faint page-boundary guide every page so the document reads as
 *  discrete pages on the gray workspace. Ruler indents set the L/R margins and
 *  first-line indent. (True content reflow across pages is a follow-up.) */
export interface VMargins {
  top: number; // inches
  bottom: number; // inches
}

export function editorPageSx(
  indents: Indents,
  orientation: Orientation = "portrait",
  vMargins: VMargins = { top: 1, bottom: 1 },
): SxProps {
  const { w: PAGE_W, h: PAGE_H } = pageDims(orientation);
  const MT = vMargins.top * PX_PER_INCH;
  const MB = vMargins.bottom * PX_PER_INCH;
  return {
    width: { xs: "100%", md: `${PAGE_W}px` },
    maxWidth: "100%",
    boxSizing: "border-box",
    mx: "auto",
    position: "relative",
    bgcolor: "#fff",
    color: "#202124",
    borderRadius: 0,
    boxShadow: "0 1px 3px rgba(60,64,67,.24), 0 1px 2px rgba(60,64,67,.18)",
    minHeight: `${PAGE_H}px`,
    // Footnote markers auto-number via this counter (incremented per
    // .footnote-ref::before), so they stay correct as notes move.
    counterReset: "footnote endnote",
    pt: `${MT}px`,
    pb: `${MB}px`,
    pl: { xs: 2, md: `${indents.left * PX_PER_INCH}px` },
    pr: { xs: 2, md: `${indents.right * PX_PER_INCH}px` },
    // Page boundaries every page: a ${PAGE_GAP}px gray gap (matching the
    // workspace) with faint edge shadows, so the document reads as separate sheets.
    backgroundImage:
      `repeating-linear-gradient(to bottom,` +
      ` transparent 0,` +
      ` transparent ${PAGE_H - PAGE_GAP}px,` +
      ` rgba(0,0,0,.10) ${PAGE_H - PAGE_GAP}px,` +
      ` #f1f3f4 ${PAGE_H - PAGE_GAP + 1}px,` +
      ` #f1f3f4 ${PAGE_H - 1}px,` +
      ` rgba(0,0,0,.10) ${PAGE_H - 1}px,` +
      ` transparent ${PAGE_H}px)`,
    "& .ProseMirror": {
      outline: "none",
      minHeight: `${PAGE_H - MT - MB}px`,
      lineHeight: 1.6,
    },
    "& .ProseMirror p": {
      margin: "0 0 0.75em",
      textIndent: `${indents.firstLine * PX_PER_INCH}px`,
    },
    "& .ProseMirror ul[data-type='taskList']": {
      listStyle: "none",
      paddingLeft: 0,
    },
    "& .ProseMirror ul[data-type='taskList'] li": {
      display: "flex",
      gap: "0.5em",
    },
    "& .ProseMirror img": { maxWidth: "100%", height: "auto" },
    "& .ProseMirror img.doc-drawing": {
      display: "block",
      margin: "0.5em auto",
      maxWidth: "100%",
      cursor: "pointer",
      border: "1px solid transparent",
      borderRadius: "4px",
    },
    "& .ProseMirror img.doc-drawing:hover": {
      border: "1px solid #c7d2fe",
    },
    // Page break: dashed divider on screen, real page break when printed.
    "& .ProseMirror .page-break": {
      borderTop: "2px dashed #c7d2fe",
      margin: "1.5em 0",
      height: 0,
      position: "relative",
      breakAfter: "page",
      pageBreakAfter: "always",
    },
    "@media print": {
      "& .ProseMirror .page-break": { borderTop: "none" },
    },
    // Header/footer margin regions: placed inside the page's top/bottom margins,
    // visually separated from the body, smaller and muted like Google Docs.
    "& .doc-header-region, & .doc-footer-region": {
      position: "absolute",
      left: { xs: 16, md: `${indents.left * PX_PER_INCH}px` },
      right: { xs: 16, md: `${indents.right * PX_PER_INCH}px` },
      fontSize: "0.85rem",
      color: "#5f6368",
    },
    "& .doc-header-region": { top: `${MT / 2 - 6}px` },
    "& .doc-footer-region": { bottom: `${MB / 2 - 6}px` },
    "& .margin-editor .ProseMirror": {
      outline: "none",
      minHeight: "1.4em",
      lineHeight: 1.4,
    },
    "& .margin-editor .ProseMirror p": { margin: 0, textIndent: 0 },
    "& .doc-header-region .margin-editor": {
      borderBottom: "1px solid #e0e0e0",
      paddingBottom: "2px",
    },
    "& .doc-footer-region .margin-editor": {
      borderTop: "1px solid #e0e0e0",
      paddingTop: "2px",
    },
    "& .ProseMirror .suggestion-insert": {
      color: "#188038",
      textDecoration: "underline",
    },
    "& .ProseMirror .suggestion-delete": {
      color: "#d93025",
      textDecoration: "line-through",
    },
    "& .ProseMirror .footnote-ref": {
      cursor: "pointer",
      color: "#1a73e8",
      fontWeight: 600,
      userSelect: "none",
    },
    "& .ProseMirror .footnote-ref::before": {
      counterIncrement: "footnote",
      content: '"[" counter(footnote) "]"',
    },
    "& .ProseMirror .endnote-ref": {
      cursor: "pointer",
      color: "#1a73e8",
      fontWeight: 600,
      userSelect: "none",
    },
    "& .ProseMirror .endnote-ref::before": {
      counterIncrement: "endnote",
      content: '"[" counter(endnote, lower-roman) "]"',
    },
    "& .ProseMirror a": {
      color: "#1a73e8",
      textDecoration: "underline",
      cursor: "pointer",
    },
    "& .ProseMirror .doc-comment-anchor": {
      backgroundColor: "rgba(244,180,0,.28)",
      borderBottom: "2px solid #f4b400",
      cursor: "pointer",
    },
    "& .ProseMirror .doc-comment-anchor--active": {
      backgroundColor: "rgba(244,180,0,.5)",
    },
    "& .ProseMirror table": {
      borderCollapse: "collapse",
      width: "100%",
      margin: "0.5em 0",
    },
    "& .ProseMirror th, & .ProseMirror td": {
      border: "1px solid #ccced1",
      padding: "4px 8px",
      minWidth: "2em",
    },
    "& .ProseMirror th": { bgcolor: "#f1f3f4", fontWeight: 600 },
    "& .collaboration-cursor__caret": {
      borderLeft: "1px solid currentColor",
      borderRight: "1px solid currentColor",
      marginLeft: "-1px",
      marginRight: "-1px",
      position: "relative",
      wordBreak: "normal",
    },
    "& .collaboration-cursor__label": {
      position: "absolute",
      top: "-1.4em",
      left: "-1px",
      fontSize: "12px",
      fontWeight: 600,
      lineHeight: "normal",
      color: "#fff",
      padding: "1px 6px",
      borderRadius: "4px",
      whiteSpace: "nowrap",
    },
  };
}

/** workspaceSx is the gray canvas the page sits on. */
export const workspaceSx: SxProps = {
  bgcolor: "#f1f3f4",
  py: 4,
  px: 2,
  minHeight: "70vh",
};
