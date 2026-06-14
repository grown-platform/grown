/**
 * Maps — a slippy map with search, geolocation, layer switching, and
 * **optional offline data**.
 *
 * Leaflet over OpenStreetMap (streets) + Esri (satellite) raster tiles. Tiles
 * route through a cache-aware layer (`offlineTileLayer`): every tile viewed is
 * stored in the Cache API, and the user can explicitly "Save area offline" at a
 * chosen **detail level**, then review/delete those selections in the "Cached
 * data" panel. Nothing here calls a grown backend. Leaflet + its CSS live in
 * this lazy /maps chunk, out of the main bundle. Region bookkeeping +
 * download/delete live in ./offline.
 */
import { useEffect, useRef, useState } from "react";
import {
  Box,
  Container,
  Stack,
  Typography,
  Input,
  Button,
  Select,
  Option,
  Tooltip,
  LinearProgress,
  Chip,
  Modal,
  ModalDialog,
  ModalClose,
  DialogTitle,
  DialogContent,
  FormControl,
  FormLabel,
  RadioGroup,
  Radio,
  List,
  ListItem,
  ListItemContent,
  IconButton,
  Divider,
  Sheet,
} from "@mui/joy";
import MapIcon from "@mui/icons-material/Map";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import SearchIcon from "@mui/icons-material/Search";
import DownloadForOfflineIcon from "@mui/icons-material/DownloadForOffline";
import StorageIcon from "@mui/icons-material/Storage";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import {
  TILE_CACHE,
  LAYERS,
  type LayerDef,
  type Bounds,
  type OfflineRegion,
  loadRegions,
  estimateTiles,
  downloadRegion,
  deleteRegion,
  storageEstimate,
  fmtBytes,
} from "./offline";

const ACCENT = "#1565C0";

// Detail presets for "Save area offline": how many zoom levels DEEPER than the
// current view to cache. More depth = sharper when you zoom in offline = more
// tiles. The live tile estimate in the dialog shows the cost.
const DETAIL_PRESETS = [
  { id: "low", label: "This view", extra: 0 },
  { id: "standard", label: "Standard (+2 zoom)", extra: 2 },
  { id: "high", label: "High detail (+4 zoom)", extra: 4 },
] as const;
type DetailId = (typeof DETAIL_PRESETS)[number]["id"];

// ---------------------------------------------------------------------------
// Live cache-aware tile layer
// ---------------------------------------------------------------------------

async function tileBlobURL(url: string): Promise<string | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(TILE_CACHE);
    let res = await cache.match(url);
    if (!res) {
      const net = await fetch(url, { mode: "cors" });
      if (!net.ok) return null;
      await cache.put(url, net.clone());
      void navigator.storage?.persist?.().catch(() => {});
      res = net;
    }
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}

function offlineTileLayer(def: LayerDef): L.TileLayer {
  const Offline = L.TileLayer.extend({
    createTile(coords: L.Coords, done: L.DoneCallback) {
      const img = document.createElement("img");
      img.setAttribute("role", "presentation");
      img.alt = "";
      const url = (
        this as unknown as { getTileUrl(c: L.Coords): string }
      ).getTileUrl(coords);
      void tileBlobURL(url).then((blobUrl) => {
        if (blobUrl) {
          img.onload = () => {
            URL.revokeObjectURL(blobUrl);
            done(undefined, img);
          };
          img.onerror = () => {
            URL.revokeObjectURL(blobUrl);
            img.src = url;
            done(undefined, img);
          };
          img.src = blobUrl;
        } else {
          img.onload = () => done(undefined, img);
          img.onerror = (e) => done(e as unknown as Error, img);
          img.src = url;
        }
      });
      return img;
    },
  });
  return new (Offline as unknown as new (
    u: string,
    o: L.TileLayerOptions,
  ) => L.TileLayer)(def.url, {
    attribution: def.attribution,
    maxZoom: def.maxZoom,
    crossOrigin: true,
  });
}

