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
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  ListDivider,
  Switch,
  FormControl,
  FormLabel,
} from "@mui/joy";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteIcon from "@mui/icons-material/Delete";
import ShareIcon from "@mui/icons-material/Share";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import ClosedCaptionIcon from "@mui/icons-material/ClosedCaption";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import {
  getVideo,
  deleteVideo,
  downloadUrl,
  streamUrl,
  getVideoProgress,
  setVideoProgress,
  listVideoCaptions,
  deleteVideoCaption,
  captionUploadUrl,
} from "./api";
import type { Video, VideoCaption } from "./types";
import { formatBytes, formatDuration } from "./media";
import { VideoShareDialog } from "./VideoShareDialog";

interface VideoPlayerProps {
  user: User;
}

const REPORT_INTERVAL_S = 5; // report progress every 5 s of play

export function VideoPlayer({ user }: VideoPlayerProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [video, setVideo] = useState<Video | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [captions, setCaptions] = useState<VideoCaption[]>([]);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [captionUploading, setCaptionUploading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastReportedRef = useRef(0);
  const resumePositionRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    if (!id) return;
    setVideo(null);
    setError(null);
    Promise.all([
      getVideo(id),
      getVideoProgress(id).catch(() => null),
      listVideoCaptions(id).catch(() => [] as VideoCaption[]),
    ])
      .then(([v, prog, caps]) => {
        if (cancelled) return;
        setVideo(v);
        setCaptions(caps);
        if (prog && prog.position_seconds > 0 && !prog.watched) {
          resumePositionRef.current = prog.position_seconds;
        }
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  function handleLoadedMetadata() {
    if (resumePositionRef.current > 0 && videoRef.current) {
      videoRef.current.currentTime = resumePositionRef.current;
      resumePositionRef.current = 0;
    }
  }

  function handleTimeUpdate() {
    const el = videoRef.current;
    if (!el || !id) return;
    const pos = el.currentTime;
    const dur = el.duration;
    if (!dur || dur <= 0) return;
    const pct = pos / dur;
    if (Math.abs(pos - lastReportedRef.current) >= REPORT_INTERVAL_S) {
      lastReportedRef.current = pos;
      setVideoProgress(id, pos, pct).catch(() => {
        /* best-effort */
      });
    }
  }

  function handlePauseOrEnd() {
    const el = videoRef.current;
    if (!el || !id) return;
    const pos = el.currentTime;
    const dur = el.duration;
    if (!dur) return;
    setVideoProgress(id, pos, pos / dur).catch(() => {
      /* best-effort */
    });
  }

  async function remove() {
    if (!video) return;
    if (!window.confirm(`Delete "${video.title || "this video"}"?`)) return;
    try {
      await deleteVideo(video.id);
      navigate("/video");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function uploadCaption(file: File) {
    if (!video) return;
    setCaptionUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const lang = file.name.replace(/\.[^.]+$/, "") || "en";
      form.append("lang", lang);
      form.append("label", lang);
      const resp = await fetch(captionUploadUrl(video.id), {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const c = (await resp.json()) as VideoCaption;
      setCaptions((cur) => [...cur, c]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCaptionUploading(false);
    }
  }

  async function removeCaption(c: VideoCaption) {
    if (!video) return;
    try {
      await deleteVideoCaption(video.id, c.id);
      setCaptions((cur) => cur.filter((x) => x.id !== c.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      {video && (
        <VideoShareDialog
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          videoId={video.id}
          videoTitle={video.title || "Untitled video"}
        />
      )}
      <Header user={user} />
      <Container
        maxWidth="md"
        sx={{ py: { xs: 2, sm: 4 }, px: { xs: 1.5, sm: 3 } }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
          <IconButton
            variant="plain"
            onClick={() => navigate("/video")}
            aria-label="Back to library"
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
            <Typography color="danger">
              Couldn&apos;t load this video: {error}
            </Typography>
          </Sheet>
        )}

        {!video && !error && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
            <CircularProgress />
          </Box>
        )}

        {video && (
          <>
            <Box
              sx={{ borderRadius: "md", overflow: "hidden", bgcolor: "#000" }}
            >
              <video
                key={video.id}
                ref={videoRef}
                controls
                autoPlay
                playsInline
                poster={video.thumbnail_data_url || undefined}
                src={streamUrl(video.id)}
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={handleTimeUpdate}
                onPause={handlePauseOrEnd}
                onEnded={handlePauseOrEnd}
                style={{
                  width: "100%",
                  maxHeight: "70vh",
                  display: "block",
                  backgroundColor: "#000",
                }}
              >
                {captionsEnabled &&
                  captions.map((c, i) => (
                    <track
                      key={c.id}
                      kind="subtitles"
                      src={c.stream_url}
                      srcLang={c.lang}
                      label={c.label}
                      default={i === 0}
                    />
                  ))}
              </video>
            </Box>

            <Box
              sx={{
                display: "flex",
                alignItems: "flex-start",
                gap: 1,
                mt: 2,
                flexWrap: "wrap",
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0, width: "100%" }}>
                <Typography
                  level="h3"
                  sx={{ fontSize: { xs: "xl", sm: "xl3" } }}
                >
                  {video.title || "Untitled video"}
                </Typography>
                <Typography level="body-sm" sx={{ opacity: 0.7, mt: 0.5 }}>
                  {[
                    formatBytes(video.size),
                    video.duration_seconds > 0
                      ? formatDuration(video.duration_seconds)
                      : "",
                    `Added ${new Date(video.created_at).toLocaleDateString()}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Typography>
              </Box>
              <Button
                variant="outlined"
                color="neutral"
                startDecorator={<ShareIcon />}
                size="sm"
                onClick={() => setShareOpen(true)}
              >
                Share
              </Button>
              <Button
                variant="outlined"
                color="neutral"
                startDecorator={<DownloadIcon />}
                component="a"
                href={downloadUrl(video.id)}
                size="sm"
              >
                Download
              </Button>
              <Dropdown>
                <MenuButton
                  slots={{ root: IconButton }}
                  slotProps={{
                    root: {
                      variant: "outlined",
                      color: "neutral",
                      "aria-label": "More actions",
                    },
                  }}
                >
                  <MoreVertIcon />
                </MenuButton>
                <Menu placement="bottom-end">
                  <MenuItem onClick={() => setShareOpen(true)}>
                    <ShareIcon /> Share
                  </MenuItem>
                  <MenuItem component="a" href={downloadUrl(video.id)}>
                    <DownloadIcon /> Download
                  </MenuItem>
                  <ListDivider />
                  <MenuItem color="danger" onClick={remove}>
                    <DeleteIcon /> Delete
                  </MenuItem>
                </Menu>
              </Dropdown>
            </Box>

            {video.description && (
              <Sheet variant="soft" sx={{ p: 2, mt: 2, borderRadius: "md" }}>
                <Typography level="body-sm" sx={{ whiteSpace: "pre-wrap" }}>
                  {video.description}
                </Typography>
              </Sheet>
            )}

            {/* Captions panel */}
            <Sheet variant="outlined" sx={{ p: 2, mt: 2, borderRadius: "md" }}>
              <Box
                sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}
              >
                <ClosedCaptionIcon sx={{ opacity: 0.7 }} />
                <Typography level="title-sm" sx={{ flex: 1 }}>
                  Captions
                </Typography>
                <FormControl orientation="horizontal" sx={{ gap: 1 }}>
                  <FormLabel sx={{ fontSize: "xs", opacity: 0.7 }}>
                    Show
                  </FormLabel>
                  <Switch
                    checked={captionsEnabled}
                    onChange={(e) => setCaptionsEnabled(e.target.checked)}
                    size="sm"
                  />
                </FormControl>
              </Box>
              {captions.length === 0 && (
                <Typography level="body-xs" sx={{ opacity: 0.6, mb: 1 }}>
                  No captions uploaded yet.
                </Typography>
              )}
              {captions.map((c) => (
                <Box
                  key={c.id}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    mb: 0.5,
                  }}
                >
                  <Typography level="body-sm" sx={{ flex: 1 }}>
                    {c.label} ({c.lang})
                  </Typography>
                  <IconButton
                    size="sm"
                    variant="plain"
                    color="danger"
                    onClick={() => removeCaption(c)}
                    aria-label="Delete caption"
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
              <Button
                size="sm"
                variant="outlined"
                color="neutral"
                startDecorator={<UploadFileIcon />}
                loading={captionUploading}
                component="label"
                sx={{ mt: 1 }}
              >
                Upload .vtt
                <input
                  type="file"
                  accept=".vtt,text/vtt"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadCaption(f);
                  }}
                />
              </Button>
            </Sheet>
          </>
        )}
      </Container>
    </>
  );
}
