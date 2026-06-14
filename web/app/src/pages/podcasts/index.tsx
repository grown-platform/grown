/**
 * Podcasts — early preview / UI sketch.
 *
 * Discovery is real (Apple's free iTunes Search API, client-side, no key/CORS
 * issues): search returns podcasts with artwork, author, and RSS feed URL.
 * Subscriptions and episode playback are the "coming" parts — they need a
 * backend RSS proxy + per-user subscription store (browsers can't fetch most
 * feeds directly due to CORS), so those are scaffolded as previews here. The
 * goal is to lay out the shape of the app so the backend can drop in behind it.
 */
import { useState } from "react";
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
} from "@mui/joy";
import PodcastsIcon from "@mui/icons-material/Podcasts";
import SearchIcon from "@mui/icons-material/Search";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";

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

export default function PodcastsApp({ user }: { user: User }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Podcast[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.body" }}>
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
          Search and discover podcasts now. Subscriptions and in-app episode
          playback are coming next.
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

        {/* Two-column layout: subscriptions sidebar (sketch) + results */}
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "240px 1fr" },
            gap: 3,
          }}
        >
          {/* Subscriptions (placeholder for the backend-backed list) */}
          <Box>
            <Typography level="title-sm" sx={{ mb: 1 }}>
              Your subscriptions
            </Typography>
            <Sheet
              variant="soft"
              sx={{ p: 2, borderRadius: "md", textAlign: "center" }}
            >
              <Typography level="body-xs" sx={{ opacity: 0.7 }}>
                Subscribed shows will live here, with new-episode badges and
                offline downloads. Coming soon.
              </Typography>
            </Sheet>
            <Divider sx={{ my: 2 }} />
            <Typography level="body-xs" sx={{ opacity: 0.6 }}>
              Import an OPML file from another podcast app — planned.
            </Typography>
          </Box>

          {/* Results / discovery grid */}
          <Box>
            {error && (
              <Sheet color="danger" variant="soft" sx={{ p: 2, borderRadius: "md", mb: 2 }}>
                <Typography color="danger">{error}</Typography>
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
                {results.map((p) => (
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
                        disabled
                        sx={{ flex: 1 }}
                      >
                        Episodes
                      </Button>
                      <Button
                        size="sm"
                        variant="outlined"
                        color="primary"
                        disabled
                        aria-label="Subscribe (coming soon)"
                      >
                        <AddCircleOutlineIcon />
                      </Button>
                    </Stack>
                  </Card>
                ))}
              </Box>
            )}
          </Box>
        </Box>
      </Container>
    </Box>
  );
}
