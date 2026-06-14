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
  Button,
  Input,
  Stack,
} from "@mui/joy";
import RadioIcon from "@mui/icons-material/Radio";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import AlbumIcon from "@mui/icons-material/Album";
import AddIcon from "@mui/icons-material/Add";
import {
  listStations,
  playStation,
  setStationRetention,
  createStation,
} from "./api";
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

  // Add-station form.
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addGenre, setAddGenre] = useState("");
  const [adding, setAdding] = useState(false);

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

  async function handleAddStation() {
    const name = addName.trim();
    const url = addUrl.trim();
    if (!name || !url) return;
    setAdding(true);
    try {
      const created = await createStation({
        name,
        stream_url: url,
        genre: addGenre.trim() || undefined,
      });
      // Upsert into the list (the endpoint is idempotent on stream_url).
      setStations((cur) => {
        const rest = (cur ?? []).filter((s) => s.id !== created.id);
        return [created, ...rest];
      });
      setAddName("");
      setAddUrl("");
      setAddGenre("");
      setShowAdd(false);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(false);
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

  const addBar = (
    <Box sx={{ mb: 1.5 }}>
      <Button
        size="sm"
        variant={showAdd ? "soft" : "outlined"}
        color="neutral"
        startDecorator={<AddIcon />}
        onClick={() => setShowAdd((v) => !v)}
      >
        Add station
      </Button>
      {showAdd && (
        <Sheet variant="soft" sx={{ mt: 1, p: 1.5, borderRadius: "md" }}>
          <Stack spacing={1}>
            <Input
              size="sm"
              placeholder="Station name"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
            />
            <Input
              size="sm"
              placeholder="Stream URL (https://…)"
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleAddStation()}
            />
            <Input
              size="sm"
              placeholder="Genre (optional)"
              value={addGenre}
              onChange={(e) => setAddGenre(e.target.value)}
            />
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button
                size="sm"
                variant="plain"
                color="neutral"
                disabled={adding}
                onClick={() => setShowAdd(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                loading={adding}
                disabled={!addName.trim() || !addUrl.trim()}
                onClick={() => void handleAddStation()}
              >
                Add
              </Button>
            </Stack>
          </Stack>
        </Sheet>
      )}
    </Box>
  );

  if (error) {
    return (
      <>
        {addBar}
        <Sheet color="danger" variant="soft" sx={{ p: 2, borderRadius: "md" }}>
          <Typography color="danger">{error}</Typography>
        </Sheet>
      </>
    );
  }

  if (shown.length === 0) {
    return (
      <>
        {addBar}
        <Sheet
          variant="soft"
          sx={{ p: 6, borderRadius: "md", textAlign: "center" }}
        >
          <RadioIcon sx={{ fontSize: 48, opacity: 0.4 }} />
          <Typography level="body-lg" sx={{ opacity: 0.7, mt: 1 }}>
            {query ? "No matching stations." : "No stations yet."}
          </Typography>
        </Sheet>
      </>
    );
  }

  return (
    <>
      {addBar}
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
