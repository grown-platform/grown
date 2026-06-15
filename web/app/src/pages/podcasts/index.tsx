/**
 * Podcasts — discover, subscribe, and play.
 *
 * Discovery uses Apple's free iTunes Search API (client-side, no key) to find
 * shows + their RSS feed URLs. Subscriptions and episode playback are backed by
 * grown: a per-user subscription store and a server-side, SSRF-guarded RSS
 * proxy/parser (GET /api/v1/podcasts/feed?url=…), because browsers can't fetch
 * most feeds directly (CORS) and we must not let users point the server at
 * internal addresses.
 *
 * Episode audio is played by a small self-contained <audio> element on this
 * page: the Music app's PlayerProvider only wraps the /music route (see
 * pages/music/index.tsx), so it isn't available app-wide to reuse here.
 */
import { useEffect, useState, useRef, useCallback } from "react";
import {
  Box,
  Container,
  Stack,
  Typography,
  Input,
  Button,
  Card,
  AspectRatio,
  Chip,
  CircularProgress,
  Sheet,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemButton,
} from "@mui/joy";
import PodcastsIcon from "@mui/icons-material/Podcasts";
import SearchIcon from "@mui/icons-material/Search";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import RadioIcon from "@mui/icons-material/Radio";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import {
  listSubscriptions,
  subscribe as apiSubscribe,
  unsubscribe as apiUnsubscribe,
  getFeed,
  type Subscription,
  type Episode,
  type Feed,
} from "./api";

const ACCENT = "#8E44AD";

interface Podcast {
  id: number;
  title: string;
  author: string;
  artwork: string;
  feedUrl?: string;
  episodes?: number;
  genre?: string;
}

/** A few well-known open podcasts to populate the "Featured" row before search. */
const FEATURED_TERMS = ["technology", "history", "science"];

/**
 * Curated "radio shows" published as podcast feeds — the radio-as-podcast idea.
 * Clicking one loads its episodes through the SSRF-guarded proxy and offers
 * Subscribe.
 */
const FEATURED_RADIO: Array<{ title: string; author: string; feedUrl: string }> =
  [
    {
      title: "The Glenn Beck Program",
      author: "Blaze Podcast Network",
      feedUrl: "https://feeds.megaphone.fm/BMDC3567910388",
    },
    {
      title: "Up First from NPR",
      author: "NPR",
      feedUrl: "https://feeds.npr.org/510318/podcast.xml",
    },
    {
      title: "The Ramsey Show",
      author: "Ramsey Network",
      feedUrl: "https://feeds.megaphone.fm/RM4031649020",
    },
    {
      title: "Hang Out with Sean Hannity",
      author: "Sean Hannity",
      feedUrl: "https://feeds.libsyn.com/615750/rss",
    },
    {
      title: "The Joe Rogan Experience",
      author: "Joe Rogan",
      feedUrl: "https://feeds.megaphone.fm/GLT1412515089",
    },
  ];

async function searchPodcasts(term: string): Promise<Podcast[]> {
  const u = `https://itunes.apple.com/search?media=podcast&limit=24&term=${encodeURIComponent(term)}`;
  const r = await fetch(u);
  if (!r.ok) throw new Error("Search failed");
  const j = (await r.json()) as {
    results: Array<{
      collectionId: number;
      collectionName: string;
      artistName: string;
      artworkUrl600?: string;
      artworkUrl100?: string;
      feedUrl?: string;
      trackCount?: number;
      primaryGenreName?: string;
    }>;
  };
  return j.results.map((x) => ({
    id: x.collectionId,
    title: x.collectionName,
    author: x.artistName,
    artwork: x.artworkUrl600 || x.artworkUrl100 || "",
    feedUrl: x.feedUrl,
    episodes: x.trackCount,
    genre: x.primaryGenreName,
  }));
}

