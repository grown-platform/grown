import { useEffect, useRef, useState, useCallback } from "react";
import {
  Container,
  Box,
  Typography,
  Button,
  Modal,
  ModalDialog,
  ModalClose,
  IconButton,
  Snackbar,
  Avatar,
} from "@mui/joy";
import * as Icons from "@mui/icons-material";
import { Header } from "../../components/Header";
import { TileGrid } from "../../components/TileGrid";
import type { AppTile } from "../../catalog/apps";
import type { User } from "../../api/types";

/**
 * Games dashboard — a public sub-area surfacing playable games. It works
 * signed-out (no account required) and signed-in alike; the Header adapts to
 * a null user.
 *
 * Bundled games (GAMES) are trusted, self-contained HTML served from
 * web/app/public/games/<id>.html and opened in a new tab.
 *
 * Imported games are UNTRUSTED user uploads (login + org-scoped). They are
 * NEVER opened as a top-level document or same-origin iframe — they render
 * ONLY inside a sandboxed iframe (no allow-same-origin) so they get an opaque
 * origin and cannot reach grown's session cookie / APIs.
 */
const arcade = (
  id: string,
  name: string,
  accentColor: string,
  iconName: string,
): AppTile => ({
  id,
  name,
  blurb: "Play in your browser.",
  accentColor,
  phase: 4,
  comingSoon: false,
  iconName,
  externalUrl: `/games/${id}.html`,
});

const GAMES: AppTile[] = [
  {
    id: "coffetable",
    name: "Coffeetable",
    blurb: "Casual browser game.",
    accentColor: "#8D6E63",
    phase: 4,
    comingSoon: false,
    iconName: "LocalCafe",
    externalUrl: "https://coffetable.pick.haus",
  },
  arcade("2048", "2048", "#EDC22E", "GridOn"),
  arcade("snake", "Snake", "#43A047", "Timeline"),
  arcade("minesweeper", "Minesweeper", "#455A64", "Flag"),
  arcade("sudoku", "Sudoku", "#1E88E5", "Grid4x4"),
  arcade("tic-tac-toe", "Tic-Tac-Toe", "#EC407A", "Tag"),
  arcade("connect-four", "Connect Four", "#E63946", "Adjust"),
  arcade("memory-game", "Memory", "#26A69A", "Memory"),
  arcade("reversi", "Reversi", "#2E7D32", "Circle"),
  arcade("mastermind", "Mastermind", "#7C4DFF", "Psychology"),
  arcade("hangman", "Hangman", "#6D4C41", "Spellcheck"),
  arcade("lights-out", "Lights Out", "#F4A261", "Lightbulb"),
  arcade("sliding-puzzle", "Sliding Puzzle", "#5C6BC0", "Extension"),
  arcade("solitaire", "Solitaire", "#0B6E4F", "Style"),
  arcade("crossword", "Crossword", "#6741D9", "Abc"),
  arcade("tetris", "Tetris", "#7C3AED", "ViewModule"),
  arcade("breakout", "Breakout", "#0EA5E9", "GridView"),
  arcade("pong", "Pong", "#475569", "SportsTennis"),
  arcade("flappy", "Flappy", "#F59E0B", "Air"),
  arcade("whack-a-mole", "Whack-a-Mole", "#65A30D", "Gavel"),
  arcade("simon", "Simon", "#E11D48", "MusicNote"),
  arcade("bubble-shooter", "Bubble Shooter", "#DB2777", "BubbleChart"),
  arcade("tower-stack", "Tower Stack", "#F59E0B", "Layers"),
  arcade("hormuz", "Strait of Hormuz", "#0369A1", "DirectionsBoat"),
  arcade("word-search", "Word Search", "#0891B2", "Search"),
  arcade("asteroids", "Asteroids", "#334155", "Rocket"),
  arcade("doodle-jump", "Doodle Jump", "#22C55E", "TrendingUp"),
  arcade("rock-paper-scissors", "Rock Paper Scissors", "#F43F5E", "PanTool"),
  arcade("checkers", "Checkers", "#B91C1C", "RadioButtonChecked"),
  arcade("maze", "Maze", "#7C3AED", "Route"),
  arcade("coloring", "Coloring Pad", "#EC4899", "Palette"),
  arcade("snakes-and-ladders", "Snakes & Ladders", "#16A34A", "Casino"),
  arcade("math-quiz", "Math Quiz", "#2563EB", "Calculate"),
  arcade("space-invaders", "Space Invaders", "#6366F1", "VideogameAsset"),
  arcade("gomoku", "Gomoku", "#0F766E", "Grain"),
  arcade("dots-and-boxes", "Dots & Boxes", "#DB2777", "BorderOuter"),
  arcade("tower-of-hanoi", "Tower of Hanoi", "#CA8A04", "Toll"),
  arcade("water-sort", "Water Sort", "#06B6D4", "Science"),
  arcade("sokoban", "Sokoban", "#B45309", "Inventory2"),
  arcade("frogger", "Frogger", "#16A34A", "DirectionsCar"),
  arcade("blackjack", "Blackjack", "#15803D", "Style"),
  arcade("air-hockey", "Air Hockey", "#DC2626", "SportsHockey"),
  arcade("piano-tiles", "Piano Tiles", "#1E293B", "Piano"),
  arcade("fruit-catch", "Fruit Catch", "#F97316", "Restaurant"),
  arcade("balloon-pop", "Balloon Pop", "#EF4444", "Celebration"),
  arcade("reaction-time", "Reaction Time", "#10B981", "Bolt"),
  arcade("aim-trainer", "Aim Trainer", "#E11D48", "GpsFixed"),
  arcade("guess-the-number", "Guess the Number", "#2563EB", "QuestionMark"),
  arcade("higher-lower", "Higher or Lower", "#7C3AED", "SwapVert"),
  arcade("video-poker", "Video Poker", "#166534", "Style"),
  arcade("war", "War", "#7F1D1D", "Style"),
  arcade("slot-machine", "Slot Machine", "#B91C1C", "Casino"),
  arcade("yahtzee", "Yahtzee", "#4F46E5", "Casino"),
  arcade("pig", "Pig", "#DB2777", "Casino"),
  arcade("word-scramble", "Word Scramble", "#0D9488", "Shuffle"),
  arcade("wordle", "Wordle", "#16A34A", "Apps"),
  arcade("typing-test", "Typing Test", "#475569", "Keyboard"),
  arcade("boggle", "Boggle", "#CA8A04", "Abc"),
  arcade("tron", "Tron", "#06B6D4", "TwoWheeler"),
  arcade("helicopter", "Helicopter", "#0EA5E9", "Flight"),
  arcade("car-dodge", "Car Dodge", "#F59E0B", "DirectionsCar"),
  arcade("missile-command", "Missile Command", "#DC2626", "RocketLaunch"),
  arcade("lunar-lander", "Lunar Lander", "#334155", "DarkMode"),
  arcade("match-3", "Match 3", "#DB2777", "Diamond"),
  arcade("centipede", "Centipede", "#65A30D", "BugReport"),
];

