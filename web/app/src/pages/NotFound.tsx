import { Box, Typography, Button } from "@mui/joy";
import { Link as RouterLink } from "react-router-dom";

export function NotFound() {
  return (
    <Box
      sx={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
      }}
    >
      <Typography level="h1">404</Typography>
      <Typography level="body-lg">Page not found.</Typography>
      <Button component={RouterLink} to="/">
        Back to dashboard
      </Button>
    </Box>
  );
}
