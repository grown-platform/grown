import { useEffect, useRef, useState } from "react";
import {
  Modal,
  ModalDialog,
  ModalClose,
  Typography,
  Box,
  Button,
  Input,
  Textarea,
  FormControl,
  FormLabel,
  List,
  ListItem,
  ListItemButton,
  ListDivider,
  CircularProgress,
  Sheet,
} from "@mui/joy";
import AddIcon from "@mui/icons-material/Add";
import type { Track, Playlist } from "./types";

interface TrackEditDialogProps {
  track: Track;
  onClose: () => void;
  onSave: (input: { title: string; artist: string; album: string }) => void;
}

/** TrackEditDialog edits a track's title/artist/album. */
export function TrackEditDialog({
  track,
  onClose,
  onSave,
}: TrackEditDialogProps) {
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist);
  const [album, setAlbum] = useState(track.album);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const save = () =>
    onSave({ title: title.trim(), artist: artist.trim(), album: album.trim() });
  return (
    <Modal open onClose={onClose}>
      <ModalDialog
        sx={{
          width: { xs: "100vw", sm: 460 },
          maxWidth: "100vw",
          borderRadius: { xs: 0, sm: "md" },
        }}
      >
        <ModalClose />
        <Typography level="h4">Edit track</Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mt: 1 }}>
          <FormControl>
            <FormLabel>Title</FormLabel>
            <Input
              slotProps={{ input: { ref: inputRef } }}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
              }}
            />
          </FormControl>
          <FormControl>
            <FormLabel>Artist</FormLabel>
            <Input value={artist} onChange={(e) => setArtist(e.target.value)} />
          </FormControl>
          <FormControl>
            <FormLabel>Album</FormLabel>
            <Input value={album} onChange={(e) => setAlbum(e.target.value)} />
          </FormControl>
        </Box>
        <Box
          sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 2 }}
        >
          <Button variant="plain" color="neutral" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}

interface PlaylistFormDialogProps {
  /** When editing, the existing playlist; omit to create a new one. */
  playlist?: Playlist;
  onClose: () => void;
  onSave: (input: { name: string; description: string }) => void;
}

/** PlaylistFormDialog creates or edits a playlist's name/description. */
export function PlaylistFormDialog({
  playlist,
  onClose,
  onSave,
}: PlaylistFormDialogProps) {
  const [name, setName] = useState(playlist?.name ?? "");
  const [description, setDescription] = useState(playlist?.description ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const save = () => {
    if (name.trim())
      onSave({ name: name.trim(), description: description.trim() });
  };
  return (
    <Modal open onClose={onClose}>
      <ModalDialog
        sx={{
          width: { xs: "100vw", sm: 460 },
          maxWidth: "100vw",
          borderRadius: { xs: 0, sm: "md" },
        }}
      >
        <ModalClose />
        <Typography level="h4">
          {playlist ? "Edit playlist" : "New playlist"}
        </Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mt: 1 }}>
          <FormControl>
            <FormLabel>Name</FormLabel>
            <Input
              slotProps={{ input: { ref: inputRef } }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My playlist"
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
              }}
            />
          </FormControl>
          <FormControl>
            <FormLabel>Description</FormLabel>
            <Textarea
              minRows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </FormControl>
        </Box>
        <Box
          sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 2 }}
        >
          <Button variant="plain" color="neutral" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!name.trim()}>
            {playlist ? "Save" : "Create"}
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}

interface AddToPlaylistDialogProps {
  /** The track being added. */
  trackTitle: string;
  playlists: Playlist[] | null;
  /** Add the track to an existing playlist by id. */
  onAdd: (playlistId: string) => void;
  /** Create a new playlist (then the caller adds the track to it). */
  onCreateNew: () => void;
  onClose: () => void;
}

/** AddToPlaylistDialog lists the org's playlists to add the chosen track to,
 *  plus a "New playlist" affordance. */
export function AddToPlaylistDialog({
  trackTitle,
  playlists,
  onAdd,
  onCreateNew,
  onClose,
}: AddToPlaylistDialogProps) {
  return (
    <Modal open onClose={onClose}>
      <ModalDialog
        sx={{
          width: { xs: "100vw", sm: 420 },
          maxWidth: "100vw",
          borderRadius: { xs: 0, sm: "md" },
        }}
      >
        <ModalClose />
        <Typography level="h4">Add to playlist</Typography>
        <Typography level="body-sm" sx={{ opacity: 0.7 }} noWrap>
          {trackTitle}
        </Typography>
        <Box sx={{ mt: 1.5, maxHeight: "50vh", overflow: "auto" }}>
          {playlists === null ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
              <CircularProgress size="sm" />
            </Box>
          ) : (
            <List>
              <ListItem>
                <ListItemButton onClick={onCreateNew}>
                  <AddIcon /> New playlist…
                </ListItemButton>
              </ListItem>
              {playlists.length > 0 && <ListDivider />}
              {playlists.map((pl) => (
                <ListItem key={pl.id}>
                  <ListItemButton onClick={() => onAdd(pl.id)}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography level="body-sm" noWrap>
                        {pl.name || "Untitled playlist"}
                      </Typography>
                      <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                        {pl.track_count} track{pl.track_count === 1 ? "" : "s"}
                      </Typography>
                    </Box>
                  </ListItemButton>
                </ListItem>
              ))}
              {playlists.length === 0 && (
                <Sheet
                  variant="soft"
                  sx={{ p: 2, borderRadius: "md", textAlign: "center", mt: 1 }}
                >
                  <Typography level="body-sm" sx={{ opacity: 0.7 }}>
                    No playlists yet — create one above.
                  </Typography>
                </Sheet>
              )}
            </List>
          )}
        </Box>
      </ModalDialog>
    </Modal>
  );
}
