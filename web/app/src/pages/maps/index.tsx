/**
 * Maps — a slippy map with search, geolocation, layer switching, and
 * **optional offline data**.
 *
 * The map is Leaflet over self-servable OpenStreetMap raster tiles (street) plus
 * Esri World Imagery (satellite). Tiles are routed through a cache-aware tile
 * layer (see `offlineTileLayer`): every tile you view is stored in the Cache API
 * (`maps-tiles-v1`), so areas you've browsed — and any region you explicitly
 * "Save for offline" — render with no connection. `navigator.storage.persist()`
 * asks the browser not to evict the cache. Nothing here calls a grown backend.
 *
 * Leaflet + its CSS are imported at the top of this lazy-loaded route module, so
 * they land in the /maps chunk and never bloat the main app bundle.
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
} from "@mui/joy";
import MapIcon from "@mui/icons-material/Map";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import SearchIcon from "@mui/icons-material/Search";
import DownloadForOfflineIcon from "@mui/icons-material/DownloadForOffline";
import CloudDoneOutlinedIcon from "@mui/icons-material/CloudDoneOutlined";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";

const ACCENT = "#1565C0";
const TILE_CACHE = "maps-tiles-v1";
// How many extra zoom levels (beyond the current one) a "Save area" pulls, and
// the hard cap on tiles per save so a careless click can't download forever.
const SAVE_EXTRA_LEVELS = 2;
const SAVE_TILE_CAP = 1500;

interface LayerDef {
  label: string;
  url: string;
  attribution: string;
  maxZoom: number;
}

const LAYERS: Record<string, LayerDef> = {
  streets: {
    label: "Streets",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  },
  satellite: {
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
    maxZoom: 19,
  },
};

// ---------------------------------------------------------------------------
// Offline tile cache
// ---------------------------------------------------------------------------

let persistAsked = false;
function askPersist(): void {
  if (persistAsked) return;
  persistAsked = true;
  void navigator.storage?.persist?.().catch(() => {});
}

/** Cache-first fetch of one tile → an object URL, or null to fall back to the
 *  network <img>. Stores newly-fetched tiles so viewed areas work offline. */
async function tileBlobURL(url: string): Promise<string | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(TILE_CACHE);
    let res = await cache.match(url);
    if (!res) {
      const net = await fetch(url, { mode: "cors" });
      if (!net.ok) return null;
      await cache.put(url, net.clone());
      askPersist();
      res = net;
    }
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}

/** A Leaflet TileLayer whose tiles are served Cache-API-first (so saved/visited
 *  areas work offline), falling back to the network for anything uncached. */
