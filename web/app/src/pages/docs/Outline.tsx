import { useEffect, useState, useCallback } from "react";
import { Sheet, Box, Typography, IconButton } from "@mui/joy";
import CloseIcon from "@mui/icons-material/Close";
import type { Editor } from "@tiptap/react";

// Outline / table-of-contents pane. Walks the document for heading nodes and
// renders a clickable, live-updating navigation tree — the equivalent of Google
// Docs' document outline. Purely derived from the editor state; nothing to
// persist.

interface HeadingItem {
  level: number;
  text: string;
  pos: number;
}

function extractHeadings(editor: Editor): HeadingItem[] {
  const items: HeadingItem[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      const text = node.textContent.trim();
      items.push({
        level: (node.attrs.level as number) || 1,
        text: text || "(untitled heading)",
        pos,
      });
    }
    return true;
  });
  return items;
}

interface OutlineProps {
  editor: Editor | null;
  onClose: () => void;
}

export function Outline({ editor, onClose }: OutlineProps) {
  const [items, setItems] = useState<HeadingItem[]>([]);
  const [activePos, setActivePos] = useState<number | null>(null);

  const recompute = useCallback(() => {
    if (!editor) return;
    const heads = extractHeadings(editor);
    setItems(heads);
    // Active = the last heading at or before the cursor position.
    const sel = editor.state.selection.from;
    let active: number | null = null;
    for (const h of heads) {
      if (h.pos < sel) active = h.pos;
      else break;
    }
    setActivePos(active);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    recompute();
    editor.on("update", recompute);
    editor.on("selectionUpdate", recompute);
    return () => {
      editor.off("update", recompute);
      editor.off("selectionUpdate", recompute);
    };
  }, [editor, recompute]);

  const goTo = (pos: number) => {
    if (!editor) return;
    editor.chain().setTextSelection(pos + 1).focus().scrollIntoView().run();
  };

  return (
    <Sheet
      variant="outlined"
      sx={{
        width: 250,
        flexShrink: 0,
        p: 1.5,
        alignSelf: "flex-start",
        position: "sticky",
        top: 8,
        maxHeight: "calc(100vh - 120px)",
        overflowY: "auto",
        borderRadius: "sm",
        ml: { xs: 0, md: 1 },
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
        <Typography level="title-sm" sx={{ flex: 1 }}>
          Outline
        </Typography>
        <IconButton
          size="sm"
          variant="plain"
          onClick={onClose}
          aria-label="Close outline"
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      {items.length === 0 ? (
        <Typography level="body-xs" sx={{ opacity: 0.6 }}>
          Headings you add to the document will appear here.
        </Typography>
      ) : (
        items.map((h, i) => (
          <Box
            key={`${h.pos}-${i}`}
            onClick={() => goTo(h.pos)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                goTo(h.pos);
              }
            }}
            sx={{
              pl: `${(h.level - 1) * 12 + 8}px`,
              py: 0.4,
              pr: 0.5,
              cursor: "pointer",
              borderRadius: "sm",
              borderLeft: "2px solid",
              borderColor:
                h.pos === activePos ? "primary.solidBg" : "transparent",
              color: h.pos === activePos ? "primary.plainColor" : "text.secondary",
              fontSize: h.level <= 1 ? "0.9rem" : "0.82rem",
              fontWeight: h.level <= 2 ? 600 : 400,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              "&:hover": { bgcolor: "background.level1" },
            }}
            title={h.text}
          >
            {h.text}
          </Box>
        ))
      )}
    </Sheet>
  );
}
