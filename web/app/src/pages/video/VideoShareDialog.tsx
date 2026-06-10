import { useEffect, useRef, useState } from "react";
import {
  Modal,
  ModalDialog,
  ModalClose,
  Typography,
  Input,
  Button,
  Box,
  Stack,
  List,
  ListItem,
  IconButton,
  Chip,
  Divider,
  CircularProgress,
  Avatar,
} from "@mui/joy";
import LinkIcon from "@mui/icons-material/Link";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import PersonRemoveIcon from "@mui/icons-material/PersonRemove";
import {
  shareVideo,
  listVideoShares,
  unshareVideo,
  createVideoShareLink,
  listVideoShareLinks,
  revokeVideoShareLink,
} from "./api";
import type { VideoUserShare, VideoShareLink } from "./types";

const API_BASE = "/api/v1";

interface DirectoryMember {
  id: string;
  name: string;
  email: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  videoId: string;
  videoTitle: string;
}

function watchUrl(token: string): string {
  return `${location.origin}/video/watch/${token}`;
}

/** VideoShareDialog lets the owner share a video with specific org users and
 *  create public watch links. */
export function VideoShareDialog({
  open,
  onClose,
  videoId,
  videoTitle,
}: Props) {
  // --- tab state ---
  const [tab, setTab] = useState<"people" | "links">("people");

  // --- people tab ---
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectoryMember[]>([]);
  const [searching, setSearching] = useState(false);
  const [userShares, setUserShares] = useState<VideoUserShare[] | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- links tab ---
  const [links, setLinks] = useState<VideoShareLink[] | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  // Load shares when dialog opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setUserShares(null);
    setLinks(null);
    setQuery("");
    setResults([]);

    listVideoShares(videoId)
      .then(setUserShares)
      .catch((e) => setError((e as Error).message));
    listVideoShareLinks(videoId)
      .then(setLinks)
      .catch((e) => setError((e as Error).message));
  }, [open, videoId]);

  // Debounced directory search.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const resp = await fetch(
          `${API_BASE}/directory?q=${encodeURIComponent(query.trim())}`,
          {
            credentials: "same-origin",
            headers: { Accept: "application/json" },
          },
        );
        if (resp.ok) {
          const data = (await resp.json()) as { members?: DirectoryMember[] };
          setResults(data.members ?? []);
        }
      } catch {
        /* ignore */
      } finally {
        setSearching(false);
      }
    }, 250);
  }, [query]);

  async function addUser(member: DirectoryMember) {
    setAddBusy(true);
    setError(null);
    try {
      const added = await shareVideo(videoId, [member.id]);
      setUserShares((cur) => {
        const existing = cur ?? [];
        // Avoid duplicates.
        const ids = new Set(existing.map((s) => s.user_id));
        return [...existing, ...added.filter((s) => !ids.has(s.user_id))];
      });
      setQuery("");
      setResults([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAddBusy(false);
    }
  }

  async function removeUser(userId: string) {
    try {
      await unshareVideo(videoId, userId);
      setUserShares((cur) => (cur ?? []).filter((s) => s.user_id !== userId));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function createLink() {
    setLinkBusy(true);
    setError(null);
    try {
      const sl = await createVideoShareLink(videoId);
      setLinks((cur) => [sl, ...(cur ?? [])]);
      await copy(sl.token);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLinkBusy(false);
    }
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(watchUrl(token));
      setCopied(token);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  async function revokeLink(token: string) {
    try {
      await revokeVideoShareLink(token);
      setLinks((cur) => (cur ?? []).filter((sl) => sl.token !== token));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Filter out already-shared users from directory results.
  const sharedIds = new Set((userShares ?? []).map((s) => s.user_id));
  const filteredResults = results.filter((m) => !sharedIds.has(m.id));

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        sx={{
          width: { xs: "calc(100vw - 32px)", sm: 540 },
          maxWidth: "calc(100vw - 32px)",
        }}
      >
        <ModalClose />
        <Typography level="h4">Share "{videoTitle}"</Typography>

        {/* Tab bar */}
        <Box
          sx={{
            display: "flex",
            gap: 1,
            mt: 1,
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          {(["people", "links"] as const).map((t) => (
            <Button
              key={t}
              variant="plain"
              color={tab === t ? "primary" : "neutral"}
              size="sm"
              onClick={() => setTab(t)}
              sx={{
                borderRadius: 0,
                borderBottom: tab === t ? "2px solid" : "2px solid transparent",
                pb: 0.5,
              }}
            >
              {t === "people" ? "Share with people" : "Get link"}
            </Button>
          ))}
        </Box>

        {error && (
          <Typography color="danger" level="body-sm" sx={{ mt: 1 }}>
            {error}
          </Typography>
        )}

        {tab === "people" && (
          <Stack spacing={1.5} sx={{ mt: 1.5 }}>
            <Typography level="body-sm" sx={{ opacity: 0.7 }}>
              Share with specific members of your organization.
            </Typography>

            {/* Search input */}
            <Box sx={{ position: "relative" }}>
              <Input
                placeholder="Search by name or email"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                endDecorator={
                  searching ? <CircularProgress size="sm" /> : undefined
                }
                sx={{ width: "100%" }}
              />
              {filteredResults.length > 0 && (
                <Box
                  sx={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    zIndex: 10,
                    bgcolor: "background.surface",
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: "sm",
                    boxShadow: "md",
                    maxHeight: 200,
                    overflow: "auto",
                  }}
                >
                  {filteredResults.map((m) => (
                    <Box
                      key={m.id}
                      sx={{
                        px: 1.5,
                        py: 1,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 1.5,
                        "&:hover": { bgcolor: "neutral.softHoverBg" },
                      }}
                      onClick={() => !addBusy && addUser(m)}
                    >
                      <Avatar size="sm">
                        {(m.name || m.email)[0]?.toUpperCase()}
                      </Avatar>
                      <Box>
                        <Typography level="body-sm" fontWeight={500}>
                          {m.name || m.email}
                        </Typography>
                        {m.name && (
                          <Typography level="body-xs" sx={{ opacity: 0.65 }}>
                            {m.email}
                          </Typography>
                        )}
                      </Box>
                      <Box sx={{ flex: 1 }} />
                      <Button
                        size="sm"
                        variant="plain"
                        startDecorator={<PersonAddIcon />}
                        loading={addBusy}
                      >
                        Add
                      </Button>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>

            <Divider />
            <Typography level="title-sm">Shared with</Typography>
            {userShares === null && (
              <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
                <CircularProgress size="sm" />
              </Box>
            )}
            {userShares?.length === 0 && (
              <Typography level="body-sm" sx={{ opacity: 0.6 }}>
                Not shared with anyone yet.
              </Typography>
            )}
            <List sx={{ "--ListItem-paddingY": "6px" }}>
              {userShares?.map((s) => (
                <ListItem
                  key={s.user_id}
                  endAction={
                    <IconButton
                      size="sm"
                      variant="plain"
                      color="danger"
                      aria-label="Remove access"
                      onClick={() => removeUser(s.user_id)}
                    >
                      <PersonRemoveIcon />
                    </IconButton>
                  }
                >
                  <Avatar size="sm" sx={{ mr: 1 }}>
                    {(s.user_name || s.user_email)[0]?.toUpperCase() ?? "?"}
                  </Avatar>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography level="body-sm" fontWeight={500} noWrap>
                      {s.user_name || s.user_email}
                    </Typography>
                    {s.user_name && (
                      <Typography level="body-xs" sx={{ opacity: 0.65 }} noWrap>
                        {s.user_email}
                      </Typography>
                    )}
                  </Box>
                  <Chip
                    size="sm"
                    variant="soft"
                    color="neutral"
                    sx={{ ml: "auto", mr: 5 }}
                  >
                    Can watch
                  </Chip>
                </ListItem>
              ))}
            </List>
          </Stack>
        )}

        {tab === "links" && (
          <Stack spacing={1.5} sx={{ mt: 1.5 }}>
            <Typography level="body-sm" sx={{ opacity: 0.7 }}>
              Create a link anyone can use to watch — no account required.
            </Typography>

            <Button
              variant="outlined"
              startDecorator={<LinkIcon />}
              loading={linkBusy}
              onClick={createLink}
              sx={{ alignSelf: "flex-start" }}
            >
              Create watch link
            </Button>

            <Divider />
            <Typography level="title-sm">Active links</Typography>
            {links === null && (
              <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
                <CircularProgress size="sm" />
              </Box>
            )}
            {links?.length === 0 && (
              <Typography level="body-sm" sx={{ opacity: 0.6 }}>
                No links yet.
              </Typography>
            )}
            <List sx={{ "--ListItem-paddingY": "6px" }}>
              {links?.map((sl) => (
                <ListItem
                  key={sl.token}
                  endAction={
                    <Box sx={{ display: "flex", gap: 0.5 }}>
                      <IconButton
                        size="sm"
                        variant="plain"
                        color={copied === sl.token ? "success" : "neutral"}
                        aria-label="Copy link"
                        onClick={() => copy(sl.token)}
                      >
                        <ContentCopyIcon />
                      </IconButton>
                      <IconButton
                        size="sm"
                        variant="plain"
                        color="danger"
                        aria-label="Revoke"
                        onClick={() => revokeLink(sl.token)}
                      >
                        <DeleteOutlineIcon />
                      </IconButton>
                    </Box>
                  }
                >
                  <Box sx={{ minWidth: 0, flex: 1, mr: 8 }}>
                    <Input
                      readOnly
                      size="sm"
                      value={watchUrl(sl.token)}
                      sx={{ fontSize: "xs" }}
                    />
                    {sl.expires_at && (
                      <Typography
                        level="body-xs"
                        sx={{ opacity: 0.6, mt: 0.25 }}
                      >
                        Expires {new Date(sl.expires_at).toLocaleDateString()}
                      </Typography>
                    )}
                  </Box>
                </ListItem>
              ))}
            </List>
          </Stack>
        )}
      </ModalDialog>
    </Modal>
  );
}
