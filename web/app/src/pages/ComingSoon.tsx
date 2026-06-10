import { useParams, Link as RouterLink } from "react-router-dom";
import { Box, Container, Typography, Avatar, Button, Chip } from "@mui/joy";
import * as Icons from "@mui/icons-material";
import type { ComponentType } from "react";
import { Header } from "../components/Header";
import { apps } from "../catalog/apps";
import type { User } from "../api/types";

interface ComingSoonProps {
  user: User;
}

export function ComingSoon({ user }: ComingSoonProps) {
  const { appId } = useParams<{ appId: string }>();
  const app = apps.find((a) => a.id === appId);
  const IconComponent = app
    ? (Icons as Record<string, ComponentType<{ sx?: object }>>)[app.iconName]
    : undefined;

  return (
    <>
      <Header user={user} />
      <Container maxWidth="md" sx={{ py: 6 }}>
        {app ? (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              gap: 2,
            }}
          >
            <Avatar
              sx={{
                bgcolor: app.accentColor,
                color: "white",
                width: 80,
                height: 80,
              }}
            >
              {IconComponent ? (
                <IconComponent sx={{ fontSize: 44 }} />
              ) : (
                app.name.charAt(0).toUpperCase()
              )}
            </Avatar>
            <Typography level="h2">{app.name}</Typography>
            <Typography level="body-lg" sx={{ opacity: 0.75 }}>
              {app.blurb}
            </Typography>
            <Chip variant="outlined" color="neutral">
              Phase {app.phase} — Coming soon
            </Chip>
            {app.details && app.details.length > 0 && (
              <Box
                component="ul"
                sx={{
                  textAlign: "left",
                  maxWidth: 620,
                  mt: 1,
                  pl: 3,
                  display: "flex",
                  flexDirection: "column",
                  gap: 1,
                }}
              >
                {app.details.map((d, i) => (
                  <Typography
                    key={i}
                    component="li"
                    level="body-md"
                    sx={{ opacity: 0.85 }}
                  >
                    {d}
                  </Typography>
                ))}
              </Box>
            )}
            <Button
              component={RouterLink}
              to="/"
              variant="plain"
              sx={{ mt: 2 }}
              data-testid="back-to-dashboard"
            >
              Back to dashboard
            </Button>
          </Box>
        ) : (
          <Typography level="h3">Unknown app: {appId}</Typography>
        )}
      </Container>
    </>
  );
}
