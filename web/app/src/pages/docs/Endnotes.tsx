import { useEffect, useRef, useState, useCallback } from "react";
import { Box, Typography, Textarea, IconButton } from "@mui/joy";
import DeleteIcon from "@mui/icons-material/Delete";
import type { Editor } from "@tiptap/react";

// Endnotes panel — the numbered notes collected at the very END of the document
// (after any footnotes), matching the [i],[ii],… markers in the body. Mirrors
// the Footnotes panel but targets the `endnote` node and lower-roman numbering.

interface EndnoteItem {
  id: string;
  content: string;
  pos: number;
}

const ROMAN: [number, string][] = [
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];
function toRoman(n: number): string {
  let out = "";
  let v = n;
  for (const [val, sym] of ROMAN) {
    while (v >= val) {
      out += sym;
      v -= val;
    }
  }
  return out;
}

function extractEndnotes(editor: Editor): EndnoteItem[] {
  const items: EndnoteItem[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "endnote") {
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

interface EndnotesProps {
  editor: Editor | null;
}

export function Endnotes({ editor }: EndnotesProps) {
  const [items, setItems] = useState<EndnoteItem[]>([]);
  const prevCount = useRef(0);
  const refs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const refresh = useCallback(() => {
    if (!editor) return;
    setItems(extractEndnotes(editor));
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    refresh();
    editor.on("update", refresh);
    return () => {
      editor.off("update", refresh);
    };
  }, [editor, refresh]);

  useEffect(() => {
    if (items.length > prevCount.current) {
      const last = items[items.length - 1];
      setTimeout(() => refs.current[last.id]?.focus(), 0);
    }
    prevCount.current = items.length;
  }, [items]);

  if (!editor || items.length === 0) return null;

  const setContent = (id: string, content: string) => {
    editor.commands.setEndnoteContent(id, content);
    setItems((prev) => prev.map((f) => (f.id === id ? { ...f, content } : f)));
  };

  const removeEndnote = (item: EndnoteItem) => {
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
    <Box sx={{ mt: 4, pt: 1.5, borderTop: "1px solid #dadce0", color: "#3c4043" }}>
      <Typography
        level="body-xs"
        sx={{ textTransform: "uppercase", letterSpacing: 0.5, mb: 1, color: "#5f6368" }}
      >
        Endnotes
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
              minWidth: 28,
              textAlign: "right",
              pt: "6px",
            }}
            title="Go to reference"
          >
            {toRoman(i + 1)}.
          </Typography>
          <Textarea
            slotProps={{
              textarea: {
                ref: (el: HTMLTextAreaElement | null) => {
                  refs.current[f.id] = el;
                },
                "aria-label": `Endnote ${i + 1}`,
              },
            }}
            value={f.content}
            onChange={(e) => setContent(f.id, e.target.value)}
            placeholder="Endnote text…"
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
            onClick={() => removeEndnote(f)}
            aria-label={`Delete endnote ${i + 1}`}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      ))}
    </Box>
  );
}
