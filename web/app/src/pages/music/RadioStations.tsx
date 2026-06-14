import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Sheet,
  Typography,
  CircularProgress,
  IconButton,
  Chip,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  Tooltip,
} from "@mui/joy";
import RadioIcon from "@mui/icons-material/Radio";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import AlbumIcon from "@mui/icons-material/Album";
import { listStations, playStation, setStationRetention } from "./api";
import type { Station, RetentionMode } from "./types";
import { usePlayer } from "./player";

/** retentionLabel renders a station's retention policy as a short phrase. */
function retentionLabel(s: Station): string {
  if (s.retention_mode === "days") return `Erase after ${s.retention_days}d`;
  return "Keep forever";
}

const RETENTION_OPTIONS: { label: string; mode: RetentionMode; days: number }[] =
  [
    { label: "Keep forever", mode: "keep", days: 0 },
    { label: "Erase after 7 days", mode: "days", days: 7 },
    { label: "Erase after 30 days", mode: "days", days: 30 },
    { label: "Erase after 90 days", mode: "days", days: 90 },
  ];

interface RadioStationsProps {
  query: string;
}

export function RadioStations({ query }: RadioStationsProps) {
  const player = usePlayer();
  const [stations, setStations] = useState<Station[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      setStations(await listStations());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    reload();
  }, []);

  const shown = useMemo(() => {
    const list = stations ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((s) =>
      [s.name, s.genre].join(" ").toLowerCase().includes(q),
    );
  }, [stations, query]);

  async function tune(station: Station) {
    const active = player.radioStation?.id === station.id;
    if (active) {
      player.toggle();
      return;
    }
    try {
      // Start server-side caching, then play the live proxy stream.
      const fresh = await playStation(station.id);
      player.playRadio(fresh);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function changeRetention(
    station: Station,
    mode: RetentionMode,
    days: number,
  ) {
    try {
      const updated = await setStationRetention(station.id, mode, days);
      setStations((cur) =>
        (cur ?? []).map((s) => (s.id === station.id ? updated : s)),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (stations === null && !error) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Sheet color="danger" variant="soft" sx={{ p: 2, borderRadius: "md" }}>
        <Typography color="danger">Could not load stations: {error}</Typography>
      </Sheet>
    );
  }

  if (shown.length === 0) {
    return (
      <Sheet
        variant="soft"
        sx={{ p: 6, borderRadius: "md", textAlign: "center" }}
      >
        <RadioIcon sx={{ fontSize: 48, opacity: 0.4 }} />
        <Typography level="body-lg" sx={{ opacity: 0.7, mt: 1 }}>
          {query ? "No matching stations." : "No stations yet."}
        </Typography>
      </Sheet>
    );
  }

  return (
    <>
      <Typography level="body-xs" sx={{ opacity: 0.7, mb: 1 }}>
        Tune in to a station — songs are cached to the station's album in your
        library as they play.
      </Typography>
      <Sheet variant="outlined" sx={{ borderRadius: "md", p: 0.5 }}>
        {shown.map((s) => {
          const active = player.radioStation?.id === s.id;
          const playing = active && player.playing;
          return (
            <Box
              key={s.id}
              data-testid={`station-${s.id}`}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                p: 1,
                borderRadius: "sm",
                "&:hover": { bgcolor: "neutral.softHoverBg" },
                ...(active ? { bgcolor: "primary.softBg" } : {}),
              }}
            >
              <IconButton
                size="sm"
                variant={active ? "solid" : "soft"}
                color="primary"
                onClick={() => tune(s)}
                aria-label={playing ? `Pause ${s.name}` : `Play ${s.name}`}
              >
                {playing ? <PauseIcon /> : <PlayArrowIcon />}
              </IconButton>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography level="body-sm" sx={{ fontWeight: 500 }} noWrap>
                  {s.name}
                </Typography>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    flexWrap: "wrap",
                  }}
                >
                  {s.genre && (
                    <Typography level="body-xs" sx={{ opacity: 0.7 }}>
                      {s.genre}
                    </Typography>
                  )}
                  <Typography
                    level="body-xs"
                    sx={{
                      opacity: 0.6,
                      display: "flex",
                      alignItems: "center",
                      gap: 0.5,
                    }}
                  >
                    <AlbumIcon sx={{ fontSize: 14 }} />
                    {s.track_count} cached
                  </Typography>
                </Box>
              </Box>
              <Tooltip title="Retention" placement="top">
                <Chip
                  size="sm"
                  variant="soft"
                  color={s.retention_mode === "days" ? "warning" : "neutral"}
                  sx={{ display: { xs: "none", sm: "inline-flex" } }}
                >
                  {retentionLabel(s)}
                </Chip>
              </Tooltip>
              <Dropdown>
                <MenuButton
                  slots={{ root: IconButton }}
                  slotProps={{
                    root: {
                      variant: "plain",
                      color: "neutral",
                      size: "sm",
                      "aria-label": `${s.name} options`,
                    },
                  }}
                >
                  <MoreVertIcon />
                </MenuButton>
                <Menu placement="bottom-end" size="sm">
                  <MenuItem disabled>Erase recordings</MenuItem>
                  {RETENTION_OPTIONS.map((opt) => (
                    <MenuItem
                      key={opt.label}
                      selected={
                        s.retention_mode === opt.mode &&
                        (opt.mode === "keep" || s.retention_days === opt.days)
                      }
                      onClick={() => changeRetention(s, opt.mode, opt.days)}
                    >
                      {opt.label}
                    </MenuItem>
                  ))}
                </Menu>
              </Dropdown>
            </Box>
          );
        })}
      </Sheet>
    </>
  );
}
