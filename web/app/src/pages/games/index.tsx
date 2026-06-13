import { useEffect, useRef, useState, useCallback } from "react";
import {
  Container,
  Box,
  Typography,
  Button,
  Input,
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
import { adminWhoAmI } from "../admin/usersApi";
import MultiplayerAdminPanel from "./MultiplayerAdminPanel";

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
    comingSoon: true,
    iconName: "LocalCafe",
    externalUrl: "https://coffetable.pick.haus",
  },
  {
    id: "mightymike",
    name: "Mighty Mike",
    blurb: "Run-and-gun arcade — a native game port (Pangea's Power Pete).",
    accentColor: "#C2410C",
    phase: 4,
    comingSoon: false,
    iconName: "SportsEsports",
    iconUrl: "/games/mightymike/icon.png",
    // Entry is play.html (not index.html): http.ServeFile 301-redirects any
    // */index.html to the directory, which falls through to the SPA.
    externalUrl: "/games/mightymike/play.html",
  },
  {
    id: "maelstrom",
    name: "Maelstrom",
    blurb: "Asteroids-style arcade shooter — a native SDL game port.",
    accentColor: "#0B3D91",
    phase: 4,
    comingSoon: false,
    iconName: "Rocket",
    iconUrl: "/games/maelstrom/icon.png",
    // Entry is play.html (not index.html): http.ServeFile 301-redirects any
    // */index.html to the directory, which falls through to the SPA.
    externalUrl: "/games/maelstrom/play.html",
  },
  {
    id: "bolo",
    name: "Bolo",
    blurb: "The classic networked tank game — faithful browser port (Orona).",
    accentColor: "#1B5E20",
    phase: 4,
    comingSoon: false,
    iconName: "Adjust",
    iconUrl: "/games/bolo/icon.png",
    // Entry is play.html (not index.html): http.ServeFile 301-redirects any
    // */index.html to the directory, which falls through to the SPA.
    externalUrl: "/games/bolo/play.html",
  },
  {
    id: "winbolo",
    name: "WinBolo",
    blurb: "Bolo, clean-room WinBolo (GPL) compiled to WASM — single-player preview.",
    accentColor: "#1F6F3B",
    phase: 4,
    comingSoon: false,
    iconName: "Adjust",
    iconUrl: "/games/winbolo/icon.png",
    externalUrl: "/games/winbolo/play.html",
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
  arcade("monopoly-deal", "Monopoly Deal", "#16A34A", "Domain"),
  arcade("spider-solitaire", "Spider Solitaire", "#047857", "Style"),
  arcade("freecell", "FreeCell", "#0D9488", "Style"),
  arcade("crazy-eights", "Crazy Eights", "#DC2626", "Style"),
  arcade("go-fish", "Go Fish", "#0EA5E9", "Phishing"),
  arcade("baccarat", "Baccarat", "#7C3AED", "AttachMoney"),
  arcade("old-maid", "Old Maid", "#BE185D", "Style"),
  arcade("snap", "Snap", "#F59E0B", "TouchApp"),
  arcade("mancala", "Mancala", "#B45309", "Adjust"),
  arcade("battleship", "Battleship", "#1E40AF", "Sailing"),
  arcade("nine-mens-morris", "Nine Men's Morris", "#6D28D9", "Grain"),
  arcade("dominoes", "Dominoes", "#1F2937", "Casino"),
  arcade("nonogram", "Nonogram", "#2563EB", "GridView"),
  arcade("flow-connect", "Flow Connect", "#DB2777", "Polyline"),
  arcade("columns", "Columns", "#7C3AED", "ViewColumn"),
  arcade("flood-it", "Flood It", "#EA580C", "FormatColorFill"),
  arcade("pyramid-solitaire", "Pyramid Solitaire", "#B45309", "Style"),
  arcade("tri-peaks", "TriPeaks", "#0E7490", "Terrain"),
  arcade("golf-solitaire", "Golf Solitaire", "#15803D", "GolfCourse"),
  arcade("peg-solitaire", "Peg Solitaire", "#92400E", "Adjust"),
  arcade("chess", "Chess", "#1F2937", "Castle"),
  arcade("chinese-checkers", "Chinese Checkers", "#7C3AED", "Star"),
  arcade("ludo", "Ludo", "#DC2626", "Casino"),
  arcade("ultimate-tic-tac-toe", "Ultimate Tic-Tac-Toe", "#EC407A", "Tag"),
  arcade("galaxian", "Galaxian", "#4338CA", "Rocket"),
  arcade("pinball", "Pinball", "#DB2777", "SportsEsports"),
  arcade("stacker", "Stacker", "#F59E0B", "Layers"),
  arcade("knife-hit", "Knife Hit", "#B91C1C", "ContentCut"),
  arcade("color-switch", "Color Switch", "#06B6D4", "Circle"),
  arcade("unblock", "Unblock", "#DC2626", "Extension"),
  arcade("pipes", "Pipes", "#0891B2", "Plumbing"),
  arcade("mahjong-solitaire", "Mahjong Solitaire", "#166534", "Style"),
  arcade("kakuro", "Kakuro", "#2563EB", "GridOn"),
  arcade("color-lines", "Color Lines", "#DB2777", "BlurOn"),
  arcade("helix-jump", "Helix Jump", "#7C3AED", "Tornado"),
  arcade("cryptogram", "Cryptogram", "#475569", "Lock"),
  arcade("word-ladder", "Word Ladder", "#0D9488", "Stairs"),
  arcade("dot-to-dot", "Dot to Dot", "#F59E0B", "Gesture"),
  arcade("cookie-clicker", "Cookie Clicker", "#B45309", "Cookie"),
  arcade("tilt-maze", "Tilt Maze", "#0EA5E9", "ScreenRotation"),
  arcade("heads-up", "Heads Up", "#7C3AED", "Face"),
  arcade("catch-phrase", "Catch Phrase", "#DC2626", "RecordVoiceOver"),
];

