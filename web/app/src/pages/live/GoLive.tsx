import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Button,
  Card,
  CardContent,
  FormControl,
  FormLabel,
  Input,
  Textarea,
  Select,
  Option,
  Stack,
  IconButton,
  Chip,
  Divider,
  Alert,
  Tooltip,
} from "@mui/joy";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import VideocamIcon from "@mui/icons-material/Videocam";
import ScreenShareIcon from "@mui/icons-material/ScreenShare";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import { createStream, endStream } from "./api";
import type { LiveStream } from "./types";
import {
  captureMedia,
  publishWhip,
  type WhipSession,
  type CaptureKind,
} from "./whip";

interface GoLiveProps {
  user: User;
}

/**
 * GoLive creates a stream, then offers two ways to publish:
 *  (a) RTMP ingest URL + stream key for OBS/streaming software (copy buttons);
 *  (b) "Go live from browser" — publishes the webcam or screen over WHIP.
 */
export default function GoLive({ user }: GoLiveProps) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"org" | "public">("org");
  const [creating, setCreating] = useState(false);
  const [stream, setStream] = useState<LiveStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onCreate() {
    if (!title.trim()) {
      setError("Give your stream a title.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const s = await createStream({
        title: title.trim(),
        description: description.trim(),
        visibility,
      });
      setStream(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <Header user={user} />
      <Container sx={{ py: 3, maxWidth: 760 }}>
        <Typography level="h2" startDecorator={<VideocamIcon />} sx={{ mb: 2 }}>
          Go Live
        </Typography>

        {!stream ? (
          <Card variant="outlined">
            <CardContent>
              <Stack spacing={2}>
                <FormControl required>
                  <FormLabel>Title</FormLabel>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="My live stream"
                    autoFocus
                  />
                </FormControl>
                <FormControl>
                  <FormLabel>Description</FormLabel>
                  <Textarea
                    minRows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional"
                  />
                </FormControl>
                <FormControl>
                  <FormLabel>Who can watch</FormLabel>
                  <Select
                    value={visibility}
                    onChange={(_, v) => v && setVisibility(v)}
                  >
                    <Option value="org">My organization</Option>
                    <Option value="public">Anyone with the link</Option>
                  </Select>
                </FormControl>
                {error && <Alert color="danger">{error}</Alert>}
                <Box
                  sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}
                >
                  <Button
                    variant="plain"
                    color="neutral"
                    onClick={() => navigate("/live")}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={onCreate}
                    loading={creating}
                    startDecorator={<VideocamIcon />}
                  >
                    Create stream
                  </Button>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        ) : (
          <PublishPanel
            stream={stream}
            onWatch={() => navigate(`/live/watch/${stream.id}`)}
          />
        )}
      </Container>
    </>
  );
}

function CopyField({
  label,
  value,
  secret,
}: {
  label: string;
  value: string;
  secret?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(!secret);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <FormControl>
      <FormLabel>{label}</FormLabel>
      <Input
        readOnly
        value={revealed ? value : "•".repeat(Math.min(value.length, 24))}
        endDecorator={
          <Stack direction="row" spacing={0.5}>
            {secret && (
              <Tooltip title={revealed ? "Hide" : "Reveal"}>
                <IconButton
                  size="sm"
                  variant="plain"
                  onClick={() => setRevealed((r) => !r)}
                >
                  <VisibilityIcon />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title={copied ? "Copied!" : "Copy"}>
              <IconButton size="sm" variant="plain" onClick={copy}>
                <ContentCopyIcon />
              </IconButton>
            </Tooltip>
          </Stack>
        }
      />
    </FormControl>
  );
}

function PublishPanel({
  stream,
  onWatch,
}: {
  stream: LiveStream;
  onWatch: () => void;
}) {
  return (
    <Stack spacing={2}>
      <Alert color="success" variant="soft">
        Stream <b>{stream.title}</b> created. Start publishing with streaming
        software, or go live from your browser below.
      </Alert>

      <Card variant="outlined">
        <CardContent>
          <Typography level="title-md" sx={{ mb: 1 }}>
            Stream with OBS / streaming software
          </Typography>
          <Stack spacing={1.5}>
            <CopyField
              label="Server (RTMP URL)"
              value={stream.ingest_rtmp_url ?? ""}
            />
            <CopyField
              label="Stream key"
              value={stream.stream_key ?? ""}
              secret
            />
            <Alert color="warning" variant="soft" size="sm">
              Keep your stream key secret — anyone with it can broadcast to your
              stream.
            </Alert>
          </Stack>
        </CardContent>
      </Card>

      <Divider>or</Divider>

      <BrowserPublish stream={stream} />

      <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
        <Button variant="soft" onClick={onWatch}>
          Open watch page
        </Button>
      </Box>
    </Stack>
  );
}

function BrowserPublish({ stream }: { stream: LiveStream }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sessionRef = useRef<WhipSession | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // Clean up the WHIP session on unmount.
    return () => {
      void sessionRef.current?.stop();
    };
  }, []);

  async function go(kind: CaptureKind) {
    setErr(null);
    setStarting(true);
    try {
      const media = await captureMedia(kind);
      if (videoRef.current) {
        videoRef.current.srcObject = media;
        await videoRef.current.play().catch(() => {});
      }
      const session = await publishWhip(
        stream.ingest_whip_url ?? "",
        media,
        stream.stream_key ?? "",
      );
      sessionRef.current = session;
      setPublishing(true);
      // If the user stops the screen share via the browser UI, end cleanly.
      media.getVideoTracks()[0]?.addEventListener("ended", () => {
        void stop();
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  async function stop() {
    await sessionRef.current?.stop();
    sessionRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setPublishing(false);
    // Best-effort: also mark offline in grown (MediaMTX notready also handles it).
    try {
      await endStream(stream.id);
    } catch {
      /* ignore */
    }
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography level="title-md" sx={{ mb: 1 }}>
          Go live from your browser
        </Typography>
        <Box
          sx={{
            position: "relative",
            bgcolor: "black",
            borderRadius: "sm",
            overflow: "hidden",
            mb: 1.5,
          }}
        >
          <video
            ref={videoRef}
            muted
            playsInline
            style={{
              width: "100%",
              maxHeight: "40vh",
              display: "block",
              background: "black",
            }}
          />
          {publishing && (
            <Chip
              color="danger"
              variant="solid"
              size="sm"
              sx={{ position: "absolute", top: 8, left: 8 }}
            >
              LIVE
            </Chip>
          )}
        </Box>
        {err && (
          <Alert color="danger" sx={{ mb: 1 }}>
            {err}
          </Alert>
        )}
        {!publishing ? (
          <Stack direction="row" spacing={1}>
            <Button
              startDecorator={<VideocamIcon />}
              loading={starting}
              onClick={() => go("camera")}
            >
              Camera + mic
            </Button>
            <Button
              variant="soft"
              startDecorator={<ScreenShareIcon />}
              loading={starting}
              onClick={() => go("screen")}
            >
              Share screen
            </Button>
          </Stack>
        ) : (
          <Button
            color="danger"
            startDecorator={<StopCircleIcon />}
            onClick={() => void stop()}
          >
            Stop broadcasting
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
