import { useEffect, useState } from "react";
import { Box, Typography, Link } from "@mui/joy";
import PlaceIcon from "@mui/icons-material/Place";
import { readJpegGps, type GpsCoord } from "./exifGps";

/**
 * ImageLocation reads a photo's EXIF GPS metadata and, when present, shows the
 * capture location under the image preview (a reverse-geocoded place name when
 * available, otherwise coordinates, plus a "view on map" link). Renders nothing
 * for images without GPS data.
 */
export function ImageLocation({ url }: { url: string }) {
  const [coord, setCoord] = useState<GpsCoord | null>(null);
  const [place, setPlace] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCoord(null);
    setPlace(null);
    void (async () => {
      try {
        // EXIF lives at the start of a JPEG; request just the first chunk.
        const resp = await fetch(url, { headers: { Range: "bytes=0-262143" } });
        const buf = await resp.arrayBuffer();
        const gps = readJpegGps(buf);
        if (!gps || cancelled) return;
        setCoord(gps);
        // Best-effort reverse geocode (OpenStreetMap Nominatim).
        try {
          const r = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=${gps.lat}&lon=${gps.lon}`,
            { headers: { Accept: "application/json" } },
          );
          const d = (await r.json()) as { display_name?: string };
          if (!cancelled && d?.display_name) setPlace(d.display_name);
        } catch {
          /* coordinates-only is fine */
        }
      } catch {
        /* not fetchable / not a JPEG with GPS */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!coord) return null;
  const ll = `${coord.lat.toFixed(6)}, ${coord.lon.toFixed(6)}`;
  const map = `https://www.openstreetmap.org/?mlat=${coord.lat}&mlon=${coord.lon}#map=15/${coord.lat}/${coord.lon}`;
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
        flexWrap: "wrap",
        px: 2,
        py: 1.25,
        borderTop: "1px solid",
        borderColor: "divider",
      }}
    >
      <PlaceIcon sx={{ fontSize: 18, color: "#d9534f" }} />
      <Typography level="body-sm" sx={{ maxWidth: 520 }} noWrap title={place || ll}>
        {place || ll}
      </Typography>
      <Link href={map} target="_blank" rel="noopener noreferrer" level="body-sm">
        View on map ↗
      </Link>
    </Box>
  );
}
