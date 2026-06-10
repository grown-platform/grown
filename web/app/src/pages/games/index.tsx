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
