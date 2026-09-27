import { useEffect } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import Collaboration from "@tiptap/extension-collaboration";
import type * as Y from "yjs";
import { marginExtensions } from "./margin";
import { Suggesting, type SuggestUser } from "./suggesting";

// MarginEditor is a lightweight TipTap editor for page headers and footers. It
// binds to a NAMED Yjs fragment on the shared document ("header" / "footer"),
// so its content syncs and persists through the very same collab hub and update
// log as the body — no extra storage, no extra endpoint. History is disabled
// because Yjs owns undo/redo across the shared doc. With `suggesting` on,
// edits are tracked like the body's (M5).

interface MarginEditorProps {
  ydoc: Y.Doc;
  field: "header" | "footer";
  editable: boolean;
  placeholder: string;
  suggesting?: boolean;
  user?: SuggestUser;
  /** Called with the editor once it exists (and null on unmount), so the
   *  review panel can list and resolve changes here. */
  onEditor?: (e: Editor | null) => void;
}

export function MarginEditor({
  ydoc,
  field,
  editable,
  placeholder,
  suggesting = false,
  user,
  onEditor,
}: MarginEditorProps) {
  const editor = useEditor(
    {
      editable,
      extensions: [
        ...marginExtensions(),
        Suggesting.configure({ user: user ?? { name: "", color: "#188038" } }),
        Collaboration.configure({ document: ydoc, field }),
      ],
    },
    [ydoc, field],
  );

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    editor?.commands.setSuggesting(suggesting);
  }, [editor, suggesting]);

  useEffect(() => {
    if (!editor || !onEditor) return;
    onEditor(editor);
    return () => onEditor(null);
  }, [editor, onEditor]);

  return (
    <EditorContent
      editor={editor}
      aria-label={field === "header" ? "Document header" : "Document footer"}
      data-placeholder={placeholder}
      className={`margin-editor margin-editor--${field}`}
    />
  );
}
