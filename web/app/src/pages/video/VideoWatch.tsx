import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Box, CircularProgress, Container, Typography, Sheet } from "@mui/joy";
import MovieIcon from "@mui/icons-material/Movie";
import { getSharedVideoInfo, sharedStreamUrl } from "./api";
import type { VideoPublicInfo } from "./types";
import { formatDuration } from "./media";

/** VideoWatch is the public, unauthenticated video player rendered at
 *  /video/watch/:token. No app shell — minimal chrome so it can be shared
 *  externally like a YouTube link. */
export default function VideoWatch() {
  const { token = "" } = useParams<{ token: string }>();
  const [info, setInfo] = useState<VideoPublicInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!token) return;
    getSharedVideoInfo(token)
      .then((v) => {
        if (!cancelled) setInfo(v);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (error) {
    return (
      <Container maxWidth="sm" sx={{ py: 8, textAlign: "center" }}>
        <MovieIcon sx={{ fontSize: 56, opacity: 0.3, mb: 2 }} />
        <Typography level="h3">Video unavailable</Typography>
        <Typography level="body-md" sx={{ opacity: 0.7, mt: 1 }}>
          This link may have expired or been revoked.
        </Typography>
      </Container>
    );
  }

  if (!info) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.body" }}>
      {/* Minimal header */}
      <Sheet
        variant="plain"
        sx={{
          px: { xs: 2, sm: 3 },
          py: 1.5,
          display: "flex",
          alignItems: "center",
          gap: 1,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <MovieIcon sx={{ opacity: 0.7 }} />
        <Typography level="title-md" sx={{ flex: 1 }} noWrap>
          {info.title || "Untitled video"}
        </Typography>
      </Sheet>

      <Container
        maxWidth="md"
        sx={{ py: { xs: 2, sm: 4 }, px: { xs: 1.5, sm: 3 } }}
      >
        {/* Player */}
        <Box sx={{ borderRadius: "md", overflow: "hidden", bgcolor: "#000" }}>
          <video
            key={token}
            controls
            autoPlay
            playsInline
            poster={info.thumbnail_data_url || undefined}
            src={sharedStreamUrl(token)}
            style={{
              width: "100%",
              maxHeight: "70vh",
              display: "block",
              backgroundColor: "#000",
            }}
          />
        </Box>

        {/* Metadata */}
        <Box sx={{ mt: 2 }}>
          <Typography level="h3" sx={{ fontSize: { xs: "xl", sm: "xl3" } }}>
            {info.title || "Untitled video"}
          </Typography>
          {info.duration_seconds > 0 && (
            <Typography level="body-sm" sx={{ opacity: 0.7, mt: 0.5 }}>
              {formatDuration(info.duration_seconds)}
            </Typography>
          )}
          {info.description && (
            <Sheet variant="soft" sx={{ p: 2, mt: 2, borderRadius: "md" }}>
              <Typography level="body-sm" sx={{ whiteSpace: "pre-wrap" }}>
                {info.description}
              </Typography>
            </Sheet>
          )}
        </Box>
      </Container>
    </Box>
  );
}