/** ImportedGame mirrors the JSON returned by GET /api/v1/games. */
interface ImportedGame {
  id: string;
  name: string;
  content_type: string;
  size: number;
  created_at: string;
}

/** A tile for an imported game — looks like a Tile, but opens the in-app
 *  sandboxed player on click instead of navigating. */
function ImportedTile({
  game,
  onPlay,
}: {
  game: ImportedGame;
  onPlay: () => void;
}) {
  const SportsEsports = (
    Icons as Record<string, React.ComponentType<{ sx?: object }>>
  ).SportsEsports;
  return (
    <Box
      component="button"
      type="button"
      onClick={onPlay}
      data-testid={`imported-tile-${game.id}`}
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: 1,
        py: 1.5,
        px: 1,
        border: "none",
        background: "none",
        cursor: "pointer",
        font: "inherit",
        color: "inherit",
        borderRadius: "md",
        transition: "background-color 120ms",
        "&:hover": { bgcolor: "background.level1" },
        "&:hover .grown-tile-icon": { transform: "scale(1.04)" },
      }}
    >
      <Avatar
        className="grown-tile-icon"
        variant="plain"
        sx={{
          bgcolor: "background.surface",
          width: 64,
          height: 64,
          boxShadow: "xs",
          transition: "transform 150ms",
          "& svg": { color: "#7C4DFF", fontSize: 32 },
        }}
      >
        {SportsEsports ? <SportsEsports /> : game.name.charAt(0).toUpperCase()}
      </Avatar>
      <Typography level="body-sm" sx={{ fontWeight: 500 }} noWrap>
        {game.name}
      </Typography>
    </Box>
  );
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

