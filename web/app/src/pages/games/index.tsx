import { Container, Box, Typography } from "@mui/joy";
import { Header } from "../../components/Header";
import { TileGrid } from "../../components/TileGrid";
import type { AppTile } from "../../catalog/apps";
import type { User } from "../../api/types";

/**
 * Games dashboard — a public sub-area surfacing playable games. It works
 * signed-out (no account required) and signed-in alike; the Header adapts to
 * a null user. Each game is its own separately-deployed app, linked out by
 * its external URL.
 */
// Self-contained HTML games bundled under web/app/public/games/ and served at
// /games/<name>.html. Each tile opens the game in a new tab (externalUrl).
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
];

export default function GamesApp({ user }: { user: User | null }) {
  return (
    <>
      <Header user={user} />
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Box sx={{ mb: 3 }}>
          <Typography level="h2">Games</Typography>
          <Typography level="body-sm" sx={{ opacity: 0.7 }}>
            Play in your browser — no account required.
          </Typography>
        </Box>
        <TileGrid apps={GAMES} />
      </Container>
    </>
  );
}
