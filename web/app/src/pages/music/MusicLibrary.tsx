import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Input,
  Sheet,
  IconButton,
  CircularProgress,
  Button,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  AspectRatio,
  Tabs,
  TabList,
  Tab,
  TabPanel,
} from "@mui/joy";
import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";
import LibraryMusicIcon from "@mui/icons-material/LibraryMusic";
import QueueMusicIcon from "@mui/icons-material/QueueMusic";
import FavoriteIcon from "@mui/icons-material/Favorite";
import PlaylistPlayIcon from "@mui/icons-material/PlaylistPlay";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import {
  listTracks,
  listPlaylists,
  createPlaylist,
  listLikedTracks,
} from "./api";
import type { Track, Playlist } from "./types";
import { usePlayer } from "./player";
import { useTrackActions } from "./useTrackActions";
import { TrackRow } from "./TrackRow";
import { UploadDialog } from "./UploadDialog";
import { PlaylistFormDialog } from "./dialogs";

interface MusicLibraryProps {
  user: User;
}

export function MusicLibrary({ user }: MusicLibraryProps) {
  const navigate = useNavigate();
  const player = usePlayer();
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [likedTracks, setLikedTracks] = useState<Track[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [newPlaylistOpen, setNewPlaylistOpen] = useState(false);

  function applyLikeToggle(trackId: string, liked: boolean) {
    const update = (list: Track[] | null) =>
      list ? list.map((x) => (x.id === trackId ? { ...x, liked } : x)) : list;
    setTracks(update);
    setLikedTracks(
      liked
        ? (cur) => {
            // Add to liked list if not already there.
            const existing = (cur ?? []).find((t) => t.id === trackId);
            if (existing) return update(cur);
            const found = tracks?.find((t) => t.id === trackId);
            return found
              ? [{ ...found, liked: true }, ...(cur ?? [])]
              : update(cur);
          }
        : (cur) => (cur ?? []).filter((t) => t.id !== trackId),
    );
  }

  const trackActions = useTrackActions({
    onTrackUpdated: (t) => {
      setTracks((cur) =>
        (cur ?? []).map((x) => (x.id === t.id ? { ...x, ...t } : x)),
      );
      setLikedTracks((cur) =>
        cur ? cur.map((x) => (x.id === t.id ? { ...x, ...t } : x)) : cur,
      );
    },
    onTrackDeleted: (id) => {
      setTracks((cur) => (cur ?? []).filter((x) => x.id !== id));
      setLikedTracks((cur) => (cur ? cur.filter((x) => x.id !== id) : cur));
      // Track counts on playlist cards may now be stale; refresh lazily.
      reloadPlaylists();
    },
    onTrackLikeToggled: applyLikeToggle,
  });

  async function reloadTracks() {
    try {
      setTracks(await listTracks());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function reloadPlaylists() {
    try {
      setPlaylists(await listPlaylists());
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function reloadLiked() {
    try {
      setLikedTracks(await listLikedTracks());
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    reloadTracks();
    reloadPlaylists();
    reloadLiked();
  }, []);

  const shownTracks = useMemo(() => {
    const list = tracks ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((t) =>
      [t.title, t.artist, t.album].join(" ").toLowerCase().includes(q),
    );
  }, [tracks, query]);

  const shownPlaylists = useMemo(() => {
    const list = playlists ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) =>
      [p.name, p.description].join(" ").toLowerCase().includes(q),
    );
  }, [playlists, query]);

  const shownLiked = useMemo(() => {
    const list = likedTracks ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((t) =>
      [t.title, t.artist, t.album].join(" ").toLowerCase().includes(q),
    );
  }, [likedTracks, query]);

  function playAll(startIndex = 0) {
    if (shownTracks.length > 0) player.playQueue(shownTracks, startIndex);
  }

  async function createNewPlaylist(input: {
    name: string;
    description: string;
  }) {
    setNewPlaylistOpen(false);
    try {
      const pl = await createPlaylist(input);
      setPlaylists((cur) => [pl, ...(cur ?? [])]);
      navigate(`/music/playlists/${pl.id}`);
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
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            mb: 3,
            flexWrap: "wrap",
          }}
        >
          <Typography
            level="h2"
            sx={{ flex: 1, fontSize: { xs: "xl", sm: "xl3" } }}
          >
            Music
          </Typography>
          <Input
            size="sm"
            startDecorator={<SearchIcon />}
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            sx={{
              width: { xs: "100%", sm: 240 },
              order: { xs: 10, sm: "unset" },
            }}
            aria-label="Search music"
          />
          <Button
            variant="solid"
            color="primary"
            startDecorator={<AddIcon />}
            onClick={() => setUploadOpen(true)}
            data-testid="upload-track"
            size="sm"
          >
            Upload
          </Button>
          <Dropdown>
            <MenuButton
              slots={{ root: IconButton }}
              slotProps={{
                root: {
                  variant: "plain",
                  color: "neutral",
                  "aria-label": "Help menu",
                },
              }}
            >
              <HelpOutlineIcon />
            </MenuButton>
            <Menu placement="bottom-end">
              <MenuItem disabled>Supported formats</MenuItem>
              <MenuItem disabled>Help</MenuItem>
              <MenuItem disabled>Send feedback</MenuItem>
            </Menu>
          </Dropdown>
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

        <Tabs defaultValue="tracks" sx={{ bgcolor: "transparent" }}>
          <TabList>
            <Tab value="tracks">Tracks</Tab>
            <Tab value="liked">Liked</Tab>
            <Tab value="playlists">Playlists</Tab>
          </TabList>

          {/* Tracks */}
          <TabPanel value="tracks" sx={{ px: 0 }}>
            {tracks === null && !error && (
              <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
                <CircularProgress />
              </Box>
            )}

            {tracks !== null && shownTracks.length === 0 && (
              <Sheet
                variant="soft"
                sx={{ p: 6, borderRadius: "md", textAlign: "center" }}
              >
                <LibraryMusicIcon sx={{ fontSize: 48, opacity: 0.4 }} />
                <Typography level="body-lg" sx={{ opacity: 0.7, mt: 1 }}>
                  {query ? "No matching tracks." : "No tracks yet."}
                </Typography>
                {!query && (
                  <Button
                    variant="solid"
                    sx={{ mt: 2 }}
                    startDecorator={<AddIcon />}
                    onClick={() => setUploadOpen(true)}
                  >
                    Upload your first track
                  </Button>
                )}
              </Sheet>
            )}

            {shownTracks.length > 0 && (
              <>
                <Box
                  sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}
                >
                  <Button
                    size="sm"
                    variant="soft"
                    startDecorator={<PlaylistPlayIcon />}
                    onClick={() => playAll(0)}
                  >
                    Play all
                  </Button>
                  <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                    {shownTracks.length} track
                    {shownTracks.length === 1 ? "" : "s"}
                  </Typography>
                </Box>
                <Sheet variant="outlined" sx={{ borderRadius: "md", p: 0.5 }}>
                  {shownTracks.map((t) => (
                    <TrackRow
                      key={t.id}
                      track={t}
                      active={player.current?.id === t.id}
                      playing={player.playing}
                      onPlay={() => {
                        if (player.current?.id === t.id) player.toggle();
                        else
                          player.playQueue(shownTracks, shownTracks.indexOf(t));
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
                    />
                  ))}
                </Sheet>
              </>
            )}
          </TabPanel>

          {/* Liked Songs */}
          <TabPanel value="liked" sx={{ px: 0 }}>
            {likedTracks === null && !error && (
              <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
                <CircularProgress />
              </Box>
            )}

            {likedTracks !== null && shownLiked.length === 0 && (
              <Sheet
                variant="soft"
                sx={{ p: 6, borderRadius: "md", textAlign: "center" }}
              >
                <FavoriteIcon
                  sx={{ fontSize: 48, opacity: 0.4, color: "danger.400" }}
                />
                <Typography level="body-lg" sx={{ opacity: 0.7, mt: 1 }}>
                  {query ? "No matching liked tracks." : "No liked tracks yet."}
                </Typography>
                {!query && (
                  <Typography level="body-sm" sx={{ opacity: 0.6, mt: 0.5 }}>
                    Heart a track to add it here.
                  </Typography>
                )}
              </Sheet>
            )}

            {shownLiked.length > 0 && (
              <>
                <Box
                  sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}
                >
                  <Button
                    size="sm"
                    variant="soft"
                    startDecorator={<PlaylistPlayIcon />}
                    onClick={() => player.playQueue(shownLiked, 0)}
                  >
                    Play all
                  </Button>
                  <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                    {shownLiked.length} track
                    {shownLiked.length === 1 ? "" : "s"}
                  </Typography>
                </Box>
                <Sheet variant="outlined" sx={{ borderRadius: "md", p: 0.5 }}>
                  {shownLiked.map((t) => (
                    <TrackRow
                      key={t.id}
                      track={t}
                      active={player.current?.id === t.id}
                      playing={player.playing}
                      onPlay={() => {
                        if (player.current?.id === t.id) player.toggle();
                        else
                          player.playQueue(shownLiked, shownLiked.indexOf(t));
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
                    />
                  ))}
                </Sheet>
              </>
            )}
          </TabPanel>

          {/* Playlists */}
          <TabPanel value="playlists" sx={{ px: 0 }}>
            <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}>
              <Button
                size="sm"
                variant="soft"
                startDecorator={<AddIcon />}
                onClick={() => setNewPlaylistOpen(true)}
                data-testid="new-playlist"
              >
                New playlist
              </Button>
            </Box>

            {playlists === null && !error && (
              <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
                <CircularProgress />
              </Box>
            )}

            {playlists !== null && shownPlaylists.length === 0 && (
              <Sheet
                variant="soft"
                sx={{ p: 6, borderRadius: "md", textAlign: "center" }}
              >
                <QueueMusicIcon sx={{ fontSize: 48, opacity: 0.4 }} />
                <Typography level="body-lg" sx={{ opacity: 0.7, mt: 1 }}>
                  {query ? "No matching playlists." : "No playlists yet."}
                </Typography>
                {!query && (
                  <Button
                    variant="solid"
                    sx={{ mt: 2 }}
                    startDecorator={<AddIcon />}
                    onClick={() => setNewPlaylistOpen(true)}
                  >
                    Create a playlist
                  </Button>
                )}
              </Sheet>
            )}

            {shownPlaylists.length > 0 && (
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                  gap: 2,
                }}
              >
                {shownPlaylists.map((pl) => (
                  <Sheet
                    key={pl.id}
                    variant="outlined"
                    data-testid={`playlist-${pl.id}`}
                    onClick={() => navigate(`/music/playlists/${pl.id}`)}
                    sx={{
                      borderRadius: "md",
                      overflow: "hidden",
                      cursor: "pointer",
                      transition: "box-shadow 120ms",
                      "&:hover": { boxShadow: "md" },
                    }}
                  >
                    <AspectRatio ratio="1">
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          bgcolor: "neutral.softBg",
                        }}
                      >
                        <QueueMusicIcon sx={{ fontSize: 40, opacity: 0.5 }} />
                      </Box>
                    </AspectRatio>
                    <Box sx={{ p: 1.25 }}>
                      <Typography
                        level="body-sm"
                        sx={{ fontWeight: 500 }}
                        noWrap
                      >
                        {pl.name || "Untitled playlist"}
                      </Typography>
                      <Typography level="body-xs" sx={{ opacity: 0.65 }} noWrap>
                        {pl.track_count} track{pl.track_count === 1 ? "" : "s"}
                      </Typography>
                    </Box>
                  </Sheet>
                ))}
              </Box>
            )}
          </TabPanel>
        </Tabs>
      </Container>

      {trackActions.dialogs}

      {uploadOpen && (
        <UploadDialog
          onClose={() => setUploadOpen(false)}
          onUploaded={(t) => {
            setUploadOpen(false);
            setTracks((cur) => [t, ...(cur ?? [])]);
          }}
        />
      )}

      {newPlaylistOpen && (
        <PlaylistFormDialog
          onClose={() => setNewPlaylistOpen(false)}
          onSave={createNewPlaylist}
        />
      )}
    </>
  );
}
