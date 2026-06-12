import { Box, Avatar, Typography } from "@mui/joy";
import { Link as RouterLink } from "react-router-dom";
import * as Icons from "@mui/icons-material";
import type { AppTile } from "../catalog/apps";

interface TileProps {
  app: AppTile;
}

/**
 * Tile renders one app as a phone-app-style icon: a soft-circular avatar
 * containing the app's Material Symbol icon (colored with the accent
 * color), and the app name as a label below. The whole tile is clickable.
 */
export function Tile({ app }: TileProps) {
  const IconComponent = (
    Icons as Record<string, React.ComponentType<{ sx?: object }>>
  )[app.iconName];
  const initial = app.name.charAt(0).toUpperCase();

  return (
    <Box
      {...(app.comingSoon
        ? {}
        : app.externalUrl
          ? {
              component: "a" as const,
              href: app.externalUrl,
              target: "_blank",
              rel: "noopener noreferrer",
            }
          : {
              component: RouterLink,
              to: `/${app.id}`,
            })}
      data-testid={`tile-${app.id}`}
      aria-disabled={app.comingSoon || undefined}
      // Native hover tooltip describing what the app is.
      title={app.blurb ? `${app.name} — ${app.blurb}` : app.name}
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: 1,
        py: 1.5,
        px: 1,
        textDecoration: "none",
        color: "inherit",
        borderRadius: "md",
        transition: "background-color 120ms",
        cursor: app.comingSoon ? "default" : "pointer",
        opacity: app.comingSoon ? 0.55 : 1,
        pointerEvents: app.comingSoon ? "none" : "auto",
        "&:hover": app.comingSoon ? {} : { bgcolor: "background.level1" },
        "&:hover .grown-tile-icon": app.comingSoon
          ? {}
          : { transform: "scale(1.04)" },
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
          // Color the SVG icon (Material Symbols use currentColor for fill/stroke).
          // Setting color on the Avatar alone is overridden by Joy's palette;
          // targeting the inner svg makes the accent color stick.
          "& svg": {
            color: app.accentColor,
            fontSize: 32,
          },
        }}
      >
        {app.iconUrl ? (
          <Box
            component="img"
            src={app.iconUrl}
            alt=""
            sx={{ width: 64, height: 64, objectFit: "cover", borderRadius: "inherit" }}
          />
        ) : IconComponent ? (
          <IconComponent />
        ) : (
          initial
        )}
      </Avatar>
      <Typography level="body-sm" sx={{ fontWeight: 500 }}>
        {app.name}
      </Typography>
      {app.comingSoon && (
        <Typography
          level="body-xs"
          sx={{ mt: -0.75, color: "#d97706", fontWeight: 500 }}
        >
          (coming soon)
        </Typography>
      )}
      {!app.comingSoon && app.subLabel && (
        <Typography
          level="body-xs"
          sx={{ mt: -0.75, opacity: 0.55, fontWeight: 500 }}
        >
          ({app.subLabel})
        </Typography>
      )}
    </Box>
  );
}
