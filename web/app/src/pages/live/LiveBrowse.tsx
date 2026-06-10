import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Button,
  Card,
  CardContent,
  AspectRatio,
  Chip,
  CircularProgress,
  Tabs,
  TabList,
  Tab,
  IconButton,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  Stack,
} from "@mui/joy";
import VideocamIcon from "@mui/icons-material/Videocam";
import LiveTvIcon from "@mui/icons-material/LiveTv";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import DeleteIcon from "@mui/icons-material/Delete";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import { listStreams, deleteStream, endStream } from "./api";
import type { LiveStream, StreamFilter } from "./types";

interface LiveBrowseProps {
  user: User;
}

/**
 * LiveBrowse is the Live home: a Go Live button plus tabs to browse currently-
 * live streams, the caller's own streams, or all org streams. Clicking a stream
 * opens the watch page.
 */
export function LiveBrowse({ user }: LiveBrowseProps) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<StreamFilter>("live");
  const [streams, setStreams] = useState<LiveStream[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (f: StreamFilter) => {
    setStreams(null);
    try {
      setStreams(await listStreams(f));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setStreams([]);
    }
  }, []);

  useEffect(() => {
    void reload(filter);
  }, [filter, reload]);

  // Poll the live tab so the grid updates as people go live/offline.
  useEffect(() => {
    if (filter !== "live") return;
    const t = setInterval(() => {
      void reload("live");
    }, 10000);
    return () => clearInterval(t);
  }, [filter, reload]);

  async function onDelete(s: LiveStream) {
    if (!confirm(`Delete "${s.title || "Untitled"}"? This cannot be undone.`))
      return;
    await deleteStream(s.id);
    void reload(filter);
  }
  async function onEnd(s: LiveStream) {
    await endStream(s.id);
    void reload(filter);
  }

  return (
    <>
      <Header user={user} />
      <Container sx={{ py: 3 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 2,
            mb: 2,
          }}
        >
          <Typography level="h2" startDecorator={<LiveTvIcon />}>
            Live
          </Typography>
          <Button
            startDecorator={<VideocamIcon />}
            onClick={() => navigate("/live/new")}
          >
            Go Live
          </Button>
        </Box>

        <Tabs
          value={filter}
          onChange={(_, v) => setFilter(v as StreamFilter)}
          sx={{ bgcolor: "transparent", mb: 2 }}
        >
          <TabList>
            <Tab value="live">Live now</Tab>
            <Tab value="mine">My streams</Tab>
            <Tab value="all">All</Tab>
          </TabList>
        </Tabs>

        {error && (
          <Typography color="danger" sx={{ mb: 2 }}>
            Error: {error}
          </Typography>
        )}

        {streams === null ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        ) : streams.length === 0 ? (
          <EmptyState filter={filter} onGoLive={() => navigate("/live/new")} />
        ) : (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 2,
            }}
          >
            {streams.map((s) => (
              <StreamCard
                key={s.id}
                stream={s}
                isOwner={s.owner_id === user.id}
                onOpen={() => navigate(`/live/watch/${s.id}`)}
                onDelete={() => onDelete(s)}
                onEnd={() => onEnd(s)}
              />
            ))}
          </Box>
        )}
      </Container>
    </>
  );
}

function EmptyState({
  filter,
  onGoLive,
}: {
  filter: StreamFilter;
  onGoLive: () => void;
}) {
  const msg =
    filter === "live"
      ? "No one is live right now."
      : filter === "mine"
        ? "You haven't created any streams yet."
        : "No streams yet.";
  return (
    <Box sx={{ textAlign: "center", py: 8, color: "text.tertiary" }}>
      <LiveTvIcon sx={{ fontSize: 48, opacity: 0.4 }} />
      <Typography sx={{ mt: 1, mb: 2 }}>{msg}</Typography>
      <Button startDecorator={<VideocamIcon />} onClick={onGoLive}>
        Go Live
      </Button>
    </Box>
  );
}

function StreamCard({
  stream,
  isOwner,
  onOpen,
  onDelete,
  onEnd,
}: {
  stream: LiveStream;
  isOwner: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onEnd: () => void;
}) {
  const live = stream.status === "live";
  return (
    <Card
      variant="outlined"
      sx={{ overflow: "hidden", "&:hover": { boxShadow: "md" } }}
    >
      <AspectRatio
        ratio="16/9"
        sx={{ cursor: "pointer", bgcolor: "neutral.softBg" }}
        onClick={onOpen}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <LiveTvIcon sx={{ fontSize: 40, opacity: 0.35 }} />
        </Box>
      </AspectRatio>
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
          {live ? (
            <Chip size="sm" color="danger" variant="solid">
              LIVE
            </Chip>
          ) : (
            <Chip size="sm" color="neutral" variant="soft">
              Offline
            </Chip>
          )}
          {stream.visibility === "public" && (
            <Chip size="sm" variant="soft" color="primary">
              Public
            </Chip>
          )}
          <Box sx={{ flex: 1 }} />
          {isOwner && (
            <Dropdown>
              <MenuButton
                slots={{ root: IconButton }}
                slotProps={{ root: { size: "sm", variant: "plain" } }}
              >
                <MoreVertIcon />
              </MenuButton>
              <Menu placement="bottom-end">
                {live && (
                  <MenuItem onClick={onEnd}>
                    <StopCircleIcon /> End stream
                  </MenuItem>
                )}
                <MenuItem color="danger" onClick={onDelete}>
                  <DeleteIcon /> Delete
                </MenuItem>
              </Menu>
            </Dropdown>
          )}
        </Stack>
        <Typography
          level="title-md"
          sx={{ cursor: "pointer" }}
          onClick={onOpen}
          noWrap
        >
          {stream.title || "Untitled stream"}
        </Typography>
        <Typography level="body-sm" color="neutral" noWrap>
          {stream.owner_name || "Unknown"}
        </Typography>
      </CardContent>
    </Card>
  );
}
