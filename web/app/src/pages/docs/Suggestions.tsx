import { useEffect, useState, useCallback } from "react";
import { Sheet, Box, Typography, Button, IconButton, Chip, Divider } from "@mui/joy";
import CloseIcon from "@mui/icons-material/Close";
import CheckIcon from "@mui/icons-material/Check";
import ClearIcon from "@mui/icons-material/Clear";
import type { Editor } from "@tiptap/react";

// Review panel for track-changes ("Suggesting") edits. It walks the document
// for contiguous insertion / deletion runs and renders each as a card with
// per-change Accept / Reject, plus Accept-all / Reject-all.

interface Change {
  kind: "insert" | "delete";
  from: number;
  to: number;
  text: string;
  author: string;
}

function collectChanges(editor: Editor): Change[] {
  const changes: Change[] = [];
  let cur: Change | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) {
      if (cur) {
        changes.push(cur);
        cur = null;
      }
      return;
    }
    const insMark = node.marks.find((m) => m.type.name === "insertion");
    const delMark = node.marks.find((m) => m.type.name === "deletion");
    const kind: "insert" | "delete" | null = insMark
      ? "insert"
      : delMark
        ? "delete"
        : null;
    if (!kind) {
      if (cur) {
        changes.push(cur);
        cur = null;
      }
      return;
    }
    const author = (insMark || delMark)?.attrs.author || "";
    if (cur && cur.kind === kind && cur.to === pos) {
      cur.to = pos + node.nodeSize;
      cur.text += node.text || "";
    } else {
      if (cur) changes.push(cur);
      cur = {
        kind,
        from: pos,
        to: pos + node.nodeSize,
        text: node.text || "",
        author,
      };
    }
  });
  if (cur) changes.push(cur);
  return changes;
}

interface SuggestionsProps {
  editor: Editor | null;
  onClose: () => void;
}

export function Suggestions({ editor, onClose }: SuggestionsProps) {
  const [changes, setChanges] = useState<Change[]>([]);

  const refresh = useCallback(() => {
    if (!editor) return;
    setChanges(collectChanges(editor));
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    refresh();
    editor.on("update", refresh);
    editor.on("selectionUpdate", refresh);
    return () => {
      editor.off("update", refresh);
      editor.off("selectionUpdate", refresh);
    };
  }, [editor, refresh]);

  if (!editor) return null;

  const goTo = (c: Change) =>
    editor.chain().setTextSelection({ from: c.from, to: c.to }).focus().scrollIntoView().run();

  return (
    <Sheet
      variant="outlined"
      sx={{ width: 300, p: 1.5, borderRadius: "sm", height: "100%", overflowY: "auto" }}
    >
      <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
        <Typography level="title-sm" sx={{ flex: 1 }}>
          Suggestions
        </Typography>
        <IconButton size="sm" variant="plain" onClick={onClose} aria-label="Close suggestions">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      {changes.length === 0 ? (
        <Typography level="body-xs" sx={{ opacity: 0.6 }}>
          No suggestions yet. With Suggesting on, your edits appear here for
          review.
        </Typography>
      ) : (
        <>
          <Box sx={{ display: "flex", gap: 1, mb: 1 }}>
            <Button
              size="sm"
              variant="soft"
              color="success"
              fullWidth
              startDecorator={<CheckIcon />}
              onClick={() => editor.chain().focus().acceptAllSuggestions().run()}
            >
              Accept all
            </Button>
            <Button
              size="sm"
              variant="soft"
              color="danger"
              fullWidth
              startDecorator={<ClearIcon />}
              onClick={() => editor.chain().focus().rejectAllSuggestions().run()}
            >
              Reject all
            </Button>
          </Box>
          <Divider sx={{ mb: 1 }} />
          {changes.map((c, i) => (
            <Box
              key={`${c.from}-${i}`}
              sx={{
                mb: 1,
                p: 1,
                borderRadius: "sm",
                bgcolor: "background.level1",
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.5 }}>
                <Chip
                  size="sm"
                  variant="soft"
                  color={c.kind === "insert" ? "success" : "danger"}
                >
                  {c.kind === "insert" ? "Insertion" : "Deletion"}
                </Chip>
                {c.author && (
                  <Typography level="body-xs" sx={{ opacity: 0.7 }}>
                    {c.author}
                  </Typography>
                )}
              </Box>
              <Typography
                level="body-sm"
                onClick={() => goTo(c)}
                sx={{
                  cursor: "pointer",
                  textDecoration: c.kind === "insert" ? "underline" : "line-through",
                  color: c.kind === "insert" ? "#188038" : "#d93025",
                  mb: 0.5,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={c.text}
              >
                {c.text || "(empty)"}
              </Typography>
              <Box sx={{ display: "flex", gap: 0.5 }}>
                <Button
                  size="sm"
                  variant="plain"
                  color="success"
                  onClick={() =>
                    editor.chain().focus().acceptSuggestionRange(c.from, c.to).run()
                  }
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="plain"
                  color="danger"
                  onClick={() =>
                    editor.chain().focus().rejectSuggestionRange(c.from, c.to).run()
                  }
                >
                  Reject
                </Button>
              </Box>
            </Box>
          ))}
        </>
      )}
    </Sheet>
  );
}