export default function GamesApp({ user }: { user: User | null }) {
  const [imported, setImported] = useState<ImportedGame[]>([]);
  const [playing, setPlaying] = useState<ImportedGame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  // Make /games installable as its own PWA (own icon) while this page is shown:
  // point the manifest + theme color at the games-hub manifest, restore on unmount.
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = "/games.webmanifest";
    const theme = document.createElement("meta");
    theme.name = "theme-color";
    theme.content = "#6741d9";
    const apple = document.createElement("link");
    apple.rel = "apple-touch-icon";
    apple.href = "/games-app-icon.svg";
    document.head.append(link, theme, apple);

    // Register the games service worker so the whole collection is precached and
    // the installed /games hub works fully offline (no connection required).
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/games/games-sw.js", { scope: "/games/" })
        .catch(() => {});
    }

    const onBIP = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      link.remove();
      theme.remove();
      apple.remove();
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const onInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setInstallPrompt(null);
  };

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch("/api/v1/games", { credentials: "same-origin" });
      if (!res.ok) return;
      const data = (await res.json()) as { games?: ImportedGame[] };
      setImported(data.games ?? []);
    } catch {
      // best-effort; bundled games still render
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onPick = () => fileRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    const isHtml =
      file.type === "text/html" ||
      file.name.toLowerCase().endsWith(".html") ||
      file.name.toLowerCase().endsWith(".htm");
    if (!isHtml) {
      setError("Only self-contained HTML games are supported.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("File too large (max 2 MiB).");
      return;
    }
    setImporting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/v1/games", {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      if (!res.ok) {
        const msg = await res.text();
        setError(msg.trim() || "Import failed.");
        return;
      }
      await refresh();
    } catch {
      setError("Import failed.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <Header user={user} />
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Box
          sx={{
            mb: 3,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 2,
          }}
        >
          <Box>
            <Typography level="h2">Games</Typography>
            <Typography level="body-sm" sx={{ opacity: 0.7 }}>
              Play in your browser — no account required.
            </Typography>
          </Box>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            {installPrompt && (
              <Button
                variant="solid"
                onClick={onInstall}
                startDecorator={<Icons.InstallMobile />}
              >
                Install app
              </Button>
            )}
            {user && (
              <Button
                variant="outlined"
                onClick={onPick}
                loading={importing}
                startDecorator={<Icons.UploadFile />}
              >
                Import game
              </Button>
            )}
          </Box>
        </Box>

        <TileGrid apps={GAMES} />

        {user && (
          <Box sx={{ mt: 4 }}>
            <Typography level="title-md" sx={{ mb: 1.5 }}>
              Imported games
            </Typography>
            {imported.length === 0 ? (
              <Typography level="body-sm" sx={{ opacity: 0.6 }}>
                No imported games yet. Use “Import game” to upload a
                self-contained HTML file.
              </Typography>
            ) : (
              <Box
                sx={{
                  display: "grid",
                  gap: 1.5,
                  gridTemplateColumns:
                    "repeat(auto-fill, minmax(96px, 1fr))",
                }}
              >
                {imported.map((g) => (
                  <ImportedTile
                    key={g.id}
                    game={g}
                    onPlay={() => setPlaying(g)}
                  />
                ))}
              </Box>
            )}
          </Box>
        )}
      </Container>

      <input
        ref={fileRef}
        type="file"
        accept=".html,text/html"
        style={{ display: "none" }}
        onChange={onFile}
      />

      {/* Sandboxed player: the untrusted game runs ONLY inside this iframe with
          an opaque origin (no allow-same-origin), so it cannot reach grown's
          session cookie, localStorage, or APIs. */}
      <Modal open={playing !== null} onClose={() => setPlaying(null)}>
        <ModalDialog
          layout="fullscreen"
          sx={{ p: 0, display: "flex", flexDirection: "column" }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              px: 2,
              py: 1,
              borderBottom: "1px solid",
              borderColor: "divider",
            }}
          >
            <Typography level="title-sm" noWrap>
              {playing?.name}
            </Typography>
            <IconButton
              size="sm"
              variant="plain"
              onClick={() => setPlaying(null)}
              aria-label="Close game"
            >
              <Icons.Close />
            </IconButton>
          </Box>
          <ModalClose sx={{ display: "none" }} />
          {playing && (
            <iframe
              title={playing.name}
              sandbox="allow-scripts allow-modals allow-pointer-lock allow-forms"
              src={`/api/v1/games/${playing.id}/content`}
              style={{ width: "100%", height: "100%", border: 0, flex: 1 }}
            />
          )}
        </ModalDialog>
      </Modal>

      <Snackbar
        open={error !== null}
        onClose={() => setError(null)}
        autoHideDuration={4000}
        color="danger"
        variant="soft"
      >
        {error}
      </Snackbar>
    </>
  );
}
