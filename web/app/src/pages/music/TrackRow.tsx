import {
  Box,
  Typography,
  IconButton,
  AspectRatio,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  ListDivider,
} from "@mui/joy";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import PlaylistAddIcon from "@mui/icons-material/PlaylistAdd";
import PlaylistRemoveIcon from "@mui/icons-material/PlaylistRemove";
import QueuePlayNextIcon from "@mui/icons-material/QueuePlayNext";
import AddToQueueIcon from "@mui/icons-material/AddToQueue";
import FavoriteIcon from "@mui/icons-material/Favorite";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import type { Track } from "./types";
import { formatDuration } from "./media";

export interface TrackRowProps {
  track: Track;
  /** True when this row is the player's current track. */
  active: boolean;
  /** True when the player is actively playing (and this row is active). */
  playing: boolean;
  onPlay: () => void;
  onAddToPlaylist: () => void;
  onPlayNext: () => void;
  onAddToQueue: () => void;
  onLike: () => void;
  onDownload: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** When present, shows a "Remove from playlist" action (playlist view only). */
  onRemoveFromPlaylist?: () => void;
}

/** TrackRow renders one track as a list row with artwork, title/artist, a
 *  duration, and an overflow menu. Clicking the row (or play button) plays it. */
export function TrackRow({
  track,
  active,
  playing,
  onPlay,
  onAddToPlaylist,
  onPlayNext,
  onAddToQueue,
  onLike,
  onDownload,
  onEdit,
  onDelete,
  onRemoveFromPlaylist,
}: TrackRowProps) {
  return (
    <Box
      data-testid={`track-${track.id}`}
      onClick={onPlay}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        px: 1,
        py: 0.75,
        borderRadius: "sm",
        cursor: "pointer",
        bgcolor: active ? "primary.softBg" : undefined,
        "&:hover": {
          bgcolor: active ? "primary.softHoverBg" : "background.level1",
        },
        "&:hover .track-play": { opacity: 1 },
      }}
    >
      <Box sx={{ position: "relative", flexShrink: 0 }}>
        <AspectRatio ratio="1" sx={{ width: 44, borderRadius: "sm" }}>
          {track.artwork_data_url ? (
            <img src={track.artwork_data_url} alt="" loading="lazy" />
          ) : (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                bgcolor: "neutral.softBg",
              }}
            >
              <MusicNoteIcon sx={{ opacity: 0.5, fontSize: 20 }} />
            </Box>
          )}
        </AspectRatio>
        <Box
          className="track-play"
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: "rgba(0,0,0,0.35)",
            borderRadius: "sm",
            color: "#fff",
            opacity: active ? 1 : 0,
            transition: "opacity 120ms",
          }}
        >
          {active && playing ? (
            <PauseIcon />
          ) : active ? (
            <VolumeUpIcon />
          ) : (
            <PlayArrowIcon />
          )}
        </Box>
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          level="body-sm"
          sx={{
            fontWeight: 500,
            color: active ? "primary.plainColor" : undefined,
          }}
          noWrap
        >
          {track.title || "Untitled track"}
        </Typography>
        <Typography level="body-xs" sx={{ opacity: 0.7 }} noWrap>
          {[track.artist || "Unknown artist", track.album]
            .filter(Boolean)
            .join(" — ")}
        </Typography>
      </Box>

      {track.duration_seconds > 0 && (
        <Typography level="body-xs" sx={{ opacity: 0.6, flexShrink: 0 }}>
          {formatDuration(track.duration_seconds)}
        </Typography>
      )}

      {/* Heart (like) button */}
      <Box onClick={(e) => e.stopPropagation()} sx={{ flexShrink: 0 }}>
        <IconButton
          size="sm"
          variant="plain"
          color={track.liked ? "danger" : "neutral"}
          onClick={onLike}
          aria-label={track.liked ? "Unlike track" : "Like track"}
        >
          {track.liked ? <FavoriteIcon /> : <FavoriteBorderIcon />}
        </IconButton>
      </Box>

      <Box onClick={(e) => e.stopPropagation()} sx={{ flexShrink: 0 }}>
        <Dropdown>
          <MenuButton
            slots={{ root: IconButton }}
            slotProps={{
              root: {
                size: "sm",
                variant: "plain",
                color: "neutral",
                "aria-label": `Options for ${track.title || "track"}`,
              },
            }}
          >
            <MoreVertIcon />
          </MenuButton>
          <Menu size="sm" placement="bottom-end">
            <MenuItem onClick={onPlay}>
              <PlayArrowIcon /> Play
            </MenuItem>
            <MenuItem onClick={onPlayNext}>
              <QueuePlayNextIcon /> Play next
            </MenuItem>
            <MenuItem onClick={onAddToQueue}>
              <AddToQueueIcon /> Add to queue
            </MenuItem>
            <ListDivider />
            <MenuItem onClick={onAddToPlaylist}>
              <PlaylistAddIcon /> Add to playlist
            </MenuItem>
            {onRemoveFromPlaylist && (
              <MenuItem onClick={onRemoveFromPlaylist}>
                <PlaylistRemoveIcon /> Remove from playlist
              </MenuItem>
            )}
            <MenuItem onClick={onEdit}>
              <EditIcon /> Edit details
            </MenuItem>
            <MenuItem onClick={onDownload}>
              <DownloadIcon /> Download
            </MenuItem>
            <ListDivider />
            <MenuItem color="danger" onClick={onDelete}>
              <DeleteIcon /> Delete
            </MenuItem>
          </Menu>
        </Dropdown>
      </Box>
    </Box>
  );
}
