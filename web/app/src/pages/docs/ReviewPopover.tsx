import { useCallback, useEffect, useState, type RefObject } from "react";
import { Box, Chip, IconButton, Sheet, Tooltip, Typography } from "@mui/joy";
import CheckIcon from "@mui/icons-material/Check";
import ClearIcon from "@mui/icons-material/Clear";
import type { Editor } from "@tiptap/react";
import { changeAt, collectChanges, describeChange, type TrackedChange } from "./changes";
import { formatChangeDate } from "./review";
import type { ReviewSource } from "./Suggestions";

// Review popover (M5): when the caret is inside a tracked change, a small
// card under the line shows who made it and when, what it is, and Accept /
// Reject buttons — like Google Docs' suggestion card and OnlyOffice's
// review balloon.

interface Shown {
  editor: Editor;
  change: TrackedChange;
  top: number;
  left: number;
}

const WIDTH = 280;

export function ReviewPopover({ sources, container, hidden }: { sources: ReviewSource[]; container: RefObject<HTMLElement>; hidden?: boolean }) {
  const [shown, setShown] = useState<Shown | null>(null);

  const update = useCallback(() => {
    const box = container.current;
    let next: Shown | null = null;
    for (const s of sources) {
      const e = s.editor;
      if (!e || e.isDestroyed || !e.isFocused || !box) continue;
      const { from, to } = e.state.selection;
      const c = changeAt(collectChanges(e.state.doc), from, from === to ? from : to);
      if (!c) continue;
      try {
        const at = e.view.coordsAtPos(Math.min(c.from, e.state.doc.content.size));
        const r = box.getBoundingClientRect();
        const left = Math.max(8, Math.min(at.left - r.left, r.width - WIDTH - 8));
        next = { editor: e, change: c, top: at.bottom - r.top + 6, left };
      } catch {
        next = null;
      }
    }
    setShown(next);
  }, [sources, container]);

  useEffect(() => {
    const live = sources.map((s) => s.editor).filter((e): e is Editor => !!e);
    for (const e of live) {
      e.on("selectionUpdate", update);
      e.on("update", update);
      e.on("focus", update);
      e.on("blur", update);
    }
    return () => {
      for (const e of live) {
        e.off("selectionUpdate", update);
        e.off("update", update);
        e.off("focus", update);
        e.off("blur", update);
      }
    };
  }, [sources, update]);

  if (!shown || hidden) return null;
  const { change: c, editor } = shown;
  const initial = (c.author || "?").trim().charAt(0).toUpperCase();
  return (
    <Sheet
      variant="outlined"
      data-testid="review-popover"
      // Keep the editor focused (and the popover open) when clicking in it.
      onMouseDown={(e) => e.preventDefault()}
      sx={{
        position: "absolute",
        top: shown.top,
        left: shown.left,
        width: WIDTH,
        zIndex: 20,
        p: 1,
        borderRadius: "md",
        boxShadow: "md",
        bgcolor: "background.surface",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Box
          sx={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            bgcolor: "primary.solidBg",
            color: "#fff",
            display: "grid",
            placeItems: "center",
            fontSize: 13,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {initial}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography level="title-sm" noWrap data-testid="review-popover-author">
            {c.author || "Unknown"}
          </Typography>
          <Typography level="body-xs" sx={{ opacity: 0.7 }} data-testid="review-popover-date">
            {formatChangeDate(c.date)}
          </Typography>
        </Box>
        <Tooltip title="Accept" size="sm">
          <IconButton size="sm" variant="soft" color="success" aria-label="Accept change" onClick={() => editor.chain().focus().acceptChange(c.id).run()}>
            <CheckIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Reject" size="sm">
          <IconButton size="sm" variant="soft" color="danger" aria-label="Reject change" onClick={() => editor.chain().focus().rejectChange(c.id).run()}>
            <ClearIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ mt: 0.75, display: "flex", gap: 0.5, alignItems: "baseline" }}>
        <Chip size="sm" variant="soft" sx={{ flexShrink: 0 }}>
          {c.kind === "format" ? "Format" : c.kind === "paragraph" ? "Paragraph" : c.kind === "replace" ? "Replace" : c.kind === "insert" ? "Insert" : "Delete"}
        </Chip>
        <Typography level="body-sm" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={describeChange(c)}>
          {describeChange(c)}
        </Typography>
      </Box>
    </Sheet>
  );
}
