import { useEffect, useState } from "react";
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemButton,
  IconButton,
  Input,
  Button,
  CircularProgress,
  Divider,
} from "@mui/joy";
import BookmarkAddIcon from "@mui/icons-material/BookmarkAdd";
import DeleteIcon from "@mui/icons-material/Delete";
import { addBookmark, listBookmarks, deleteBookmark } from "./api";
import type { Bookmark } from "./types";

interface BookmarksPanelProps {
  bookId: string;
  /** Current reader locator (chapter/page index as a string). */
  currentLocator: string;
  /** Called when the user clicks a bookmark to jump to its position. */
  onJump: (locator: string) => void;
}

/**
 * BookmarksPanel renders a list of named bookmarks for a book and lets the
 * user add/delete them. It is displayed inside the Reader's left drawer.
 */
export function BookmarksPanel({
  bookId,
  currentLocator,
  onJump,
}: BookmarksPanelProps) {
  const [bookmarks, setBookmarks] = useState<Bookmark[] | null>(null);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  async function reload() {
    try {
      setBookmarks(await listBookmarks(bookId));
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    reload();
  }, [bookId]);

  async function handleAdd() {
    if (!label.trim()) return;
    setSaving(true);
    try {
      await addBookmark(bookId, currentLocator, label.trim());
      setLabel("");
      await reload();
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setBookmarks((bms) => (bms ?? []).filter((b) => b.id !== id));
    try {
      await deleteBookmark(bookId, id);
    } catch {
      reload();
    }
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Typography level="title-sm" sx={{ px: 2, pt: 2, pb: 1 }}>
        Bookmarks
      </Typography>
      <Divider />
      {/* Add bookmark form */}
      <Box sx={{ px: 2, py: 1.5, display: "flex", gap: 1 }}>
        <Input
          size="sm"
          placeholder="Label for this position"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          sx={{ flex: 1 }}
        />
        <Button
          size="sm"
          variant="soft"
          startDecorator={<BookmarkAddIcon />}
          loading={saving}
          disabled={!label.trim()}
          onClick={handleAdd}
        >
          Add
        </Button>
      </Box>
      <Divider />
      {/* List */}
      {bookmarks === null ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
          <CircularProgress size="sm" />
        </Box>
      ) : bookmarks.length === 0 ? (
        <Typography level="body-sm" sx={{ px: 2, py: 2, opacity: 0.6 }}>
          No bookmarks yet. Navigate to a position and add one above.
        </Typography>
      ) : (
        <List size="sm" sx={{ overflow: "auto", flex: 1 }}>
          {bookmarks.map((bm) => (
            <ListItem
              key={bm.id}
              endAction={
                <IconButton
                  size="sm"
                  variant="plain"
                  color="neutral"
                  aria-label="Delete bookmark"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(bm.id);
                  }}
                >
                  <DeleteIcon sx={{ fontSize: 16 }} />
                </IconButton>
              }
            >
              <ListItemButton onClick={() => onJump(bm.locator)}>
                <Box>
                  <Typography level="body-sm" fontWeight="md">
                    {bm.label || "Bookmark"}
                  </Typography>
                  <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                    Position {bm.locator}
                  </Typography>
                </Box>
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  );
}
