import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Input,
  Sheet,
  IconButton,
  CircularProgress,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  ListDivider,
  AspectRatio,
  Button,
  Modal,
  ModalDialog,
  ModalClose,
  FormControl,
  FormLabel,
  Textarea,
} from "@mui/joy";
import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";
import MovieIcon from "@mui/icons-material/Movie";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import ShareIcon from "@mui/icons-material/Share";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import PlaylistAddIcon from "@mui/icons-material/PlaylistAdd";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import LinearProgress from "@mui/joy/LinearProgress";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import { listVideos, deleteVideo, updateVideo, downloadUrl } from "./api";
import type { Video } from "./types";
import { formatDuration, formatBytes } from "./media";
import { UploadDialog } from "./UploadDialog";
import { VideoShareDialog } from "./VideoShareDialog";
import { AddToPlaylistDialog } from "./AddToPlaylistDialog";
import { PlaylistSidebar } from "./PlaylistSidebar";

interface VideoLibraryProps {
  user: User;
}

export function VideoLibrary({ user }: VideoLibraryProps) {
  const navigate = useNavigate();
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState<Video | null>(null);
  const [sharing, setSharing] = useState<Video | null>(null);
  // Context-menu anchor for right-click on a card.
  const [ctx, setCtx] = useState<{ video: Video; x: number; y: number } | null>(
    null,
  );
  const [addingToPlaylist, setAddingToPlaylist] = useState<Video | null>(null);

  async function reload() {
    try {
      setVideos(await listVideos());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    reload();
  }, []);

  const shown = useMemo(() => {
    const list = videos ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((v) =>
      [v.title, v.description].join(" ").toLowerCase().includes(q),
    );
  }, [videos, query]);

  function play(v: Video) {
    navigate(`/video/v/${v.id}`);
  }
  function download(v: Video) {
    window.open(downloadUrl(v.id), "_blank");
  }

  async function remove(v: Video) {
    if (
      !window.confirm(
        `Delete "${v.title || "this video"}"? This can't be undone.`,
      )
    )
      return;
    setVideos((cur) => (cur ?? []).filter((x) => x.id !== v.id));
    try {
      await deleteVideo(v.id);
    } catch {
      reload();
    }
  }

  async function saveEdit(input: { title: string; description: string }) {
    if (!editing) return;
    const id = editing.id;
    setVideos((cur) =>
      (cur ?? []).map((x) => (x.id === id ? { ...x, ...input } : x)),
    );
    setEditing(null);
    try {
      await updateVideo(id, input);
    } catch {
      reload();
    }
  }

  return (
    <>
      <Header user={user} />
      <Container
        maxWidth="xl"
        sx={{ py: { xs: 2, sm: 4 }, px: { xs: 1.5, sm: 3 } }}
      >
        <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start" }}>
          <PlaylistSidebar />
          <Box sx={{ flex: 1, minWidth: 0 }}>
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
                Video
              </Typography>
              <Input
                size="sm"
                startDecorator={<SearchIcon />}
                placeholder="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                sx={{
                  width: { xs: "100%", sm: 260 },
                  order: { xs: 10, sm: "unset" },
                }}
              />
              <Button
                variant="solid"
                color="primary"
                startDecorator={<AddIcon />}
                onClick={() => setUploadOpen(true)}
                data-testid="upload-video"
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

            {error && (
              <Sheet
                color="danger"
                variant="soft"
                sx={{ p: 2, mb: 2, borderRadius: "md" }}
              >
                <Typography color="danger">
                  Couldn’t load videos: {error}
                </Typography>
              </Sheet>
            )}

            {videos === null && !error && (
              <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
                <CircularProgress />
              </Box>
            )}

            {videos !== null && shown.length === 0 && (
              <Sheet
                variant="soft"
                sx={{ p: 6, borderRadius: "md", textAlign: "center" }}
              >
                <MovieIcon sx={{ fontSize: 48, opacity: 0.4 }} />
                <Typography level="body-lg" sx={{ opacity: 0.7, mt: 1 }}>
                  {query ? "No matching videos." : "No videos yet."}
                </Typography>
                {!query && (
                  <Button
                    variant="solid"
                    sx={{ mt: 2 }}
                    startDecorator={<AddIcon />}
                    onClick={() => setUploadOpen(true)}
                  >
                    Upload your first video
                  </Button>
                )}
              </Sheet>
            )}

            {shown.length > 0 && (
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                  gap: 2,
                }}
              >
                {shown.map((v) => (
                  <VideoCard
                    key={v.id}
                    video={v}
                    onPlay={() => play(v)}
                    onDownload={() => download(v)}
                    onRename={() => setEditing(v)}
                    onShare={() => setSharing(v)}
                    onDelete={() => remove(v)}
                    onAddToPlaylist={() => setAddingToPlaylist(v)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setCtx({ video: v, x: e.clientX, y: e.clientY });
                    }}
                  />
                ))}
              </Box>
            )}

            {videos !== null && shown.length > 0 && (
              <Typography level="body-xs" sx={{ opacity: 0.6, mt: 2 }}>
                {shown.length} video{shown.length === 1 ? "" : "s"}
              </Typography>
            )}

            {uploadOpen && (
              <UploadDialog
                onClose={() => setUploadOpen(false)}
                onUploaded={(v) => {
                  setUploadOpen(false);
                  setVideos((cur) => [v, ...(cur ?? [])]);
                }}
              />
            )}

            {editing && (
              <RenameDialog
                video={editing}
                onClose={() => setEditing(null)}
                onSave={saveEdit}
              />
            )}

            {sharing && (
              <VideoShareDialog
                open
                onClose={() => setSharing(null)}
                videoId={sharing.id}
                videoTitle={sharing.title || "Untitled video"}
              />
            )}

            {/* Right-click context menu, positioned at the cursor. */}
            {ctx && (
              <Dropdown
                open
                onOpenChange={(_, open) => {
                  if (!open) setCtx(null);
                }}
              >
                <Menu
                  open
                  onClose={() => setCtx(null)}
                  anchorEl={{
                    getBoundingClientRect: () =>
                      ({
                        x: ctx.x,
                        y: ctx.y,
                        top: ctx.y,
                        left: ctx.x,
                        right: ctx.x,
                        bottom: ctx.y,
                        width: 0,
                        height: 0,
                        toJSON: () => "",
                      }) as DOMRect,
                  }}
                  size="sm"
                >
                  <MenuItem
                    onClick={() => {
                      play(ctx.video);
                      setCtx(null);
                    }}
                  >
                    <PlayArrowIcon /> Play
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      download(ctx.video);
                      setCtx(null);
                    }}
                  >
                    <DownloadIcon /> Download
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setEditing(ctx.video);
                      setCtx(null);
                    }}
                  >
                    <EditIcon /> Rename
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setSharing(ctx.video);
                      setCtx(null);
                    }}
                  >
                    <ShareIcon /> Share
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setAddingToPlaylist(ctx.video);
                      setCtx(null);
                    }}
                  >
                    <PlaylistAddIcon /> Add to playlist
                  </MenuItem>
                  <ListDivider />
                  <MenuItem
                    color="danger"
                    onClick={() => {
                      remove(ctx.video);
                      setCtx(null);
                    }}
                  >
                    <DeleteIcon /> Delete
                  </MenuItem>
                </Menu>
              </Dropdown>
            )}

            {addingToPlaylist && (
              <AddToPlaylistDialog
                videoId={addingToPlaylist.id}
                onClose={() => setAddingToPlaylist(null)}
              />
            )}
          </Box>
          {/* inner content box */}
        </Box>
        {/* sidebar + content flex */}
      </Container>
    </>
  );
}

