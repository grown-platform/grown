import {
  Sheet,
  Box,
  Typography,
  IconButton,
  Slider,
  AspectRatio,
  Tooltip,
} from "@mui/joy";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import SkipPreviousIcon from "@mui/icons-material/SkipPrevious";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import RadioIcon from "@mui/icons-material/Radio";
import StopIcon from "@mui/icons-material/Stop";
import ShuffleIcon from "@mui/icons-material/Shuffle";
import RepeatIcon from "@mui/icons-material/Repeat";
import RepeatOneIcon from "@mui/icons-material/RepeatOne";
import { usePlayer } from "./player";
import { stopStation } from "./api";
import { formatClock } from "./media";

/** PlayerBar is the persistent transport control fixed to the bottom of the
 *  music app. It renders nothing until a track is loaded. */
export function PlayerBar() {
  const p = usePlayer();

  // Radio mode: a continuous live stream — no scrubber/skip, show the station
  // and a LIVE badge with a stop control.
  if (p.radioStation) {
    const st = p.radioStation;
    return (
      <Sheet
        variant="outlined"
        role="region"
        aria-label="Radio player"
        sx={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 1100,
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          px: { xs: 1.5, sm: 2 },
          py: { xs: 0.75, sm: 1 },
          boxShadow: "md",
          bgcolor: "background.surface",
        }}
      >
        <AspectRatio
          ratio="1"
          sx={{ width: 44, borderRadius: "sm", flexShrink: 0 }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "primary.softBg",
            }}
          >
            <RadioIcon sx={{ color: "primary.500" }} />
          </Box>
        </AspectRatio>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Typography
              level="body-xs"
              sx={{
                fontWeight: 700,
                color: "danger.500",
                letterSpacing: 0.5,
              }}
            >
              ● LIVE
            </Typography>
            <Typography level="body-sm" sx={{ fontWeight: 500 }} noWrap>
              {st.name}
            </Typography>
          </Box>
          <Typography level="body-xs" sx={{ opacity: 0.7 }} noWrap>
            {st.genre || "Radio"} · caching to this station's album
          </Typography>
        </Box>
        <IconButton
          size="sm"
          variant="solid"
          color="primary"
          onClick={p.toggle}
          aria-label={p.playing ? "Pause" : "Play"}
        >
          {p.playing ? <PauseIcon /> : <PlayArrowIcon />}
        </IconButton>
        <Tooltip title="Stop radio" placement="top">
          <IconButton
            size="sm"
            variant="plain"
            color="neutral"
            onClick={() => {
              p.stopRadio();
              void stopStation(st.id);
            }}
            aria-label="Stop radio"
          >
            <StopIcon />
          </IconButton>
        </Tooltip>
        <Box
          sx={{
            display: { xs: "none", sm: "flex" },
            alignItems: "center",
            gap: 1,
          }}
        >
          <IconButton
            size="sm"
            variant="plain"
            onClick={p.toggleMute}
            aria-label={p.muted || p.volume === 0 ? "Unmute" : "Mute"}
          >
            {p.muted || p.volume === 0 ? <VolumeOffIcon /> : <VolumeUpIcon />}
          </IconButton>
          <Slider
            size="sm"
            aria-label="Volume"
            value={p.muted ? 0 : p.volume}
            min={0}
            max={1}
            step={0.01}
            onChange={(_, v) => p.setVolume(Array.isArray(v) ? v[0] : v)}
            sx={{ width: 100 }}
          />
        </Box>
      </Sheet>
    );
  }

  if (!p.current) return null;

  const t = p.current;
  const hasPrev = p.index > 0 || p.shuffle || p.repeat === "all";
  const hasNext =
    (p.index >= 0 && p.index < p.queue.length - 1) ||
    p.shuffle ||
    p.repeat !== "off";

  const repeatLabel =
    p.repeat === "one"
      ? "Repeat one"
      : p.repeat === "all"
        ? "Repeat all (click to disable)"
        : "Repeat off (click to enable)";

  return (
    <Sheet
      variant="outlined"
      role="region"
      aria-label="Music player"
      sx={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1100,
        display: "grid",
        gridTemplateColumns: {
          xs: "1fr auto",
          sm: "minmax(0, 1fr) 2fr minmax(0, 1fr)",
        },
        gridTemplateRows: { xs: "auto auto", sm: "auto" },
        alignItems: "center",
        gap: { xs: 0.5, sm: 2 },
        px: { xs: 1, sm: 2 },
        py: { xs: 0.5, sm: 1 },
        boxShadow: "md",
        bgcolor: "background.surface",
      }}
    >
      {/* Now playing */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          minWidth: 0,
          gridColumn: { xs: "1", sm: "auto" },
        }}
      >
        <AspectRatio
          ratio="1"
          sx={{ width: { xs: 36, sm: 44 }, borderRadius: "sm", flexShrink: 0 }}
        >
          {t.artwork_data_url ? (
            <img src={t.artwork_data_url} alt="" />
          ) : (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                bgcolor: "neutral.softBg",
              }}
            >
              <MusicNoteIcon sx={{ opacity: 0.5 }} />
            </Box>
          )}
        </AspectRatio>
        <Box sx={{ minWidth: 0 }}>
          <Typography level="body-sm" sx={{ fontWeight: 500 }} noWrap>
            {t.title || "Untitled track"}
          </Typography>
          <Typography level="body-xs" sx={{ opacity: 0.7 }} noWrap>
            {t.artist || "Unknown artist"}
          </Typography>
        </Box>
      </Box>

      {/* Transport + scrubber */}
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0.25,
          minWidth: 0,
          gridColumn: { xs: "1 / -1", sm: "auto" },
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          {/* Shuffle */}
          <Tooltip
            title={p.shuffle ? "Shuffle on" : "Shuffle off"}
            placement="top"
          >
            <IconButton
              size="sm"
              variant="plain"
              onClick={p.toggleShuffle}
              color={p.shuffle ? "primary" : "neutral"}
              aria-label="Toggle shuffle"
              sx={{ display: { xs: "none", sm: "inline-flex" } }}
            >
              <ShuffleIcon />
            </IconButton>
          </Tooltip>

          <IconButton
            size="sm"
            variant="plain"
            disabled={!hasPrev}
            onClick={p.prev}
            aria-label="Previous track"
          >
            <SkipPreviousIcon />
          </IconButton>
          <IconButton
            size="sm"
            variant="solid"
            color="primary"
            onClick={p.toggle}
            aria-label={p.playing ? "Pause" : "Play"}
          >
            {p.playing ? <PauseIcon /> : <PlayArrowIcon />}
          </IconButton>
          <IconButton
            size="sm"
            variant="plain"
            disabled={!hasNext}
            onClick={p.next}
            aria-label="Next track"
          >
            <SkipNextIcon />
          </IconButton>

          {/* Repeat */}
          <Tooltip title={repeatLabel} placement="top">
            <IconButton
              size="sm"
              variant="plain"
              onClick={p.cycleRepeat}
              color={p.repeat !== "off" ? "primary" : "neutral"}
              aria-label={repeatLabel}
              sx={{ display: { xs: "none", sm: "inline-flex" } }}
            >
              {p.repeat === "one" ? <RepeatOneIcon /> : <RepeatIcon />}
            </IconButton>
          </Tooltip>
        </Box>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            width: "100%",
            maxWidth: 520,
          }}
        >
          <Typography
            level="body-xs"
            sx={{ opacity: 0.7, width: 38, textAlign: "right", flexShrink: 0 }}
          >
            {formatClock(p.position)}
          </Typography>
          <Slider
            size="sm"
            aria-label="Seek"
            value={p.duration > 0 ? Math.min(p.position, p.duration) : 0}
            min={0}
            max={p.duration > 0 ? p.duration : 1}
            step={1}
            onChange={(_, v) => p.seek(Array.isArray(v) ? v[0] : v)}
            sx={{ flex: 1 }}
          />
          <Typography
            level="body-xs"
            sx={{ opacity: 0.7, width: 38, flexShrink: 0 }}
          >
            {formatClock(p.duration)}
          </Typography>
        </Box>
      </Box>

      {/* Play/pause for xs only — sits in column 2, row 1 */}
      <Box
        sx={{
          display: { xs: "flex", sm: "none" },
          justifyContent: "flex-end",
          alignItems: "center",
          gridColumn: "2",
          gridRow: "1",
        }}
      >
        <IconButton
          size="sm"
          variant="solid"
          color="primary"
          onClick={p.toggle}
          aria-label={p.playing ? "Pause" : "Play"}
          sx={{ minWidth: 40, minHeight: 40 }}
        >
          {p.playing ? <PauseIcon /> : <PlayArrowIcon />}
        </IconButton>
      </Box>

      {/* Volume — hidden on the smallest screens to keep the bar tidy. */}
      <Box
        sx={{
          display: { xs: "none", sm: "flex" },
          alignItems: "center",
          gap: 1,
          justifyContent: "flex-end",
        }}
      >
        <IconButton
          size="sm"
          variant="plain"
          onClick={p.toggleMute}
          aria-label={p.muted || p.volume === 0 ? "Unmute" : "Mute"}
        >
          {p.muted || p.volume === 0 ? <VolumeOffIcon /> : <VolumeUpIcon />}
        </IconButton>
        <Slider
          size="sm"
          aria-label="Volume"
          value={p.muted ? 0 : p.volume}
          min={0}
          max={1}
          step={0.01}
          onChange={(_, v) => p.setVolume(Array.isArray(v) ? v[0] : v)}
          sx={{ width: 100 }}
        />
      </Box>
    </Sheet>
  );
}