// Category filters for the games grid. Each game has one primary category; the
// buttons show icon-only on mobile (label hidden) and icon+label on wider screens.
const CATEGORIES: { key: string; label: string; icon: string }[] = [
  { key: "All", label: "All", icon: "Apps" },
  { key: "Most Played", label: "Most Played", icon: "TrendingUp" },
  { key: "Arcade", label: "Arcade", icon: "SportsEsports" },
  { key: "Puzzle", label: "Puzzle", icon: "Extension" },
  { key: "Card", label: "Card", icon: "Style" },
  { key: "Board", label: "Board", icon: "Dashboard" },
  { key: "Word", label: "Word", icon: "Abc" },
  { key: "Casino", label: "Casino", icon: "Casino" },
  { key: "Kids", label: "Kids", icon: "ChildCare" },
  { key: "Speed", label: "Speed", icon: "Bolt" },
  { key: "Group", label: "Group", icon: "Groups" },
  { key: "2-Player", label: "2-Player", icon: "People" },
  { key: "Adventure", label: "Adventure", icon: "Explore" },
  { key: "Port", label: "Port", icon: "ImportExport" },
];

// Games that carry several category tags rather than one primary category
// (e.g. native game ports tagged "Port" plus their genres). matchesCat below
// consults this in addition to the single-category CATEGORY_OF map.
const EXTRA_CATS: Record<string, string[]> = {
  mightymike: ["Port", "Puzzle", "Adventure", "Arcade"],
  bolo: ["Port", "Arcade", "Board"],
  winbolo: ["Port", "Arcade", "Board"],
  maelstrom: ["Port", "Arcade", "Speed"],
};

const CATEGORY_IDS: Record<string, string[]> = {
  Arcade: ["snake", "tetris", "breakout", "pong", "flappy", "bubble-shooter", "tower-stack", "hormuz", "asteroids", "doodle-jump", "space-invaders", "frogger", "tron", "helicopter", "car-dodge", "missile-command", "lunar-lander", "centipede", "galaxian", "pinball", "stacker", "knife-hit", "color-switch", "helix-jump", "air-hockey"],
  Puzzle: ["2048", "minesweeper", "sudoku", "lights-out", "sliding-puzzle", "water-sort", "sokoban", "nonogram", "flow-connect", "flood-it", "unblock", "pipes", "kakuro", "tower-of-hanoi", "peg-solitaire", "maze", "tilt-maze", "match-3", "columns", "color-lines", "mastermind"],
  Card: ["solitaire", "spider-solitaire", "freecell", "pyramid-solitaire", "tri-peaks", "golf-solitaire", "war", "crazy-eights", "go-fish", "old-maid", "snap", "higher-lower", "monopoly-deal", "mahjong-solitaire"],
  Board: ["tic-tac-toe", "connect-four", "reversi", "checkers", "gomoku", "dots-and-boxes", "mancala", "nine-mens-morris", "dominoes", "battleship", "chinese-checkers", "ludo", "snakes-and-ladders", "chess", "ultimate-tic-tac-toe"],
  Word: ["hangman", "crossword", "word-search", "word-scramble", "wordle", "typing-test", "boggle", "cryptogram", "word-ladder"],
  Casino: ["blackjack", "video-poker", "baccarat", "slot-machine", "yahtzee", "pig"],
  Kids: ["memory-game", "whack-a-mole", "simon", "rock-paper-scissors", "coloring", "math-quiz", "balloon-pop", "fruit-catch", "dot-to-dot", "cookie-clicker", "guess-the-number"],
  Speed: ["reaction-time", "aim-trainer", "piano-tiles"],
};

