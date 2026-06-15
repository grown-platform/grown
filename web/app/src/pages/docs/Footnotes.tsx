import { useEffect, useRef, useState, useCallback } from "react";
import { Box, Typography, Textarea, IconButton } from "@mui/joy";
import DeleteIcon from "@mui/icons-material/Delete";
import type { Editor } from "@tiptap/react";

// Footnotes panel — the numbered notes that sit at the bottom of the page,
// matching the [n] markers in the body. Numbers follow document order (the same
// order as the CSS-counter markers). Editing a note writes its text back into
// the corresponding footnote node; the body and exports stay in sync.

interface FootnoteItem {
  id: string;
  content: string;
  pos: number;
}

function extractFootnotes(editor: Editor): FootnoteItem[] {
  const items: FootnoteItem[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "footnote") {
      items.push({
        id: (node.attrs.id as string) || `pos-${pos}`,
        content: (node.attrs.content as string) || "",
        pos,
      });
    }
    return true;
  });
  return items;
}

interface FootnotesProps {
  editor: Editor | null;
}

export function Footnotes({ editor }: FootnotesProps) {
  const [items, setItems] = useState<FootnoteItem[]>([]);
  const prevCount = useRef(0);
  const refs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const refresh = useCallback(() => {
    if (!editor) return;
    setItems(extractFootnotes(editor));
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    refresh();
    editor.on("update", refresh);
    return () => {
      editor.off("update", refresh);
    };
  }, [editor, refresh]);

  // When a footnote is newly inserted, focus its note so the user can type
  // immediately (mirrors Google Docs dropping the cursor into the new note).
  useEffect(() => {
    if (items.length > prevCount.current) {
      const last = items[items.length - 1];
      // Defer so the editor's own focus() (from the insert command) settles
      // first, otherwise the cursor stays in the body.
      setTimeout(() => refs.current[last.id]?.focus(), 0);
    }
    prevCount.current = items.length;
  }, [items]);

  if (!editor || items.length === 0) return null;

  const setContent = (id: string, content: string) => {
    editor.commands.setFootnoteContent(id, content);
    // Reflect the change locally without waiting for the editor 'update' round
    // trip, so typing stays smooth.
    setItems((prev) => prev.map((f) => (f.id === id ? { ...f, content } : f)));
  };

  const removeFootnote = (item: FootnoteItem) => {
    editor
      .chain()
      .focus()
      .deleteRange({ from: item.pos, to: item.pos + 1 })
      .run();
  };

  const scrollToMarker = (pos: number) => {
    editor.chain().setTextSelection(pos).focus().scrollIntoView().run();
  };

  return (
    <Box
      sx={{
        mt: 4,
        pt: 1.5,
        borderTop: "1px solid #dadce0",
        color: "#3c4043",
      }}
    >
      <Typography
        level="body-xs"
        sx={{ textTransform: "uppercase", letterSpacing: 0.5, mb: 1, color: "#5f6368" }}
      >
        Footnotes
      </Typography>
      {items.map((f, i) => (
        <Box
          key={f.id}
          sx={{ display: "flex", alignItems: "flex-start", gap: 1, mb: 0.75 }}
        >
          <Typography
            level="body-sm"
            onClick={() => scrollToMarker(f.pos)}
            sx={{
              cursor: "pointer",
              color: "#1a73e8",
              fontWeight: 600,
              minWidth: 24,
              textAlign: "right",
              pt: "6px",
            }}
            title="Go to reference"
          >
            {i + 1}.
          </Typography>
          <Textarea
            slotProps={{
              textarea: {
                ref: (el: HTMLTextAreaElement | null) => {
                  refs.current[f.id] = el;
                },
                "aria-label": `Footnote ${i + 1}`,
              },
            }}
            value={f.content}
            onChange={(e) => setContent(f.id, e.target.value)}
            placeholder="Footnote text…"
            minRows={1}
            variant="plain"
            sx={{
              flex: 1,
              fontSize: "0.85rem",
              "--Textarea-focusedThickness": "1px",
              bgcolor: "transparent",
            }}
          />
          <IconButton
            size="sm"
            variant="plain"
            color="neutral"
            onClick={() => removeFootnote(f)}
            aria-label={`Delete footnote ${i + 1}`}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      ))}
    </Box>
  );
}
