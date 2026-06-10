import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Sheet,
  CircularProgress,
  IconButton,
  Button,
  AspectRatio,
} from "@mui/joy";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import DeleteIcon from "@mui/icons-material/Delete";
import MovieIcon from "@mui/icons-material/Movie";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import {
  listVideoPlaylistVideos,
  removeFromVideoPlaylist,
  streamUrl,
} from "./api";
import type { Video } from "./types";
import { formatDuration, formatBytes } from "./media";

interface PlaylistDetailProps {
  user: User;
}

export function PlaylistDetail({ user }: PlaylistDetailProps) {
  const { id: playlistId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!playlistId) return;
    setVideos(null);
    listVideoPlaylistVideos(playlistId)
      .then((vs) => {
        setVideos(vs);
        setCurrentIdx(0);
      })
      .catch((e) => setError((e as Error).message));
  }, [playlistId]);

  const current = videos?.[currentIdx] ?? null;

  function handleEnded() {
    if (!videos) return;
    if (currentIdx < videos.length - 1) {
      setCurrentIdx((i) => i + 1);
    }
  }

  // Reload and auto-play when currentIdx changes.
  useEffect(() => {
    if (videoRef.current && current) {
      videoRef.current.load();
      videoRef.current.play().catch(() => {});
    }
  }, [currentIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRemove(v: Video) {
    if (!playlistId) return;
    if (!window.confirm(`Remove "${v.title}" from this playlist?`)) return;
    await removeFromVideoPlaylist(playlistId, v.id);
    setVideos((cur) => (cur ?? []).filter((x) => x.id !== v.id));
  }

  return (
    <>
      <Header user={user} />
      <Container
        maxWidth="lg"
        sx={{ py: { xs: 2, sm: 4 }, px: { xs: 1.5, sm: 3 } }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
          <IconButton
            variant="plain"
            onClick={() => navigate("/video")}
            aria-label="Back"
          >
            <ArrowBackIcon />
          </IconButton>
          <Typography level="body-sm" sx={{ opacity: 0.7 }}>
            Back to library
          </Typography>
        </Box>

        {error && (
          <Sheet
            color="danger"
            variant="soft"
            sx={{ p: 2, mb: 2, borderRadius: "md" }}
          >
            <Typography color="danger">{error}</Typography>
          </Sheet>
        )}

        {videos === null && !error && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
            <CircularProgress />
          </Box>
        )}

        {videos !== null && (
          <Box
            sx={{
              display: "flex",
              gap: 3,
              flexWrap: { xs: "wrap", md: "nowrap" },
            }}
          >
            {/* Player */}
            <Box sx={{ flex: "0 0 auto", width: { xs: "100%", md: "60%" } }}>
              {current ? (
                <>
                  <Box
                    sx={{
                      borderRadius: "md",
                      overflow: "hidden",
                      bgcolor: "#000",
                    }}
                  >
                    <video
                      ref={videoRef}
                      key={current.id}
                      controls
                      autoPlay
                      playsInline
                      poster={current.thumbnail_data_url || undefined}
                      src={streamUrl(current.id)}
                      onEnded={handleEnded}
                      style={{
                        width: "100%",
                        maxHeight: "60vh",
                        display: "block",
                        backgroundColor: "#000",
                      }}
                    />
                  </Box>
                  <Box
                    sx={{
                      mt: 1,
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                    }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography level="title-md" noWrap>
                        {current.title || "Untitled"}
                      </Typography>
                      <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                        {currentIdx + 1} / {videos.length}
                        {current.duration_seconds > 0
                          ? ` · ${formatDuration(current.duration_seconds)}`
                          : ""}
                      </Typography>
                    </Box>
                    {currentIdx < videos.length - 1 && (
                      <Button
                        size="sm"
                        variant="outlined"
                        endDecorator={<SkipNextIcon />}
                        onClick={() => setCurrentIdx((i) => i + 1)}
                      >
                        Next
                      </Button>
                    )}
                  </Box>
                </>
              ) : (
                <Sheet
                  variant="soft"
                  sx={{ p: 4, borderRadius: "md", textAlign: "center" }}
                >
                  <MovieIcon sx={{ fontSize: 48, opacity: 0.3 }} />
                  <Typography level="body-md" sx={{ opacity: 0.6, mt: 1 }}>
                    This playlist is empty.
                  </Typography>
                </Sheet>
              )}
            </Box>

            {/* Queue */}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography level="title-sm" sx={{ mb: 1, opacity: 0.7 }}>
                Queue ({videos.length})
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {videos.map((v, idx) => (
                  <Sheet
                    key={v.id}
                    variant={idx === currentIdx ? "soft" : "outlined"}
                    sx={{
                      p: 1,
                      borderRadius: "md",
                      display: "flex",
                      gap: 1.5,
                      alignItems: "center",
                      cursor: "pointer",
                      "&:hover": { boxShadow: "sm" },
                    }}
                    onClick={() => setCurrentIdx(idx)}
                  >
                    <AspectRatio
                      ratio="16/9"
                      sx={{ width: 80, flexShrink: 0, borderRadius: "sm" }}
                    >
                      {v.thumbnail_data_url ? (
                        <img
                          src={v.thumbnail_data_url}
                          alt={v.title}
                          loading="lazy"
                        />
                      ) : (
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            bgcolor: "neutral.softBg",
                          }}
                        >
                          <MovieIcon sx={{ fontSize: 20, opacity: 0.4 }} />
                        </Box>
                      )}
                    </AspectRatio>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography level="body-sm" noWrap>
                        {v.title || "Untitled"}
                      </Typography>
                      <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                        {[
                          formatBytes(v.size),
                          v.duration_seconds > 0
                            ? formatDuration(v.duration_seconds)
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Typography>
                    </Box>
                    {idx === currentIdx && (
                      <PlayArrowIcon sx={{ opacity: 0.6, flexShrink: 0 }} />
                    )}
                    <IconButton
                      size="sm"
                      variant="plain"
                      color="neutral"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemove(v);
                      }}
                      aria-label="Remove from playlist"
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Sheet>
                ))}
              </Box>
            </Box>
          </Box>
        )}
      </Container>
    </>
  );
}
