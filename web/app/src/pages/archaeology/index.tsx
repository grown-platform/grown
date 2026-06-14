/**
 * Archaeology — browse the Earth and read up on archaeological sites.
 *
 * A Leaflet map loads archaeological sites for whatever you're looking at (live
 * from Wikidata, see wikidata.ts); tap a site to read about it and what's been
 * found there (Wikipedia summary + structured facts). Client-side only — no
 * grown backend. Leaflet lives in this lazy route's chunk.
 */
import { useEffect, useRef, useState } from "react";
import {
  Box,
  Container,
  Stack,
  Typography,
  Chip,
  Sheet,
  CircularProgress,
  IconButton,
  Link,
  AspectRatio,
  Divider,
} from "@mui/joy";
import MuseumIcon from "@mui/icons-material/Museum";
import CloseIcon from "@mui/icons-material/Close";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import {
  sitesInBounds,
  siteDetail,
  type Site,
  type SiteDetail,
} from "./wikidata";

const ACCENT = "#8d6e63";
// Below this zoom the bbox is too large/dense to query usefully — prompt to zoom.
const MIN_ZOOM = 6;

export default function ArchaeologyApp({ user }: { user: User }) {
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const debounceRef = useRef<number | null>(null);

  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [zoomedOut, setZoomedOut] = useState(false);
  const [selected, setSelected] = useState<Site | null>(null);
  const [detail, setDetail] = useState<SiteDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Create the map once.
  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;
    const map = L.map(mapElRef.current, { zoomControl: true }).setView(
      [37.97, 23.72], // Athens — somewhere rich in sites to start
      11,
    );
    mapRef.current = map;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors · sites © Wikidata/Wikipedia",
      maxZoom: 19,
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);

    const refresh = () => {
      const z = map.getZoom();
      if (z < MIN_ZOOM) {
        setZoomedOut(true);
        setCount(null);
        layerRef.current?.clearLayers();
        return;
      }
      setZoomedOut(false);
      const b = map.getBounds();
      setLoading(true);
      sitesInBounds({
        south: b.getSouth(),
        west: b.getWest(),
        north: b.getNorth(),
        east: b.getEast(),
      })
        .then((sites) => {
          const lg = layerRef.current;
          if (!lg) return;
          lg.clearLayers();
          for (const s of sites) {
            L.circleMarker([s.lat, s.lon], {
              radius: 6,
              color: "#fff",
              weight: 1.5,
              fillColor: ACCENT,
              fillOpacity: 0.9,
            })
              .addTo(lg)
              .bindTooltip(s.title)
              .on("click", () => openSite(s));
          }
          setCount(sites.length);
        })
        .catch(() => setCount(null))
        .finally(() => setLoading(false));
    };

    const onMove = () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(refresh, 450);
    };
    map.on("moveend", onMove);
    refresh();
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openSite(s: Site) {
    setSelected(s);
    setDetail(null);
    setDetailLoading(true);
    mapRef.current?.panTo([s.lat, s.lon]);
    siteDetail(s)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }

  function locate() {
    navigator.geolocation?.getCurrentPosition(
      (pos) => mapRef.current?.setView([pos.coords.latitude, pos.coords.longitude], 12),
      () => {},
    );
  }

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.body" }}>
      <Header user={user} />
      <Container sx={{ py: 3 }} maxWidth={false}>
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1 }}>
          <MuseumIcon sx={{ color: ACCENT, fontSize: 30 }} />
          <Typography level="h2">Archaeology</Typography>
          {loading && <CircularProgress size="sm" />}
          {count != null && !loading && (
            <Chip size="sm" variant="soft">
              {count} site{count === 1 ? "" : "s"} in view
            </Chip>
          )}
          <Box sx={{ flex: 1 }} />
          <IconButton size="sm" variant="outlined" onClick={locate} aria-label="My location">
            <MyLocationIcon />
          </IconButton>
        </Stack>
        <Typography level="body-xs" sx={{ mb: 1.5, opacity: 0.7 }}>
          Pan and zoom anywhere on Earth — archaeological sites load for your view.
          Tap a marker to read about the site and what's been found.
        </Typography>

        <Box sx={{ position: "relative" }}>
          <Box
            ref={mapElRef}
            sx={{
              height: "calc(100vh - 210px)",
              minHeight: 440,
              borderRadius: "md",
              overflow: "hidden",
              border: "1px solid",
              borderColor: "divider",
            }}
          />

          {zoomedOut && (
            <Sheet
              variant="soft"
              sx={{
                position: "absolute",
                top: 12,
                left: "50%",
                transform: "translateX(-50%)",
                px: 2,
                py: 0.75,
                borderRadius: "xl",
                zIndex: 500,
                boxShadow: "sm",
              }}
            >
              <Typography level="body-sm">Zoom in to load sites</Typography>
            </Sheet>
          )}

          {/* Detail panel */}
          {selected && (
            <Sheet
              variant="outlined"
              sx={{
                position: "absolute",
                top: 12,
                right: 12,
                bottom: 12,
                width: { xs: "calc(100% - 24px)", sm: 360 },
                zIndex: 600,
                borderRadius: "md",
                overflow: "auto",
                boxShadow: "md",
                p: 2,
              }}
            >
              <Stack direction="row" alignItems="flex-start" sx={{ mb: 1 }}>
                <Typography level="title-lg" sx={{ flex: 1, pr: 1 }}>
                  {selected.title}
                </Typography>
                <IconButton
                  size="sm"
                  variant="plain"
                  onClick={() => setSelected(null)}
                  aria-label="Close"
                >
                  <CloseIcon />
                </IconButton>
              </Stack>

              {detailLoading && (
                <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                  <CircularProgress size="sm" />
                </Box>
              )}

              {detail && (
                <>
                  {detail.image && (
                    <AspectRatio ratio="16/9" sx={{ borderRadius: "sm", mb: 1.5 }}>
                      <img src={detail.image} alt={detail.title} loading="lazy" />
                    </AspectRatio>
                  )}
                  {detail.facts.length > 0 && (
                    <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.5} sx={{ mb: 1.5 }}>
                      {detail.facts.map((f) => (
                        <Chip key={f.label} size="sm" variant="soft">
                          {f.label}: {f.value}
                        </Chip>
                      ))}
                    </Stack>
                  )}
                  <Typography level="body-sm" sx={{ whiteSpace: "pre-wrap", mb: 1.5 }}>
                    {detail.extract}
                  </Typography>
                  <Divider sx={{ my: 1 }} />
                  <Stack direction="row" spacing={2}>
                    {detail.wikipediaUrl && (
                      <Link href={detail.wikipediaUrl} target="_blank" level="body-sm">
                        Read on Wikipedia →
                      </Link>
                    )}
                    <Link href={detail.wikidataUrl} target="_blank" level="body-sm">
                      Wikidata
                    </Link>
                  </Stack>
                </>
              )}
            </Sheet>
          )}
        </Box>
        <Typography level="body-xs" sx={{ mt: 1, opacity: 0.55 }}>
          Site data from Wikidata; summaries from Wikipedia (CC BY-SA). Coverage
          reflects what the open community has mapped — denser in well-studied regions.
        </Typography>
      </Container>
    </Box>
  );
}