interface VideoCardProps {
  video: Video;
  onPlay: () => void;
  onDownload: () => void;
  onRename: () => void;
  onShare: () => void;
  onDelete: () => void;
  onAddToPlaylist: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function VideoCard({
  video,
  onPlay,
  onDownload,
  onRename,
  onShare,
  onDelete,
  onAddToPlaylist,
  onContextMenu,
}: VideoCardProps) {
  return (
    <Sheet
      variant="outlined"
      data-testid={`video-${video.id}`}
      onContextMenu={onContextMenu}
      sx={{
        borderRadius: "md",
        overflow: "hidden",
        cursor: "pointer",
        transition: "box-shadow 120ms, transform 120ms",
        "&:hover": { boxShadow: "md" },
        "&:hover .card-menu": { opacity: 1 },
        "&:hover .play-overlay": { opacity: 1 },
      }}
      onClick={onPlay}
    >
      <Box sx={{ position: "relative" }}>
        <AspectRatio ratio="16/9">
          {video.thumbnail_data_url ? (
            <img
              src={video.thumbnail_data_url}
              alt={video.title}
              loading="lazy"
            />
          ) : (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                bgcolor: "neutral.softBg",
              }}
            >
              <MovieIcon sx={{ fontSize: 36, opacity: 0.5 }} />
            </Box>
          )}
        </AspectRatio>
        <Box
          className="play-overlay"
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: "rgba(0,0,0,0.25)",
            opacity: 0,
            transition: "opacity 120ms",
          }}
        >
          <PlayArrowIcon sx={{ fontSize: 48, color: "#fff" }} />
        </Box>
        {video.duration_seconds > 0 && (
          <Typography
            level="body-xs"
            sx={{
              position: "absolute",
              bottom: 6,
              right: 6,
              px: 0.75,
              py: 0.25,
              borderRadius: "sm",
              bgcolor: "rgba(0,0,0,0.7)",
              color: "#fff",
            }}
          >
            {formatDuration(video.duration_seconds)}
          </Typography>
        )}
        {(video.progress_percent ?? 0) > 0 && !video.watched && (
          <Box sx={{ position: "absolute", bottom: 0, left: 0, right: 0 }}>
            <LinearProgress
              determinate
              value={Math.round((video.progress_percent ?? 0) * 100)}
              sx={{ borderRadius: 0, "--LinearProgress-thickness": "3px" }}
            />
          </Box>
        )}
        {video.watched && (
          <CheckCircleIcon
            sx={{
              position: "absolute",
              bottom: 6,
              left: 6,
              fontSize: 18,
              color: "#4caf50",
              filter: "drop-shadow(0 0 2px rgba(0,0,0,0.7))",
            }}
          />
        )}
        <Box
          className="card-menu"
          sx={{
            position: "absolute",
            top: 4,
            right: 4,
            opacity: { xs: 1, md: 0 },
            transition: "opacity 120ms",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Dropdown>
            <MenuButton
              slots={{ root: IconButton }}
              slotProps={{
                root: {
                  size: "sm",
                  variant: "soft",
                  "aria-label": "Video options",
                },
              }}
            >
              <MoreVertIcon />
            </MenuButton>
            <Menu size="sm" placement="bottom-end">
              <MenuItem onClick={onPlay}>
                <PlayArrowIcon /> Play
              </MenuItem>
              <MenuItem onClick={onDownload}>
                <DownloadIcon /> Download
              </MenuItem>
              <MenuItem onClick={onRename}>
                <EditIcon /> Rename
              </MenuItem>
              <MenuItem onClick={onShare}>
                <ShareIcon /> Share
              </MenuItem>
              <MenuItem onClick={onAddToPlaylist}>
                <PlaylistAddIcon /> Add to playlist
              </MenuItem>
              <ListDivider />
              <MenuItem color="danger" onClick={onDelete}>
                <DeleteIcon /> Delete
              </MenuItem>
            </Menu>
          </Dropdown>
        </Box>
      </Box>
      <Box sx={{ p: 1.25 }}>
        <Typography level="body-sm" sx={{ fontWeight: 500 }} noWrap>
          {video.title || "Untitled video"}
        </Typography>
        <Typography level="body-xs" sx={{ opacity: 0.65 }} noWrap>
          {[
            formatBytes(video.size),
            new Date(video.created_at).toLocaleDateString(),
          ]
            .filter(Boolean)
            .join(" · ")}
        </Typography>
      </Box>
    </Sheet>
  );
}

interface RenameDialogProps {
  video: Video;
  onClose: () => void;
  onSave: (input: { title: string; description: string }) => void;
}

function RenameDialog({ video, onClose, onSave }: RenameDialogProps) {
  const [title, setTitle] = useState(video.title);
  const [description, setDescription] = useState(video.description);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
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
        <Typography level="h4">Edit details</Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mt: 1 }}>
          <FormControl>
            <FormLabel>Title</FormLabel>
            <Input
              slotProps={{ input: { ref: inputRef } }}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  onSave({
                    title: title.trim(),
                    description: description.trim(),
                  });
              }}
            />
          </FormControl>
          <FormControl>
            <FormLabel>Description</FormLabel>
            <Textarea
              minRows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </FormControl>
        </Box>
        <Box
          sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 2 }}
        >
          <Button variant="plain" color="neutral" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onSave({ title: title.trim(), description: description.trim() })
            }
          >
            Save
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}