const CATEGORY_OF: Record<string, string> = Object.entries(CATEGORY_IDS).reduce(
  (acc, [cat, ids]) => {
    for (const id of ids) acc[id] = cat;
    return acc;
  },
  {} as Record<string, string>,
);

// "Group" is a cross-cutting tag for games meant to be played with other people
// (party games + competitive multiplayer genres), so these still keep their
// primary category above and also surface under the Group filter. heads-up /
// catch-phrase have no primary category — they only appear under All + Group.
const GROUP_IDS = new Set<string>([
  "heads-up", "catch-phrase", "rock-paper-scissors",
  "tic-tac-toe", "connect-four", "ultimate-tic-tac-toe", "checkers", "chess",
  "reversi", "gomoku", "dots-and-boxes", "mancala", "nine-mens-morris",
  "dominoes", "battleship", "snakes-and-ladders", "ludo", "chinese-checkers",
  "air-hockey", "pong", "war", "snap", "go-fish", "old-maid", "crazy-eights",
  "pig", "monopoly-deal",
]);

// "2-Player" surfaces games that actually support two humans on ONE device
// (local hot-seat / pass-and-play, or both playing at once). Only games with a
// real two-human mode belong here — most others are single-player vs the
// computer. Keep this in sync as more games gain a 2-player mode.
const TWO_PLAYER_IDS = new Set<string>([
  "battleship", "checkers", "tic-tac-toe", "connect-four", "ultimate-tic-tac-toe",
  "gomoku", "reversi", "chess", "dots-and-boxes", "mancala", "nine-mens-morris",
  "chinese-checkers", "snakes-and-ladders", "ludo", "pong", "pig", "air-hockey",
  // Hidden-hand card/tile games — 2-player uses a slide-to-reveal privacy
  // handoff between turns so neither player sees the other's hand.
  "dominoes", "go-fish", "crazy-eights", "old-maid", "monopoly-deal",
]);

// Per-device play counts, persisted in localStorage under grown.games.plays as
// { [gameId]: count }. Used by the "Most Played" filter to sort games by how
// often this browser has launched them. Purely local — no backend, no sync.
const PLAYS_KEY = "grown.games.plays";

function readPlays(): Record<string, number> {
  try {
    const raw = localStorage.getItem(PLAYS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, number>)
      : {};
  } catch {
    return {};
  }
}

