import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import Collaboration from "@tiptap/extension-collaboration";
import type * as Y from "yjs";

// MarginEditor is a lightweight TipTap editor for page headers and footers. It
// binds to a NAMED Yjs fragment on the shared document ("header" / "footer"),
// so its content syncs and persists through the very same collab hub and update
// log as the body — no extra storage, no extra endpoint. History is disabled
// because Yjs owns undo/redo across the shared doc.

interface MarginEditorProps {
  ydoc: Y.Doc;
  field: "header" | "footer";
  editable: boolean;
  placeholder: string;
}

export function MarginEditor({
  ydoc,
  field,
  editable,
  placeholder,
}: MarginEditorProps) {
  const editor = useEditor(
    {
      editable,
      extensions: [
        StarterKit.configure({ history: false }),
        Underline,
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        Collaboration.configure({ document: ydoc, field }),
      ],
    },
    [ydoc, field],
  );

  return (
    <EditorContent
      editor={editor}
      aria-label={field === "header" ? "Document header" : "Document footer"}
      data-placeholder={placeholder}
      className={`margin-editor margin-editor--${field}`}
    />
  );
}
