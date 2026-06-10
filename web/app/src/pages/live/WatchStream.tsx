import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Chip,
  CircularProgress,
  Stack,
  Alert,
} from "@mui/joy";
import LiveTvIcon from "@mui/icons-material/LiveTv";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import { getStream } from "./api";
import type { LiveStream } from "./types";
import { HlsPlayer } from "./HlsPlayer";

interface WatchStreamProps {
  /** The signed-in user, or null for the public (signed-out) watch route. When
   *  null we render a minimal chrome (no app Header user menu). */
  user: User | null;
  /** When true this is the public route (/live/p/:id) — a 404/403 means the
   *  stream isn't public and the viewer should be told to sign in. */
  publicRoute?: boolean;
}

/**
 * WatchStream plays a single live stream via HLS under grown's origin. It polls
 * GetStream so the LIVE/offline badge and player react to the publisher
 * starting/stopping.
 */
export default function WatchStream({ user, publicRoute }: WatchStreamProps) {
  const { id = "" } = useParams();
  const [stream, setStream] = useState<LiveStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await getStream(id);
      setStream(s);
      setError(null);
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
    } finally {
      setLoaded(true);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll status so the player flips with the publisher.
  useEffect(() => {
    const t = setInterval(() => {
      void load();
    }, 8000);
    return () => clearInterval(t);
  }, [load]);

  const live = stream?.status === "live";

  return (
    <>
      <Header user={user} />
      <Container sx={{ py: 3, maxWidth: 1000 }}>
        {!loaded ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        ) : error || !stream ? (
          <Alert color="danger">
            {publicRoute && !user
              ? "This stream isn't available. It may be private — sign in to your organization to watch."
              : `Stream not found.`}
          </Alert>
        ) : (
          <Stack spacing={2}>
            <HlsPlayer src={stream.hls_url} live={!!live} />
            <Box>
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ mb: 0.5 }}
              >
                {live ? (
                  <Chip color="danger" variant="solid">
                    LIVE
                  </Chip>
                ) : (
                  <Chip color="neutral" variant="soft">
                    Offline
                  </Chip>
                )}
                {stream.visibility === "public" && (
                  <Chip variant="soft" color="primary">
                    Public
                  </Chip>
                )}
              </Stack>
              <Typography level="h3" startDecorator={<LiveTvIcon />}>
                {stream.title || "Untitled stream"}
              </Typography>
              <Typography level="body-sm" color="neutral">
                {stream.owner_name || "Unknown"}
              </Typography>
              {stream.description && (
                <Typography
                  level="body-md"
                  sx={{ mt: 1, whiteSpace: "pre-wrap" }}
                >
                  {stream.description}
                </Typography>
              )}
            </Box>
          </Stack>
        )}
      </Container>
    </>
  );
}