function bumpPlay(id: string): Record<string, number> {
  const plays = readPlays();
  plays[id] = (plays[id] ?? 0) + 1;
  try {
    localStorage.setItem(PLAYS_KEY, JSON.stringify(plays));
  } catch {
    // best-effort (e.g. storage disabled / full)
  }
  return plays;
}

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
  const [query, setQuery] = useState("");
  // Desktop: focus the games search on load so you can type immediately. Skip on
  // touch (auto-focus there pops the soft keyboard).
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (window.matchMedia && window.matchMedia("(pointer: fine)").matches) {
      searchRef.current?.focus();
    }
  }, []);
  const [cat, setCat] = useState("All");
  // Per-device play counts (localStorage) powering the "Most Played" sort, and
  // the set of recently-updated game ids that earn a NEW badge (from the
  // backend). Both are best-effort and degrade to empty.
  const [plays, setPlays] = useState<Record<string, number>>(() => readPlays());
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set());
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  // Multiplayer admin control panel — the settings button + panel are shown
  // ONLY to grown admins (resolved via GET /api/v1/admin/whoami, the same gate
  // the rest of the SPA uses for admin-only affordances).
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

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

  // Fetch the up-to-4 most-recently-updated games (mtime within 7 days) so we
  // can flag them with a NEW badge. Public, no auth; failures leave no badges.
  useEffect(() => {
    let alive = true;
    fetch("/api/v1/games/recent", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { recent?: { id: string }[] } | null) => {
        if (alive && data?.recent) {
          setNewIds(new Set(data.recent.map((g) => g.id)));
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Record a launch for play-count tracking (drives the "Most Played" sort).
  const onLaunch = useCallback((id: string) => {
    setPlays(bumpPlay(id));
  }, []);

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

  // Resolve admin status to gate the multiplayer-admin settings button. Only
  // attempted when signed in (whoami needs a session); failures leave isAdmin
  // false so the button stays hidden.
  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return;
    }
    let alive = true;
    adminWhoAmI()
      .then((w) => {
        if (alive) setIsAdmin(w.isAdmin);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user]);

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

  const q = query.trim().toLowerCase();
  // "Most Played" is a sort, not a category, so it matches every game (and the
  // grid is reordered by play count below). All other non-"All" keys filter.
  const matchesCat = (id: string) =>
    cat === "All" ||
    cat === "Most Played" ||
    (cat === "Group"
      ? GROUP_IDS.has(id)
      : cat === "2-Player"
        ? TWO_PLAYER_IDS.has(id)
        : CATEGORY_OF[id] === cat || (EXTRA_CATS[id]?.includes(cat) ?? false));
  let filteredGames = GAMES.filter(
    (g) =>
      matchesCat(g.id) &&
      (!q || `${g.name} ${g.blurb ?? ""}`.toLowerCase().includes(q)),
  );
  if (cat === "Most Played") {
    // Most-played first; never-played games keep their original order at the end
    // (stable sort + 0 default). TileGrid only re-sorts by comingSoon, so this
    // order is preserved within the played / unplayed groups.
    filteredGames = [...filteredGames].sort(
      (a, b) => (plays[b.id] ?? 0) - (plays[a.id] ?? 0),
    );
  }
  // Decorate each tile with the NEW badge + a launch hook that records the play.
  filteredGames = filteredGames.map((g) => ({
    ...g,
    isNew: newIds.has(g.id),
    onLaunch: () => onLaunch(g.id),
  }));
  // Imported games are user uploads with no category, so they only appear under "All".
  const filteredImported =
    cat !== "All"
      ? []
      : q
        ? imported.filter((g) => g.name.toLowerCase().includes(q))
        : imported;

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
            {isAdmin && (
              <Button
                variant="outlined"
                color="neutral"
                onClick={() => setAdminOpen(true)}
                startDecorator={<Icons.Settings />}
                data-testid="games-mp-admin-button"
              >
                Multiplayer admin
              </Button>
            )}
          </Box>
        </Box>

        <Input
          size="md"
          placeholder="Search games"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          slotProps={{ input: { ref: searchRef } }}
          startDecorator={<Icons.Search />}
          endDecorator={
            query ? (
              <IconButton
                variant="plain"
                size="sm"
                color="neutral"
                onClick={() => setQuery("")}
                aria-label="Clear search"
              >
                <Icons.Close />
              </IconButton>
            ) : null
          }
          sx={{ width: "100%", mb: 1.5 }}
          data-testid="games-search"
        />

        <Box
          sx={{
            display: "flex",
            flexWrap: "wrap",
            gap: 0.75,
            mb: 3,
          }}
        >
          {CATEGORIES.map((c) => {
            const Icon = (
              Icons as Record<string, React.ComponentType<{ sx?: object }>>
            )[c.icon];
            const active = cat === c.key;
            return (
              <Button
                key={c.key}
                size="sm"
                variant={active ? "solid" : "outlined"}
                color={active ? "primary" : "neutral"}
                onClick={() => setCat(c.key)}
                aria-label={c.label}
                aria-pressed={active}
                data-testid={`games-cat-${c.key}`}
                sx={{ px: { xs: 1, sm: 1.5 }, minWidth: 0, gap: 0.5 }}
              >
                {Icon ? <Icon sx={{ fontSize: 18 }} /> : null}
                <Box
                  component="span"
                  sx={{ display: { xs: "none", sm: "inline" } }}
                >
                  {c.label}
                </Box>
              </Button>
            );
          })}
        </Box>

        {filteredGames.length > 0 ? (
          <TileGrid apps={filteredGames} />
        ) : (
          <Typography level="body-sm" sx={{ opacity: 0.6 }}>
            No games match “{query}”.
          </Typography>
        )}

        {user && (
          <Box sx={{ mt: 4 }}>
            <Typography level="title-md" sx={{ mb: 1.5 }}>
              Imported games
            </Typography>
            {filteredImported.length === 0 ? (
              <Typography level="body-sm" sx={{ opacity: 0.6 }}>
                {q
                  ? `No imported games match “${query}”.`
                  : "No imported games yet. Use “Import game” to upload a self-contained HTML file."}
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
                {filteredImported.map((g) => (
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

      {isAdmin && (
        <MultiplayerAdminPanel
          open={adminOpen}
          onClose={() => setAdminOpen(false)}
        />
      )}

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
