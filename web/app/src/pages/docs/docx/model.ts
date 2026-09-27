// Shared types for the direct DOCX reader and writer (Docs M6).
import type { JSONContent } from "@tiptap/core";
import type { AbstractNum, NumInstance } from "../numbering";
import type { StyleDef } from "../styles";

/** A comment thread entry, as read from comments.xml or written to it. */
export interface DocxComment {
  /** The id the document's commentMark carries. */
  id: string;
  author: string;
  initials?: string;
  /** ISO 8601. */
  date?: string;
  text: string;
  /** Reply to this comment id (commentsExtended.xml). */
  parentId?: string;
  resolved?: boolean;
}

/** Page geometry from the final section (points). Grown doesn't persist
 *  page setup yet (M9), so this is informational on import and defaults
 *  on export. */
export interface PageSetup {
  width: number;
  height: number;
  orientation: "portrait" | "landscape";
  margins: { top: number; right: number; bottom: number; left: number; header?: number; footer?: number };
}

/** The result of reading a .docx: everything needed to seed a Grown doc. */
export interface DocxImport {
  /** TipTap JSON for the body. */
  doc: JSONContent;
  /** Entries for the `styles` Yjs map (style id -> definition). */
  styles: Record<string, StyleDef>;
  /** Entries for the `numbering` Yjs map ("abs:<id>" / "num:<id>"). */
  numbering: Record<string, AbstractNum | NumInstance>;
  /** TipTap JSON for the header / footer fragments (margin schema). */
  header: JSONContent | null;
  footer: JSONContent | null;
  comments: DocxComment[];
  page: PageSetup | null;
  /** Things the reader dropped because Grown has no model for them yet. */
  warnings: string[];
}

/** Namespace-free id for comment marks created by the reader. */
export const importedCommentId = (docxId: string) => `docx-c${docxId}`;
