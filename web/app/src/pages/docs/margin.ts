// The header/footer (margin) editor's schema, shared by MarginEditor and
// the DOCX reader/writer, which convert the `header` / `footer` Yjs
// fragments to and from ProseMirror documents.
import { getSchema, type Extensions } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import { DeletionMark, FormatChangeMark, InsertionMark, TrackParagraphs } from "./suggesting";

/** The extensions MarginEditor uses (minus Collaboration and the
 *  Suggesting plugin). Tracked-change marks and paragraph attributes are
 *  part of the schema so changes in headers and footers can be tracked. */
export function marginExtensions(): Extensions {
  return [
    StarterKit.configure({ history: false }),
    Underline,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    InsertionMark,
    DeletionMark,
    FormatChangeMark,
    TrackParagraphs,
  ];
}

let schema: Schema | null = null;

export function marginSchema(): Schema {
  return (schema ??= getSchema(marginExtensions()));
}