/** formatDuration renders an itunes:duration (seconds or H:MM:SS) compactly. */
function formatDuration(d: string): string {
  if (!d) return "";
  if (d.includes(":")) return d;
  const secs = Number(d);
  if (!Number.isFinite(secs) || secs <= 0) return "";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(rfc3339: string): string {
  if (!rfc3339) return "";
  const d = new Date(rfc3339);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface NowPlaying {
  title: string;
  show: string;
  audioUrl: string;
}

/** OpenShow is the show whose episodes are currently displayed. */
interface OpenShow {
  title: string;
  author: string;
  artwork: string;
  feedUrl: string;
  feed: Feed | null;
  loading: boolean;
  error: string | null;
}

export default function PodcastsApp({ user }: { user: User }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Podcast[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [subs, setSubs] = useState<Subscription[]>([]);
  const [open, setOpen] = useState<OpenShow | null>(null);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Subscribed feed URLs, for reflecting subscribe state in the grid.
  const subbedUrls = new Set(subs.map((s) => s.feed_url));

  useEffect(() => {
    void listSubscriptions()
      .then(setSubs)
      .catch(() => {
        /* leave subs empty; a load failure shouldn't break discovery */
      });
  }, []);

  async function run(term: string) {
    const q = term.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      setResults(await searchPodcasts(q));
    } catch {
      setError("Couldn't search podcasts (are you offline?).");
    } finally {
      setLoading(false);
    }
  }

  const loadShow = useCallback(
    async (s: {
      title: string;
      author: string;
      artwork: string;
      feedUrl: string;
    }) => {
      setOpen({
        title: s.title,
        author: s.author,
        artwork: s.artwork,
        feedUrl: s.feedUrl,
        feed: null,
        loading: true,
        error: null,
      });
      try {
        const feed = await getFeed(s.feedUrl);
        setOpen((cur) =>
          cur && cur.feedUrl === s.feedUrl
            ? {
                ...cur,
                feed,
                loading: false,
                // Prefer the feed's own artwork once we have it.
                artwork: cur.artwork || feed.image,
                author: cur.author || feed.author,
                title: cur.title || feed.title,
              }
            : cur,
        );
      } catch {
        setOpen((cur) =>
          cur && cur.feedUrl === s.feedUrl
            ? { ...cur, loading: false, error: "Couldn't load episodes for this show." }
            : cur,
        );
      }
    },
    [],
  );

  async function doSubscribe(input: {
    feed_url: string;
    title: string;
    author: string;
    artwork_url: string;
  }) {
    try {
      const created = await apiSubscribe(input);
      setSubs((cur) => {
        if (cur.some((s) => s.feed_url === created.feed_url)) return cur;
        return [created, ...cur];
      });
    } catch {
      setError("Couldn't subscribe — please try again.");
    }
  }

  async function doUnsubscribe(id: string) {
    try {
      await apiUnsubscribe(id);
      setSubs((cur) => cur.filter((s) => s.id !== id));
    } catch {
      setError("Couldn't unsubscribe — please try again.");
    }
  }

  function playEpisode(ep: Episode, show: string) {
    setNowPlaying({ title: ep.title, show, audioUrl: ep.audio_url });
    // The <audio> element's src is bound below; play after the state-driven
    // src update lands.
    setTimeout(() => {
      const a = audioRef.current;
      if (a) {
        a.src = ep.audio_url;
        void a.play().catch(() => setIsPlaying(false));
      }
    }, 0);
  }

  function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => setIsPlaying(false));
    else a.pause();
  }

  const openFeedUrl = open?.feedUrl;
  const openIsSubbed = openFeedUrl ? subbedUrls.has(openFeedUrl) : false;

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.body", pb: nowPlaying ? 11 : 0 }}>
      <Header user={user} />
      <Container sx={{ py: 4 }} maxWidth="lg">
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.5 }}>
          <PodcastsIcon sx={{ color: ACCENT, fontSize: 30 }} />
          <Typography level="h2">Podcasts</Typography>
          <Chip size="sm" variant="soft" color="warning">
            Early preview
          </Chip>
        </Stack>
        <Typography level="body-sm" sx={{ opacity: 0.75, mb: 2.5 }}>
          Search, subscribe, and play — including curated radio shows published
          as podcast feeds.
        </Typography>

        {/* Search */}
        <Stack direction="row" spacing={1} sx={{ mb: 3, maxWidth: 620 }}>
          <Input
            placeholder="Search podcasts — topics, shows, people…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void run(query)}
            startDecorator={<SearchIcon />}
            sx={{ flex: 1 }}
          />
          <Button
            onClick={() => void run(query)}
            loading={loading}
            sx={{ bgcolor: ACCENT, "&:hover": { bgcolor: "#763a91" } }}
          >
            Search
          </Button>
        </Stack>

        {/* Featured radio shows — shown before any discovery search. */}
        {results === null && !loading && (
          <Box sx={{ mb: 4 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <RadioIcon sx={{ color: ACCENT }} />
              <Typography level="title-md">Featured radio shows</Typography>
            </Stack>
            <Typography level="body-xs" sx={{ opacity: 0.7, mb: 1.5 }}>
              Talk radio and news programs you can play on demand.
            </Typography>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "repeat(2, 1fr)",
                  sm: "repeat(3, 1fr)",
                  lg: "repeat(5, 1fr)",
                },
                gap: 1.5,
              }}
            >
              {FEATURED_RADIO.map((s) => {
                const subbed = subbedUrls.has(s.feedUrl);
                return (
                  <Card key={s.feedUrl} variant="outlined" sx={{ p: 1.25 }}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                      <RadioIcon sx={{ color: ACCENT, fontSize: 20 }} />
                      <Typography level="body-sm" sx={{ fontWeight: 600 }} noWrap>
                        {s.title}
                      </Typography>
                    </Stack>
                    <Typography level="body-xs" sx={{ opacity: 0.7, mb: 1 }} noWrap>
                      {s.author}
                    </Typography>
                    <Stack direction="row" spacing={0.5}>
                      <Button
                        size="sm"
                        variant="soft"
                        color="neutral"
                        startDecorator={<PlayArrowIcon />}
                        sx={{ flex: 1 }}
                        onClick={() =>
                          void loadShow({
                            title: s.title,
                            author: s.author,
                            artwork: "",
                            feedUrl: s.feedUrl,
                          })
                        }
                      >
                        Episodes
                      </Button>
                      <IconButton
                        size="sm"
                        variant={subbed ? "soft" : "outlined"}
                        color={subbed ? "success" : "primary"}
                        aria-label={subbed ? "Subscribed" : "Subscribe"}
                        disabled={subbed}
                        onClick={() =>
                          void doSubscribe({
                            feed_url: s.feedUrl,
                            title: s.title,
                            author: s.author,
                            artwork_url: "",
                          })
                        }
                      >
                        {subbed ? <CheckCircleIcon /> : <AddCircleOutlineIcon />}
                      </IconButton>
                    </Stack>
                  </Card>
                );
              })}
            </Box>
          </Box>
        )}

        {/* Quick topic chips before any search */}
        {results === null && !loading && (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 3 }}>
            <Typography level="body-sm" sx={{ alignSelf: "center", opacity: 0.7 }}>
              Try:
            </Typography>
            {FEATURED_TERMS.map((t) => (
              <Chip
                key={t}
                variant="outlined"
                onClick={() => {
                  setQuery(t);
                  void run(t);
                }}
              >
                {t}
              </Chip>
            ))}
          </Stack>
        )}

        {/* Two-column layout: subscriptions sidebar + results/episodes */}
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "240px 1fr" },
            gap: 3,
          }}
        >
          {/* Subscriptions (backend-backed). */}
          <Box>
            <Typography level="title-sm" sx={{ mb: 1 }}>
              Your subscriptions
            </Typography>
            {subs.length === 0 ? (
              <Sheet variant="soft" sx={{ p: 2, borderRadius: "md", textAlign: "center" }}>
                <Typography level="body-xs" sx={{ opacity: 0.7 }}>
                  Subscribe to a show and it'll appear here. Click one to load its
                  latest episodes.
                </Typography>
              </Sheet>
            ) : (
              <List size="sm" sx={{ "--ListItem-paddingX": "8px" }}>
                {subs.map((s) => (
                  <ListItem
                    key={s.id}
                    endAction={
                      <IconButton
                        size="sm"
                        variant="plain"
                        color="danger"
                        aria-label={`Unsubscribe from ${s.title}`}
                        onClick={() => void doUnsubscribe(s.id)}
                      >
                        <DeleteOutlineIcon />
                      </IconButton>
                    }
                  >
                    <ListItemButton
                      selected={open?.feedUrl === s.feed_url}
                      onClick={() =>
                        void loadShow({
                          title: s.title || s.feed_url,
                          author: s.author,
                          artwork: s.artwork_url,
                          feedUrl: s.feed_url,
                        })
                      }
                    >
                      {s.artwork_url ? (
                        <Box
                          component="img"
                          src={s.artwork_url}
                          alt=""
                          sx={{ width: 28, height: 28, borderRadius: "sm", mr: 1, objectFit: "cover" }}
                        />
                      ) : (
                        <PodcastsIcon sx={{ fontSize: 22, mr: 1, opacity: 0.5 }} />
                      )}
                      <Box sx={{ minWidth: 0 }}>
                        <Typography level="body-sm" noWrap>
                          {s.title || "Untitled show"}
                        </Typography>
                        {s.author && (
                          <Typography level="body-xs" sx={{ opacity: 0.6 }} noWrap>
                            {s.author}
                          </Typography>
                        )}
                      </Box>
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            )}
          </Box>

          {/* Right column: episode list for an open show, else the discovery grid. */}
          <Box>
            {error && (
              <Sheet color="danger" variant="soft" sx={{ p: 2, borderRadius: "md", mb: 2 }}>
                <Typography color="danger">{error}</Typography>
              </Sheet>
            )}

            {/* Episode list panel */}
            {open && (
              <Sheet variant="outlined" sx={{ p: 2, borderRadius: "md", mb: 3 }}>
                <Stack direction="row" alignItems="flex-start" spacing={2}>
                  {open.artwork ? (
                    <Box
                      component="img"
                      src={open.artwork}
                      alt=""
                      sx={{ width: 64, height: 64, borderRadius: "sm", objectFit: "cover" }}
                    />
                  ) : (
                    <Box
                      sx={{
                        width: 64,
                        height: 64,
                        borderRadius: "sm",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        bgcolor: "neutral.softBg",
                      }}
                    >
                      <PodcastsIcon sx={{ opacity: 0.4 }} />
                    </Box>
                  )}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography level="title-md" noWrap>
                      {open.title}
                    </Typography>
                    {open.author && (
                      <Typography level="body-sm" sx={{ opacity: 0.7 }} noWrap>
                        {open.author}
                      </Typography>
                    )}
                    <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                      <Button
                        size="sm"
                        variant={openIsSubbed ? "soft" : "solid"}
                        color={openIsSubbed ? "success" : "primary"}
                        startDecorator={openIsSubbed ? <CheckCircleIcon /> : <AddCircleOutlineIcon />}
                        disabled={openIsSubbed}
                        onClick={() =>
                          void doSubscribe({
                            feed_url: open.feedUrl,
                            title: open.feed?.title || open.title,
                            author: open.feed?.author || open.author,
                            artwork_url: open.feed?.image || open.artwork,
                          })
                        }
                      >
                        {openIsSubbed ? "Subscribed" : "Subscribe"}
                      </Button>
                    </Stack>
                  </Box>
                  <IconButton
                    size="sm"
                    variant="plain"
                    aria-label="Close episodes"
                    onClick={() => setOpen(null)}
                  >
                    <CloseIcon />
                  </IconButton>
                </Stack>

                <Divider sx={{ my: 2 }} />

                {open.loading && (
                  <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                    <CircularProgress />
                  </Box>
                )}
                {open.error && (
                  <Typography color="danger" level="body-sm">
                    {open.error}
                  </Typography>
                )}
                {open.feed && !open.loading && (
                  <List size="sm">
                    {open.feed.episodes.length === 0 && (
                      <Typography level="body-sm" sx={{ opacity: 0.7 }}>
                        No playable episodes found in this feed.
                      </Typography>
                    )}
                    {open.feed.episodes.map((ep) => {
                      const playing =
                        nowPlaying?.audioUrl === ep.audio_url && isPlaying;
                      return (
                        <ListItem
                          key={ep.guid}
                          startAction={
                            <IconButton
                              size="sm"
                              variant="soft"
                              color="primary"
                              aria-label={playing ? "Pause" : `Play ${ep.title}`}
                              onClick={() =>
                                playing
                                  ? togglePlay()
                                  : playEpisode(ep, open.title)
                              }
                            >
                              {playing ? <PauseIcon /> : <PlayArrowIcon />}
                            </IconButton>
                          }
                        >
                          <Box sx={{ minWidth: 0, py: 0.5 }}>
                            <Typography level="body-sm" sx={{ fontWeight: 600 }}>
                              {ep.title}
                            </Typography>
                            <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                              {[formatDate(ep.published), formatDuration(ep.duration)]
                                .filter(Boolean)
                                .join(" · ")}
                            </Typography>
                            {ep.description && (
                              <Typography
                                level="body-xs"
                                sx={{ opacity: 0.7, mt: 0.25 }}
                              >
                                {ep.description}
                              </Typography>
                            )}
                          </Box>
                        </ListItem>
                      );
                    })}
                  </List>
                )}
              </Sheet>
            )}

            {loading && (
              <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
                <CircularProgress />
              </Box>
            )}
            {results && results.length === 0 && !loading && (
              <Typography level="body-sm" sx={{ opacity: 0.7 }}>
                No podcasts found.
              </Typography>
            )}
            {results && results.length > 0 && (
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "repeat(2, 1fr)",
                    sm: "repeat(3, 1fr)",
                    lg: "repeat(4, 1fr)",
                  },
                  gap: 2,
                }}
              >
                {results.map((p) => {
                  const subbed = p.feedUrl ? subbedUrls.has(p.feedUrl) : false;
                  return (
                    <Card key={p.id} variant="outlined" sx={{ p: 1 }}>
                      <AspectRatio ratio="1" sx={{ borderRadius: "sm", mb: 0.5 }}>
                        {p.artwork ? (
                          <img src={p.artwork} alt="" loading="lazy" />
                        ) : (
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              bgcolor: "neutral.softBg",
                            }}
                          >
                            <PodcastsIcon sx={{ opacity: 0.4 }} />
                          </Box>
                        )}
                      </AspectRatio>
                      <Typography level="body-sm" sx={{ fontWeight: 600 }} noWrap>
                        {p.title}
                      </Typography>
                      <Typography level="body-xs" sx={{ opacity: 0.7 }} noWrap>
                        {p.author}
                      </Typography>
                      <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                        <Button
                          size="sm"
                          variant="soft"
                          color="neutral"
                          startDecorator={<PlayArrowIcon />}
                          disabled={!p.feedUrl}
                          sx={{ flex: 1 }}
                          onClick={() =>
                            p.feedUrl &&
                            void loadShow({
                              title: p.title,
                              author: p.author,
                              artwork: p.artwork,
                              feedUrl: p.feedUrl,
                            })
                          }
                        >
                          Episodes
                        </Button>
                        <IconButton
                          size="sm"
                          variant={subbed ? "soft" : "outlined"}
                          color={subbed ? "success" : "primary"}
                          aria-label={subbed ? "Subscribed" : "Subscribe"}
                          disabled={!p.feedUrl || subbed}
                          onClick={() =>
                            p.feedUrl &&
                            void doSubscribe({
                              feed_url: p.feedUrl,
                              title: p.title,
                              author: p.author,
                              artwork_url: p.artwork,
                            })
                          }
                        >
                          {subbed ? <CheckCircleIcon /> : <AddCircleOutlineIcon />}
                        </IconButton>
                      </Stack>
                    </Card>
                  );
                })}
              </Box>
            )}
          </Box>
        </Box>
      </Container>

      {/* Sticky now-playing bar with a self-contained <audio> element. */}
      <Sheet
        variant="solid"
        invertedColors
        sx={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          px: 2,
          py: 1,
          display: nowPlaying ? "flex" : "none",
          alignItems: "center",
          gap: 2,
          bgcolor: ACCENT,
          zIndex: 1200,
        }}
      >
        <IconButton variant="soft" color="neutral" onClick={togglePlay} aria-label="Play/pause">
          {isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
        </IconButton>
        <Box sx={{ minWidth: 0, flex: "0 0 auto", maxWidth: 280 }}>
          <Typography level="body-sm" sx={{ fontWeight: 600, color: "#fff" }} noWrap>
            {nowPlaying?.title}
          </Typography>
          <Typography level="body-xs" sx={{ color: "rgba(255,255,255,0.8)" }} noWrap>
            {nowPlaying?.show}
          </Typography>
        </Box>
        <Box
          component="audio"
          ref={audioRef}
          controls
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          sx={{ flex: 1, height: 36, minWidth: 0 }}
        />
        <IconButton
          variant="plain"
          color="neutral"
          aria-label="Close player"
          onClick={() => {
            audioRef.current?.pause();
            setNowPlaying(null);
            setIsPlaying(false);
          }}
        >
          <CloseIcon />
        </IconButton>
      </Sheet>
    </Box>
  );
}
