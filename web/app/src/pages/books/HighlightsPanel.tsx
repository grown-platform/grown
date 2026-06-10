import { useEffect, useState } from "react";
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemButton,
  IconButton,
  CircularProgress,
  Divider,
  Chip,
} from "@mui/joy";
import DeleteIcon from "@mui/icons-material/Delete";
import { listHighlights, deleteHighlight } from "./api";
import type { Highlight } from "./types";
import { HIGHLIGHT_COLOR_HEX } from "./types";

interface HighlightsPanelProps {
  bookId: string;
  /** Called when the user clicks a highlight to jump to it. */
  onJump: (locator: string) => void;
  /** Incremented externally to trigger a reload when a highlight is added. */
  reloadKey?: number;
}

/**
 * HighlightsPanel lists all highlights for a book and lets the user delete
 * them. It is displayed inside the Reader's left drawer.
 */
export function HighlightsPanel({
  bookId,
  onJump,
  reloadKey,
}: HighlightsPanelProps) {
  const [highlights, setHighlights] = useState<Highlight[] | null>(null);

  async function reload() {
    try {
      setHighlights(await listHighlights(bookId));
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    reload();
  }, [bookId, reloadKey]);

  async function handleDelete(id: string) {
    setHighlights((hs) => (hs ?? []).filter((h) => h.id !== id));
    try {
      await deleteHighlight(bookId, id);
    } catch {
      reload();
    }
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Typography level="title-sm" sx={{ px: 2, pt: 2, pb: 1 }}>
        Highlights
      </Typography>
      <Divider />
      {highlights === null ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
          <CircularProgress size="sm" />
        </Box>
      ) : highlights.length === 0 ? (
        <Typography level="body-sm" sx={{ px: 2, py: 2, opacity: 0.6 }}>
          No highlights yet. Select text in the reader and choose Highlight.
        </Typography>
      ) : (
        <List size="sm" sx={{ overflow: "auto", flex: 1 }}>
          {highlights.map((h) => (
            <ListItem
              key={h.id}
              endAction={
                <IconButton
                  size="sm"
                  variant="plain"
                  color="neutral"
                  aria-label="Delete highlight"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(h.id);
                  }}
                >
                  <DeleteIcon sx={{ fontSize: 16 }} />
                </IconButton>
              }
            >
              <ListItemButton onClick={() => onJump(h.locator)}>
                <Box>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.5,
                      mb: 0.25,
                    }}
                  >
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        borderRadius: 2,
                        bgcolor: HIGHLIGHT_COLOR_HEX[h.color] ?? "#FFF176",
                        flexShrink: 0,
                      }}
                    />
                    <Chip size="sm" variant="soft" sx={{ fontSize: 10 }}>
                      {h.color}
                    </Chip>
                  </Box>
                  <Typography level="body-sm" sx={{ fontStyle: "italic" }}>
                    "
                    {h.selected_text.length > 80
                      ? h.selected_text.slice(0, 80) + "…"
                      : h.selected_text}
                    "
                  </Typography>
                  {h.note && (
                    <Typography level="body-xs" sx={{ opacity: 0.7, mt: 0.25 }}>
                      {h.note}
                    </Typography>
                  )}
                </Box>
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  );
}
