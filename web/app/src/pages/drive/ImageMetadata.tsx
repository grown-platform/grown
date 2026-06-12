import { useEffect, useState } from "react";
import { Box, Typography, Link } from "@mui/joy";
import PlaceIcon from "@mui/icons-material/Place";
import { readImageMeta, type ImageMeta } from "./exif";

/**
 * ImageMetadata reads a photo's embedded EXIF/dimension metadata and renders it
 * as a compact details block: dimensions, camera, lens, capture settings, date
 * taken, and (when present) the GPS capture location with a reverse-geocoded
 * place name and a map link. Renders nothing when the image has no usable
 * embedded metadata.
 */
export function ImageMetadata({ url }: { url: string }) {
  const [meta, setMeta] = useState<ImageMeta | null>(null);
  const [place, setPlace] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMeta(null);
    setPlace(null);
    void (async () => {
      try {
        // EXIF lives at the start of the file; ask for just the first chunk.
        const resp = await fetch(url, { headers: { Range: "bytes=0-262143" } });
        const buf = await resp.arrayBuffer();
        const m = readImageMeta(buf);
        if (cancelled) return;
        setMeta(m);
        if (m.gps) {
          try {
            const r = await fetch(
              `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=${m.gps.lat}&lon=${m.gps.lon}`,
              { headers: { Accept: "application/json" } },
            );
            const d = (await r.json()) as { display_name?: string };
            if (!cancelled && d?.display_name) setPlace(d.display_name);
          } catch {
            /* coordinates-only is fine */
          }
        }
      } catch {
        /* not fetchable / unsupported */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!meta) return null;

  const rows: [string, string][] = [];
  if (meta.width && meta.height) rows.push(["Dimensions", `${meta.width} × ${meta.height}`]);
  const camera = [meta.make, meta.model].filter(Boolean).join(" ");
  if (camera) rows.push(["Camera", camera]);
  if (meta.lens) rows.push(["Lens", meta.lens]);
  if (meta.dateTaken) rows.push(["Taken", meta.dateTaken]);
  const shot = [
    meta.exposure,
    meta.fNumber,
    meta.iso ? `ISO ${meta.iso}` : "",
    meta.focalLength,
  ]
    .filter(Boolean)
    .join(" · ");
  if (shot) rows.push(["Exposure", shot]);
  if (meta.software) rows.push(["Software", meta.software]);

  const g = meta.gps;
  if (rows.length === 0 && !g) return null;

  const ll = g ? `${g.lat.toFixed(6)}, ${g.lon.toFixed(6)}` : "";
  const map = g
    ? `https://www.openstreetmap.org/?mlat=${g.lat}&mlon=${g.lon}#map=15/${g.lat}/${g.lon}`
    : "";

  return (
    <Box
      sx={{
        mb: 2,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: "md",
        overflow: "hidden",
      }}
    >
      <Typography
        level="title-sm"
        sx={{ px: 1.5, py: 1, bgcolor: "background.level1" }}
      >
        Image details
      </Typography>
      <Box sx={{ px: 1.5, py: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
        {rows.map(([label, value]) => (
          <Box key={label} sx={{ display: "flex", gap: 1.5 }}>
            <Typography
              level="body-xs"
              sx={{ width: 88, flexShrink: 0, opacity: 0.6 }}
            >
              {label}
            </Typography>
            <Typography level="body-sm" sx={{ wordBreak: "break-word" }}>
              {value}
            </Typography>
          </Box>
        ))}
        {g && (
          <Box sx={{ display: "flex", gap: 1.5, alignItems: "flex-start", mt: 0.25 }}>
            <Typography level="body-xs" sx={{ width: 88, flexShrink: 0, opacity: 0.6 }}>
              Location
            </Typography>
            <Box sx={{ minWidth: 0 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <PlaceIcon sx={{ fontSize: 16, color: "#d9534f", flexShrink: 0 }} />
                <Typography level="body-sm" sx={{ wordBreak: "break-word" }}>
                  {place || ll}
                </Typography>
              </Box>
              <Link href={map} target="_blank" rel="noopener noreferrer" level="body-xs">
                View on map ↗
              </Link>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