function offlineTileLayer(def: LayerDef): L.TileLayer {
  const Offline = L.TileLayer.extend({
    createTile(coords: L.Coords, done: L.DoneCallback) {
      const img = document.createElement("img");
      img.setAttribute("role", "presentation");
      img.alt = "";
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this as unknown as L.TileLayer;
      const url = (self as unknown as { getTileUrl(c: L.Coords): string }).getTileUrl(coords);
      void tileBlobURL(url).then((blobUrl) => {
        if (blobUrl) {
          img.onload = () => {
            URL.revokeObjectURL(blobUrl);
            done(undefined, img);
          };
          img.onerror = () => {
            URL.revokeObjectURL(blobUrl);
            img.src = url; // last-ditch network try
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

/** Fill the tile URL template for a tile coordinate. */
function tileURL(def: LayerDef, x: number, y: number, z: number): string {
  return def.url
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}

/** Pre-fetch + cache every tile covering the map's current view across the
 *  current zoom and a couple deeper levels. Returns counts for the UI. */
async function saveVisibleArea(
  map: L.Map,
  def: LayerDef,
  onProgress: (done: number, total: number) => void,
): Promise<{ saved: number; capped: boolean }> {
  if (typeof caches === "undefined") return { saved: 0, capped: false };
  const bounds = map.getBounds();
  const z0 = map.getZoom();
  const coords: Array<{ x: number; y: number; z: number }> = [];
  for (let z = z0; z <= Math.min(z0 + SAVE_EXTRA_LEVELS, def.maxZoom); z++) {
    const nw = map.project(bounds.getNorthWest(), z).divideBy(256).floor();
    const se = map.project(bounds.getSouthEast(), z).divideBy(256).floor();
    for (let x = nw.x; x <= se.x; x++) {
      for (let y = nw.y; y <= se.y; y++) coords.push({ x, y, z });
    }
  }
  const capped = coords.length > SAVE_TILE_CAP;
  const work = coords.slice(0, SAVE_TILE_CAP);
  const cache = await caches.open(TILE_CACHE);
  let done = 0;
  // Small concurrency pool so we don't open hundreds of sockets at once.
  const POOL = 6;
  let i = 0;
  async function worker() {
    while (i < work.length) {
      const t = work[i++];
      const url = tileURL(def, t.x, t.y, t.z);
      try {
        if (!(await cache.match(url))) {
          const res = await fetch(url, { mode: "cors" });
          if (res.ok) await cache.put(url, res.clone());
        }
      } catch {
        /* skip unreachable tiles */
      }
      onProgress(++done, work.length);
    }
  }
  await Promise.all(Array.from({ length: POOL }, worker));
  askPersist();
  return { saved: work.length, capped };
}

/** Geocode a free-text query via OSM Nominatim (low-volume, attributed use). */
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
  const [saving, setSaving] = useState(false);
  const [savePct, setSavePct] = useState(0);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  // Create the map once.
  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;
    const map = L.map(mapElRef.current, { zoomControl: true }).setView(
      [20, 0],
      3,
    );
    mapRef.current = map;
    const tl = offlineTileLayer(LAYERS.streets).addTo(map);
    layerRef.current = tl;
    // Try to center on the user (best-effort, non-blocking).
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

  // Swap the base layer when the selector changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (layerRef.current) map.removeLayer(layerRef.current);
    layerRef.current = offlineTileLayer(LAYERS[layer]).addTo(map);
  }, [layer]);

  // Track connectivity so the UI can reassure the user offline.
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

  async function handleSaveOffline() {
    if (!mapRef.current) return;
    setSaving(true);
    setSavePct(0);
    setStatus(null);
    try {
      const { saved, capped } = await saveVisibleArea(
        mapRef.current,
        LAYERS[layer],
        (d, t) => setSavePct(t ? Math.round((d / t) * 100) : 0),
      );
      setStatus(
        capped
          ? `Saved ${saved} tiles (area capped — zoom in for more detail offline).`
          : `Saved ${saved} tiles for offline use ✓`,
      );
    } catch {
      setStatus("Couldn't save this area.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.body" }}>
      <Header user={user} />
      <Container sx={{ py: 3 }} maxWidth={false}>
        <Stack
          direction="row"
          alignItems="center"
          spacing={1.5}
          sx={{ mb: 1 }}
        >
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
            sx={{ minWidth: 280, flex: 1 }}
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
            sx={{ minWidth: 130 }}
          >
            {Object.entries(LAYERS).map(([id, def]) => (
              <Option key={id} value={id}>
                {def.label}
              </Option>
            ))}
          </Select>
          <Tooltip title="Cache the tiles for the area you're viewing so it works with no connection.">
            <Button
              size="sm"
              variant="outlined"
              color="primary"
              startDecorator={<DownloadForOfflineIcon />}
              loading={saving}
              onClick={() => void handleSaveOffline()}
            >
              Save area offline
            </Button>
          </Tooltip>
        </Stack>

        {saving && (
          <LinearProgress
            determinate
            value={savePct}
            sx={{ mb: 1 }}
          />
        )}
        {status && (
          <Typography
            level="body-xs"
            sx={{ mb: 1, color: ACCENT, display: "flex", alignItems: "center", gap: 0.5 }}
          >
            <CloudDoneOutlinedIcon fontSize="small" /> {status}
          </Typography>
        )}

        <Box
          ref={mapElRef}
          sx={{
            height: "calc(100vh - 220px)",
            minHeight: 420,
            borderRadius: "md",
            overflow: "hidden",
            border: "1px solid",
            borderColor: "divider",
          }}
        />
        <Typography level="body-xs" sx={{ mt: 1, opacity: 0.6 }}>
          Tiles you view are cached for offline use. “Save area offline” stores
          the current view (and two zoom levels deeper) on your device.
        </Typography>
      </Container>
    </Box>
  );
}
