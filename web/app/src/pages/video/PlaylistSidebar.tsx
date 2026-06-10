import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemButton,
  IconButton,
  Input,
  Button,
} from "@mui/joy";
import AddIcon from "@mui/icons-material/Add";
import QueueMusicIcon from "@mui/icons-material/QueueMusic";
import DeleteIcon from "@mui/icons-material/Delete";
import {
  listVideoPlaylists,
  createVideoPlaylist,
  deleteVideoPlaylist,
} from "./api";
import type { VideoPlaylist } from "./types";

interface PlaylistSidebarProps {
  selectedId?: string;
}

export function PlaylistSidebar({ selectedId }: PlaylistSidebarProps) {
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState<VideoPlaylist[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    listVideoPlaylists()
      .then(setPlaylists)
      .catch(() => {});
  }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    const pl = await createVideoPlaylist(newName.trim());
    setPlaylists((cur) => [pl, ...cur]);
    setNewName("");
    setCreating(false);
    navigate(`/video/playlist/${pl.id}`);
  }

  async function handleDelete(e: React.MouseEvent, pl: VideoPlaylist) {
    e.stopPropagation();
    if (!window.confirm(`Delete playlist "${pl.name}"?`)) return;
    await deleteVideoPlaylist(pl.id);
    setPlaylists((cur) => cur.filter((x) => x.id !== pl.id));
    if (selectedId === pl.id) navigate("/video");
  }

  return (
    <Box
      sx={{
        width: 200,
        flexShrink: 0,
        borderRight: "1px solid",
        borderColor: "divider",
        pr: 1,
      }}
    >
      <Box
        sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 1.5 }}
      >
        <QueueMusicIcon sx={{ opacity: 0.6, fontSize: 18 }} />
        <Typography level="title-sm" sx={{ flex: 1 }}>
          Playlists
        </Typography>
        <IconButton
          size="sm"
          variant="plain"
          onClick={() => setCreating(true)}
          aria-label="New playlist"
        >
          <AddIcon />
        </IconButton>
      </Box>

      {creating && (
        <Box sx={{ px: 1, pb: 1, display: "flex", gap: 0.5 }}>
          <Input
            size="sm"
            autoFocus
            placeholder="Playlist name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") {
                setCreating(false);
                setNewName("");
              }
            }}
            sx={{ flex: 1 }}
          />
          <Button size="sm" onClick={handleCreate} disabled={!newName.trim()}>
            Add
          </Button>
        </Box>
      )}

      <List size="sm">
        {playlists.map((pl) => (
          <ListItem
            key={pl.id}
            endAction={
              <IconButton
                size="sm"
                variant="plain"
                color="danger"
                onClick={(e) => handleDelete(e, pl)}
                aria-label="Delete playlist"
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            }
          >
            <ListItemButton
              selected={pl.id === selectedId}
              onClick={() => navigate(`/video/playlist/${pl.id}`)}
            >
              <Box sx={{ overflow: "hidden" }}>
                <Typography level="body-sm" noWrap>
                  {pl.name}
                </Typography>
                <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                  {pl.item_count} video{pl.item_count !== 1 ? "s" : ""}
                </Typography>
              </Box>
            </ListItemButton>
          </ListItem>
        ))}
        {playlists.length === 0 && !creating && (
          <ListItem>
            <Typography level="body-xs" sx={{ opacity: 0.5, px: 1 }}>
              No playlists yet
            </Typography>
          </ListItem>
        )}
      </List>
    </Box>
  );
}