async function geocode(
  q: string,
): Promise<{ lat: number; lon: number; name: string } | null> {
  const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
  const r = await fetch(u, { headers: { "Accept-Language": "en" } });
  if (!r.ok) return null;
  const j = (await r.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
  }>;
  return j[0]
    ? { lat: +j[0].lat, lon: +j[0].lon, name: j[0].display_name }
    : null;
}

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=${lat}&lon=${lon}`,
      { headers: { "Accept-Language": "en" } },
    );
    const j = (await r.json()) as { name?: string; display_name?: string };
    return (
      j.name ||
      j.display_name?.split(",").slice(0, 2).join(", ").trim() ||
      ""
    );
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MapsApp({ user }: { user: User }) {
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.TileLayer | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  const [layer, setLayer] = useState<keyof typeof LAYERS>("streets");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  // Save-area dialog state.
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveBounds, setSaveBounds] = useState<Bounds | null>(null);
  const [saveZoom, setSaveZoom] = useState(3);
  const [detail, setDetail] = useState<DetailId>("standard");
  const [saveLabel, setSaveLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [savePct, setSavePct] = useState(0);

  // Cached-data dialog state.
  const [cacheOpen, setCacheOpen] = useState(false);
  const [regions, setRegions] = useState<OfflineRegion[]>([]);
  const [usage, setUsage] = useState<{ usage: number; quota: number }>({
    usage: 0,
    quota: 0,
  });

  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;
    const map = L.map(mapElRef.current, { zoomControl: true }).setView(
      [20, 0],
      3,
    );
    mapRef.current = map;
    layerRef.current = offlineTileLayer(LAYERS.streets).addTo(map);
    navigator.geolocation?.getCurrentPosition(
      (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 13),
      () => {},
      { enableHighAccuracy: false, timeout: 5000 },
    );
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (layerRef.current) map.removeLayer(layerRef.current);
    layerRef.current = offlineTileLayer(LAYERS[layer]).addTo(map);
  }, [layer]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  async function handleSearch() {
    const q = query.trim();
    if (!q || !mapRef.current) return;
    setSearching(true);
    setStatus(null);
    try {
      const hit = await geocode(q);
      if (!hit) {
        setStatus(`No match for “${q}”.`);
        return;
      }
      mapRef.current.setView([hit.lat, hit.lon], 14);
      if (markerRef.current) markerRef.current.remove();
      markerRef.current = L.marker([hit.lat, hit.lon])
        .addTo(mapRef.current)
        .bindPopup(hit.name)
        .openPopup();
    } catch {
      setStatus("Search failed (are you offline?).");
    } finally {
      setSearching(false);
    }
  }

  function handleLocate() {
    if (!mapRef.current) return;
    navigator.geolocation?.getCurrentPosition(
      (pos) =>
        mapRef.current?.setView(
          [pos.coords.latitude, pos.coords.longitude],
          15,
        ),
      () => setStatus("Couldn't get your location."),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  // Open the detail prompt, capturing the current view + a suggested name.
  function openSaveDialog() {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    setSaveBounds({
      south: b.getSouth(),
      west: b.getWest(),
      north: b.getNorth(),
      east: b.getEast(),
    });
    setSaveZoom(map.getZoom());
    setDetail("standard");
    setSaveLabel("");
    setSavePct(0);
    setSaveOpen(true);
    const c = map.getCenter();
    void reverseGeocode(c.lat, c.lng).then((name) => {
      if (name) setSaveLabel((cur) => cur || name);
    });
  }

  function zoomRangeFor(extra: number): { from: number; to: number } {
    const def = LAYERS[layer];
    return { from: saveZoom, to: Math.min(saveZoom + extra, def.maxZoom) };
  }

  function estimateFor(extra: number): number {
    if (!saveBounds) return 0;
    const { from, to } = zoomRangeFor(extra);
    return estimateTiles(saveBounds, from, to);
  }

  async function handleConfirmSave() {
    if (!saveBounds) return;
    const def = LAYERS[layer];
    const extra =
      DETAIL_PRESETS.find((p) => p.id === detail)?.extra ?? 2;
    const { from, to } = zoomRangeFor(extra);
    const label =
      saveLabel.trim() ||
      `Area @ ${saveBounds.south.toFixed(2)},${saveBounds.west.toFixed(2)}`;
    setSaving(true);
    setSavePct(0);
    try {
      const { capped } = await downloadRegion(
        def,
        layer,
        saveBounds,
        from,
        to,
        label,
        (d, t) => setSavePct(t ? Math.round((d / t) * 100) : 0),
      );
      setSaveOpen(false);
      setStatus(
        capped
          ? `Saved “${label}” (capped — pick a smaller area or lower detail for full coverage).`
          : `Saved “${label}” for offline use ✓`,
      );
    } catch {
      setStatus("Couldn't save this area.");
    } finally {
      setSaving(false);
    }
  }

  async function openCacheDialog() {
    setRegions(loadRegions());
    setUsage(await storageEstimate());
    setCacheOpen(true);
  }

  async function handleDeleteRegion(region: OfflineRegion) {
    await deleteRegion(region);
    setRegions(loadRegions());
    setUsage(await storageEstimate());
  }

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.body" }}>
      <Header user={user} />
      <Container sx={{ py: 3 }} maxWidth={false}>
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1 }}>
          <MapIcon sx={{ color: ACCENT, fontSize: 30 }} />
          <Typography level="h2">Maps</Typography>
          {!online && (
            <Chip size="sm" color="warning" variant="soft">
              Offline — showing saved areas
            </Chip>
          )}
        </Stack>

        <Stack
          direction="row"
          spacing={1}
          flexWrap="wrap"
          useFlexGap
          alignItems="center"
          sx={{ mb: 1.5 }}
        >
          <Input
            size="sm"
            placeholder="Search a place or address…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
            startDecorator={<SearchIcon />}
            sx={{ minWidth: 260, flex: 1 }}
          />
          <Button
            size="sm"
            variant="solid"
            loading={searching}
            onClick={() => void handleSearch()}
            sx={{ bgcolor: ACCENT, "&:hover": { bgcolor: "#0d4f96" } }}
          >
            Search
          </Button>
          <Tooltip title="Center on my location">
            <Button
              size="sm"
              variant="outlined"
              color="neutral"
              startDecorator={<MyLocationIcon />}
              onClick={handleLocate}
            >
              Locate
            </Button>
          </Tooltip>
          <Select
            size="sm"
            value={layer}
            onChange={(_, v) => v && setLayer(v)}
            sx={{ minWidth: 120 }}
          >
            {Object.entries(LAYERS).map(([id, def]) => (
              <Option key={id} value={id}>
                {def.label}
              </Option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="outlined"
            color="primary"
            startDecorator={<DownloadForOfflineIcon />}
            onClick={openSaveDialog}
          >
            Save area offline
          </Button>
          <Tooltip title="View & manage the offline areas you've downloaded">
            <Button
              size="sm"
              variant="outlined"
              color="neutral"
              startDecorator={<StorageIcon />}
              onClick={() => void openCacheDialog()}
            >
              Cached data
            </Button>
          </Tooltip>
        </Stack>

        {status && (
          <Typography level="body-xs" sx={{ mb: 1, color: ACCENT }}>
            {status}
          </Typography>
        )}

        <Box
          ref={mapElRef}
          sx={{
            height: "calc(100vh - 210px)",
            minHeight: 420,
            borderRadius: "md",
            overflow: "hidden",
            border: "1px solid",
            borderColor: "divider",
          }}
        />
        <Typography level="body-xs" sx={{ mt: 1, opacity: 0.6 }}>
          Tiles you view are cached automatically. “Save area offline” lets you
          pick how much detail to download for the current view.
        </Typography>
      </Container>

      {/* ---- Detail prompt before downloading ---- */}
      <Modal open={saveOpen} onClose={() => !saving && setSaveOpen(false)}>
        <ModalDialog sx={{ maxWidth: 440 }}>
          <ModalClose disabled={saving} />
          <DialogTitle>Save area offline</DialogTitle>
          <DialogContent>
            <Typography level="body-sm" sx={{ mb: 1.5 }}>
              Download the area you're viewing so it works with no connection.
              Higher detail caches deeper zoom levels (sharper, but more tiles).
            </Typography>
            <FormControl sx={{ mb: 1.5 }}>
              <FormLabel>Name</FormLabel>
              <Input
                size="sm"
                value={saveLabel}
                onChange={(e) => setSaveLabel(e.target.value)}
                placeholder="e.g. Rome city centre"
              />
            </FormControl>
            <FormControl>
              <FormLabel>Detail level</FormLabel>
              <RadioGroup
                value={detail}
                onChange={(e) => setDetail(e.target.value as DetailId)}
              >
                {DETAIL_PRESETS.map((p) => {
                  const n = estimateFor(p.extra);
                  const { to } = zoomRangeFor(p.extra);
                  return (
                    <Radio
                      key={p.id}
                      value={p.id}
                      disabled={saving}
                      label={
                        <Box>
                          <Typography level="body-sm">{p.label}</Typography>
                          <Typography level="body-xs" sx={{ opacity: 0.65 }}>
                            ~{n.toLocaleString()} tiles · to zoom {to}
                          </Typography>
                        </Box>
                      }
                    />
                  );
                })}
              </RadioGroup>
            </FormControl>
            {saving && (
              <LinearProgress
                determinate
                value={savePct}
                sx={{ mt: 1.5 }}
              />
            )}
            <Stack direction="row" spacing={1} sx={{ mt: 2 }} justifyContent="flex-end">
              <Button
                size="sm"
                variant="plain"
                color="neutral"
                disabled={saving}
                onClick={() => setSaveOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                loading={saving}
                startDecorator={<DownloadForOfflineIcon />}
                onClick={() => void handleConfirmSave()}
                sx={{ bgcolor: ACCENT, "&:hover": { bgcolor: "#0d4f96" } }}
              >
                Download {estimateFor(
                  DETAIL_PRESETS.find((p) => p.id === detail)?.extra ?? 2,
                ).toLocaleString()}{" "}
                tiles
              </Button>
            </Stack>
          </DialogContent>
        </ModalDialog>
      </Modal>

      {/* ---- Cached offline selections ---- */}
      <Modal open={cacheOpen} onClose={() => setCacheOpen(false)}>
        <ModalDialog sx={{ maxWidth: 520, width: "100%" }}>
          <ModalClose />
          <DialogTitle>Offline map data</DialogTitle>
          <DialogContent>
            <Typography level="body-xs" sx={{ mb: 1, opacity: 0.7 }}>
              Saved areas render with no connection. Total on-device cache:{" "}
              <strong>{fmtBytes(usage.usage)}</strong>
              {usage.quota ? ` of ${fmtBytes(usage.quota)} available` : ""}.
            </Typography>
            <Divider />
            {regions.length === 0 ? (
              <Typography level="body-sm" sx={{ py: 3, textAlign: "center", opacity: 0.6 }}>
                No saved areas yet. Pan to a place and tap “Save area offline”.
              </Typography>
            ) : (
              <List sx={{ "--ListItem-paddingX": "0px" }}>
                {regions.map((r) => (
                  <ListItem
                    key={r.id}
                    endAction={
                      <Tooltip title="Delete this offline area">
                        <IconButton
                          size="sm"
                          color="danger"
                          variant="plain"
                          onClick={() => void handleDeleteRegion(r)}
                        >
                          <DeleteOutlineIcon />
                        </IconButton>
                      </Tooltip>
                    }
                  >
                    <ListItemContent>
                      <Typography level="body-sm" sx={{ fontWeight: 600 }}>
                        {r.label}
                      </Typography>
                      <Typography level="body-xs" sx={{ opacity: 0.65 }}>
                        {r.tiles.toLocaleString()} tiles · zoom {r.zoomFrom}–
                        {r.zoomTo} · {LAYERS[r.layerId]?.label ?? r.layerId} ·{" "}
                        {new Date(r.savedAt).toLocaleDateString()}
                      </Typography>
                    </ListItemContent>
                  </ListItem>
                ))}
              </List>
            )}
            <Sheet
              variant="soft"
              sx={{ mt: 1, p: 1, borderRadius: "sm", fontSize: 12, opacity: 0.8 }}
            >
              Tip: deleting an area frees its tiles. Tiles shared with another
              saved area may be re-fetched next time you view it online.
            </Sheet>
          </DialogContent>
        </ModalDialog>
      </Modal>
    </Box>
  );
}
