import { Box } from "@mui/joy";
import { Tile } from "./Tile";
import type { AppTile } from "../catalog/apps";

interface TileGridProps {
  apps: AppTile[];
}

/** TileGrid lays out tiles in a dense responsive grid sized for icons (not cards).
 *  Uses `auto-fill` + `minmax(96px, 1fr)` so the row count grows naturally with
 *  viewport width: ~3 per row on phones, 8+ on a desktop, 12+ on a wide monitor. */
export function TileGrid({ apps }: TileGridProps) {
  return (
    <Box
      sx={{
        display: "grid",
        gap: 1.5,
        gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
      }}
    >
      {[...apps]
        .sort((a, b) => Number(a.comingSoon) - Number(b.comingSoon))
        .map((app) => (
          <Tile key={app.id} app={app} />
        ))}
    </Box>
  );
}
