/**
 * Offline tile data for the Maps app.
 *
 * Tiles are stored in the Cache API (`maps-tiles-v1`). On top of that raw cache
 * we keep a small registry of named **offline regions** in localStorage — each
 * the bounding box + zoom range the user chose to save — so the "Cached data"
 * panel can list, size, and delete individual selections. Tile coordinates are
 * derived from the standard slippy-map math (no live Leaflet map needed), so the
 * registry can estimate and delete regions independently of what's on screen.
 */

export const TILE_CACHE = "maps-tiles-v1";

export interface LayerDef {
  label: string;
  url: string;
  attribution: string;
  maxZoom: number;
}

export const LAYERS: Record<string, LayerDef> = {
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

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface OfflineRegion extends Bounds {
  id: string;
  label: string;
  zoomFrom: number;
  zoomTo: number;
  tiles: number;
  savedAt: number;
  layerId: string;
}

/** Hard cap on tiles per saved region so a careless "High detail" over a huge
 *  view can't try to download the planet. */
export const SAVE_TILE_CAP = 4000;

const REGIONS_KEY = "maps.offlineRegions";

export function loadRegions(): OfflineRegion[] {
  try {
    const v = JSON.parse(localStorage.getItem(REGIONS_KEY) || "[]");
    return Array.isArray(v) ? (v as OfflineRegion[]) : [];
  } catch {
    return [];
  }
}

function persistRegions(rs: OfflineRegion[]): void {
  try {
    localStorage.setItem(REGIONS_KEY, JSON.stringify(rs));
  } catch {
    /* best-effort */
  }
}

// ---- slippy-tile math ------------------------------------------------------
function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function latToTileY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z,
  );
}

function tilesForBounds(
  b: Bounds,
  zoomFrom: number,
  zoomTo: number,
): Array<{ x: number; y: number; z: number }> {
  const out: Array<{ x: number; y: number; z: number }> = [];
  for (let z = zoomFrom; z <= zoomTo; z++) {
    const xs = [lonToTileX(b.west, z), lonToTileX(b.east, z)].sort(
      (a, c) => a - c,
    );
    const ys = [latToTileY(b.north, z), latToTileY(b.south, z)].sort(
      (a, c) => a - c,
    );
    for (let x = xs[0]; x <= xs[1]; x++)
      for (let y = ys[0]; y <= ys[1]; y++) out.push({ x, y, z });
  }
  return out;
}

/** Tile count for a bounds + zoom range — drives the live estimate in the
 *  detail prompt so the user sees the cost before downloading. */
export function estimateTiles(
  b: Bounds,
  zoomFrom: number,
  zoomTo: number,
): number {
  return tilesForBounds(b, zoomFrom, zoomTo).length;
}

function urlFor(def: LayerDef, x: number, y: number, z: number): string {
  return def.url
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}

/** Download + cache every tile for a region, recording it in the registry.
 *  Pooled fetches; capped at SAVE_TILE_CAP. */
export async function downloadRegion(
  def: LayerDef,
  layerId: string,
  b: Bounds,
  zoomFrom: number,
  zoomTo: number,
  label: string,
  onProgress: (done: number, total: number) => void,
): Promise<{ region: OfflineRegion; capped: boolean }> {
  const all = tilesForBounds(b, zoomFrom, zoomTo);
  const capped = all.length > SAVE_TILE_CAP;
  const work = all.slice(0, SAVE_TILE_CAP);
  if (typeof caches !== "undefined") {
    const cache = await caches.open(TILE_CACHE);
    let done = 0;
    let i = 0;
    const POOL = 6;
    const worker = async () => {
      while (i < work.length) {
        const t = work[i++];
        const u = urlFor(def, t.x, t.y, t.z);
        try {
          if (!(await cache.match(u))) {
            const r = await fetch(u, { mode: "cors" });
            if (r.ok) await cache.put(u, r.clone());
          }
        } catch {
          /* skip unreachable tiles */
        }
        onProgress(++done, work.length);
      }
    };
    await Promise.all(Array.from({ length: POOL }, worker));
    await navigator.storage?.persist?.().catch(() => {});
  }
  const region: OfflineRegion = {
    id: `${b.south.toFixed(3)}_${b.west.toFixed(3)}_${zoomFrom}_${zoomTo}_${layerId}`,
    label,
    south: b.south,
    west: b.west,
    north: b.north,
    east: b.east,
    zoomFrom,
    zoomTo,
    tiles: work.length,
    savedAt: Date.now(),
    layerId,
  };
  persistRegions([region, ...loadRegions().filter((r) => r.id !== region.id)]);
  return { region, capped };
}

/** Remove a region's tiles from the cache + drop it from the registry. */
export async function deleteRegion(region: OfflineRegion): Promise<void> {
  if (typeof caches !== "undefined") {
    const def = LAYERS[region.layerId] ?? LAYERS.streets;
    const cache = await caches.open(TILE_CACHE);
    const coords = tilesForBounds(
      region,
      region.zoomFrom,
      region.zoomTo,
    ).slice(0, SAVE_TILE_CAP);
    await Promise.all(
      coords.map((t) =>
        cache.delete(urlFor(def, t.x, t.y, t.z)).catch(() => false),
      ),
    );
  }
  persistRegions(loadRegions().filter((r) => r.id !== region.id));
}

/** Best-effort total Cache/IndexedDB usage for the origin (browser estimate). */
export async function storageEstimate(): Promise<{
  usage: number;
  quota: number;
}> {
  try {
    const e = await navigator.storage?.estimate?.();
    return { usage: e?.usage ?? 0, quota: e?.quota ?? 0 };
  } catch {
    return { usage: 0, quota: 0 };
  }
}

/** Human-readable byte size. */
export function fmtBytes(n: number): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}
