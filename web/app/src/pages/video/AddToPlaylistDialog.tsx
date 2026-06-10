import { useEffect, useState } from "react";
import {
  Modal,
  ModalDialog,
  ModalClose,
  Typography,
  Box,
  Button,
  List,
  ListItem,
  ListItemButton,
  Input,
  CircularProgress,
} from "@mui/joy";
import AddIcon from "@mui/icons-material/Add";
import {
  listVideoPlaylists,
  createVideoPlaylist,
  addToVideoPlaylist,
} from "./api";
import type { VideoPlaylist } from "./types";

interface AddToPlaylistDialogProps {
  videoId: string;
  onClose: () => void;
}

export function AddToPlaylistDialog({
  videoId,
  onClose,
}: AddToPlaylistDialogProps) {
  const [playlists, setPlaylists] = useState<VideoPlaylist[] | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    listVideoPlaylists()
      .then(setPlaylists)
      .catch(() => setPlaylists([]));
  }, []);

  async function handleAdd(playlistId: string) {
    setAdding(playlistId);
    try {
      await addToVideoPlaylist(playlistId, videoId);
    } finally {
      setAdding(null);
    }
    onClose();
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const pl = await createVideoPlaylist(newName.trim());
      await addToVideoPlaylist(pl.id, videoId);
    } finally {
      setCreating(false);
    }
    onClose();
  }

  return (
    <Modal open onClose={onClose}>
      <ModalDialog
        sx={{
          width: { xs: "100vw", sm: 400 },
          maxWidth: "100vw",
          borderRadius: { xs: 0, sm: "md" },
        }}
      >
        <ModalClose />
        <Typography level="h4">Add to playlist</Typography>
        {playlists === null ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            {playlists.length > 0 && (
              <List sx={{ mt: 1, maxHeight: 240, overflow: "auto" }}>
                {playlists.map((pl) => (
                  <ListItem key={pl.id}>
                    <ListItemButton
                      onClick={() => handleAdd(pl.id)}
                      disabled={adding === pl.id}
                    >
                      <Box sx={{ flex: 1 }}>
                        <Typography level="body-sm">{pl.name}</Typography>
                        <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                          {pl.item_count} video{pl.item_count !== 1 ? "s" : ""}
                        </Typography>
                      </Box>
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            )}
            <Box sx={{ display: "flex", gap: 1, mt: 2, alignItems: "center" }}>
              <Input
                size="sm"
                placeholder="New playlist name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
                sx={{ flex: 1 }}
              />
              <Button
                size="sm"
                startDecorator={<AddIcon />}
                onClick={handleCreate}
                disabled={!newName.trim()}
                loading={creating}
              >
                Create &amp; add
              </Button>
            </Box>
          </>
        )}
      </ModalDialog>
    </Modal>
  );
}
