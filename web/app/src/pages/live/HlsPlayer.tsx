import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { Box, CircularProgress, Typography } from "@mui/joy";

interface HlsPlayerProps {
  /** HLS playlist URL (e.g. /live-hls/<path>/index.m3u8). */
  src: string;
  /** Optional poster shown before playback. */
  poster?: string;
  /** Whether the stream is currently live; when false we show an offline note
   *  instead of retrying the (404) playlist forever. */
  live: boolean;
}

/**
 * HlsPlayer plays a live HLS stream. It uses hls.js where supported (Chrome,
 * Firefox, Edge) and falls back to the browser's native HLS for Safari/iOS,
 * which can play .m3u8 directly via a plain <video src>.
 *
 * For live streams the playlist may 404 briefly between "stream created" and
 * "first segment published", so hls.js is configured to retry; we surface a
 * lightweight loading state until the first fragment arrives.
 */
export function HlsPlayer({ src, poster, live }: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setError(null);
    setLoading(true);

    // Safari / iOS: native HLS. Assign src directly.
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      const onLoaded = () => setLoading(false);
      video.addEventListener("loadeddata", onLoaded);
      return () => {
        video.removeEventListener("loadeddata", onLoaded);
        video.removeAttribute("src");
        video.load();
      };
    }

    if (!Hls.isSupported()) {
      setError("This browser cannot play HLS.");
      setLoading(false);
      return;
    }

    const hls = new Hls({
      // Live tuning: keep latency low, retry while the publisher warms up.
      lowLatencyMode: true,
      liveSyncDurationCount: 3,
      manifestLoadingMaxRetry: 8,
      manifestLoadingRetryDelay: 1000,
    });
    hls.loadSource(src);
    hls.attachMedia(video);
    hls.on(Hls.Events.FRAG_BUFFERED, () => setLoading(false));
    hls.on(Hls.Events.ERROR, (_evt, data) => {
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            hls.recoverMediaError();
            break;
          default:
            setError("Playback error.");
            hls.destroy();
        }
      }
    });

    return () => hls.destroy();
  }, [src]);

  return (
    <Box
      sx={{
        position: "relative",
        width: "100%",
        bgcolor: "black",
        borderRadius: "sm",
        overflow: "hidden",
      }}
    >
      <video
        ref={videoRef}
        controls
        autoPlay
        playsInline
        muted
        poster={poster}
        style={{
          width: "100%",
          maxHeight: "70vh",
          display: "block",
          background: "black",
        }}
      />
      {loading && live && !error && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 1,
            color: "white",
          }}
        >
          <CircularProgress />
          <Typography level="body-sm" sx={{ color: "white" }}>
            Connecting to live stream…
          </Typography>
        </Box>
      )}
      {!live && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
          }}
        >
          <Typography level="title-md" sx={{ color: "white" }}>
            This stream is offline.
          </Typography>
        </Box>
      )}
      {error && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            p: 2,
            textAlign: "center",
          }}
        >
          <Typography level="body-md" sx={{ color: "white" }}>
            {error}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
