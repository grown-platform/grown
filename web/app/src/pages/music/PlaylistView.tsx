import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Sheet,
  CircularProgress,
  IconButton,
  Button,
  AspectRatio,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  ListDivider,
} from "@mui/joy";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PlaylistPlayIcon from "@mui/icons-material/PlaylistPlay";
import QueueMusicIcon from "@mui/icons-material/QueueMusic";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import {
  getPlaylist,
  updatePlaylist,
  deletePlaylist,
  removeTrackFromPlaylist,
} from "./api";
import type { Playlist } from "./types";
import { usePlayer } from "./player";
import { useTrackActions } from "./useTrackActions";
import { TrackRow } from "./TrackRow";
import { PlaylistFormDialog } from "./dialogs";

interface PlaylistViewProps {
  user: User;
}

export function PlaylistView({ user }: PlaylistViewProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const player = usePlayer();
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const trackActions = useTrackActions({
    onTrackUpdated: (t) =>
      setPlaylist((cur) =>
        cur
          ? {
              ...cur,
              tracks: cur.tracks.map((x) =>
                x.id === t.id ? { ...x, ...t } : x,
              ),
            }
          : cur,
      ),
    onTrackDeleted: (tid) =>
      setPlaylist((cur) =>
        cur
          ? {
              ...cur,
              tracks: cur.tracks.filter((x) => x.id !== tid),
              track_count: cur.track_count - 1,
            }
          : cur,
      ),
    onTrackLikeToggled: (tid, liked) =>
      setPlaylist((cur) =>
        cur
          ? {
              ...cur,
              tracks: cur.tracks.map((x) =>
                x.id === tid ? { ...x, liked } : x,
              ),
            }
          : cur,
      ),
  });

  useEffect(() => {
    let cancelled = false;
    if (!id) return;
    setPlaylist(null);
    setError(null);
    getPlaylist(id)
      .then((p) => {
        if (!cancelled) setPlaylist(p);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  function playAll(startIndex = 0) {
    if (playlist && playlist.tracks.length > 0)
      player.playQueue(playlist.tracks, startIndex);
  }

  async function saveEdit(input: { name: string; description: string }) {
    if (!playlist) return;
    setEditing(false);
    setPlaylist((cur) => (cur ? { ...cur, ...input } : cur));
    try {
      await updatePlaylist(playlist.id, input);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function removePlaylist() {
    if (!playlist) return;
    if (
      !window.confirm(
        `Delete playlist "${playlist.name || "this playlist"}"? The tracks themselves are kept.`,
      )
    )
      return;
    try {
      await deletePlaylist(playlist.id);
      navigate("/music");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function removeTrack(trackId: string) {
    if (!playlist) return;
    setPlaylist((cur) =>
      cur
        ? {
            ...cur,
            tracks: cur.tracks.filter((t) => t.id !== trackId),
            track_count: cur.track_count - 1,
          }
        : cur,
    );
    try {
      await removeTrackFromPlaylist(playlist.id, trackId);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const anyError = error ?? trackActions.error;

  return (
    <>
      <Header user={user} />
      <Container
        maxWidth="md"
        sx={{ py: { xs: 2, sm: 4 }, pb: 14, px: { xs: 1.5, sm: 3 } }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
          <IconButton
            variant="plain"
            onClick={() => navigate("/music")}
            aria-label="Back to library"
          >
            <ArrowBackIcon />
          </IconButton>
          <Typography level="body-sm" sx={{ opacity: 0.7 }}>
            Back to library
          </Typography>
        </Box>

        {anyError && (
          <Sheet
            color="danger"
            variant="soft"
            sx={{ p: 2, mb: 2, borderRadius: "md" }}
          >
            <Typography color="danger">
              Something went wrong: {anyError}
            </Typography>
          </Sheet>
        )}

        {!playlist && !error && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
            <CircularProgress />
          </Box>
        )}

        {playlist && (
          <>
            <Box
              sx={{
                display: "flex",
                gap: 2.5,
                alignItems: "flex-end",
                mb: 3,
                flexDirection: { xs: "column", sm: "row" },
              }}
            >
              <AspectRatio
                ratio="1"
                sx={{
                  width: { xs: "100%", sm: 160 },
                  maxWidth: { xs: 160, sm: "none" },
                  borderRadius: "md",
                  flexShrink: 0,
                  boxShadow: "sm",
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    bgcolor: "neutral.softBg",
                  }}
                >
                  <QueueMusicIcon sx={{ fontSize: 64, opacity: 0.5 }} />
                </Box>
              </AspectRatio>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  level="body-xs"
                  sx={{
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    opacity: 0.6,
                  }}
                >
                  Playlist
                </Typography>
                <Typography level="h2" sx={{ mt: 0.5 }}>
                  {playlist.name || "Untitled playlist"}
                </Typography>
                {playlist.description && (
                  <Typography
                    level="body-sm"
                    sx={{ opacity: 0.7, mt: 0.5, whiteSpace: "pre-wrap" }}
                  >
                    {playlist.description}
                  </Typography>
                )}
                <Typography level="body-xs" sx={{ opacity: 0.6, mt: 0.5 }}>
                  {playlist.track_count} track
                  {playlist.track_count === 1 ? "" : "s"}
                </Typography>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    mt: 1.5,
                  }}
                >
                  <Button
                    variant="solid"
                    color="primary"
                    startDecorator={<PlaylistPlayIcon />}
                    disabled={playlist.tracks.length === 0}
                    onClick={() => playAll(0)}
                  >
                    Play
                  </Button>
                  <Dropdown>
                    <MenuButton
                      slots={{ root: IconButton }}
                      slotProps={{
                        root: {
                          variant: "outlined",
                          color: "neutral",
                          "aria-label": "Playlist actions",
                        },
                      }}
                    >
                      <MoreVertIcon />
                    </MenuButton>
                    <Menu placement="bottom-end">
                      <MenuItem onClick={() => setEditing(true)}>
                        <EditIcon /> Edit details
                      </MenuItem>
                      <ListDivider />
                      <MenuItem color="danger" onClick={removePlaylist}>
                        <DeleteIcon /> Delete playlist
                      </MenuItem>
                    </Menu>
                  </Dropdown>
                </Box>
              </Box>
            </Box>

            {playlist.tracks.length === 0 ? (
              <Sheet
                variant="soft"
                sx={{ p: 6, borderRadius: "md", textAlign: "center" }}
              >
                <QueueMusicIcon sx={{ fontSize: 48, opacity: 0.4 }} />
                <Typography level="body-lg" sx={{ opacity: 0.7, mt: 1 }}>
                  This playlist is empty.
                </Typography>
                <Typography level="body-sm" sx={{ opacity: 0.6, mt: 0.5 }}>
                  Add tracks from the library using the track menu.
                </Typography>
                <Button
                  variant="plain"
                  sx={{ mt: 1.5 }}
                  onClick={() => navigate("/music")}
                >
                  Go to library
                </Button>
              </Sheet>
            ) : (
              <Sheet variant="outlined" sx={{ borderRadius: "md", p: 0.5 }}>
                {playlist.tracks.map((t) => (
                  <TrackRow
                    key={t.id}
                    track={t}
                    active={player.current?.id === t.id}
                    playing={player.playing}
                    onPlay={() => {
                      if (player.current?.id === t.id) player.toggle();
                      else
                        player.playQueue(
                          playlist.tracks,
                          playlist.tracks.indexOf(t),
                        );
                    }}
                    onPlayNext={() => trackActions.actions.playNext(t)}
                    onAddToQueue={() => trackActions.actions.addToQueue(t)}
                    onLike={() => trackActions.actions.toggleLike(t)}
                    onAddToPlaylist={() =>
                      trackActions.actions.addToPlaylist(t)
                    }
                    onDownload={() => trackActions.actions.download(t)}
                    onEdit={() => trackActions.actions.edit(t)}
                    onDelete={() => trackActions.actions.remove(t)}
                    onRemoveFromPlaylist={() => removeTrack(t.id)}
                  />
                ))}
              </Sheet>
            )}
          </>
        )}
      </Container>

      {trackActions.dialogs}

      {editing && playlist && (
        <PlaylistFormDialog
          playlist={playlist}
          onClose={() => setEditing(false)}
          onSave={saveEdit}
        />
      )}
    </>
  );
}
