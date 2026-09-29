import { Box, Button, ToggleButtonGroup, Typography } from "@mui/joy";
import {
  SCHEME_LABELS,
  setShortcutScheme,
  useShortcutScheme,
  type ShortcutApp,
  type ShortcutScheme,
} from "../lib/shortcutScheme";

/** ShortcutSchemeSwitch is the quick Office / Google switch shown in an
 *  editor's Keyboard shortcuts dialog. The choice applies at once and is
 *  saved to the user's preferences. */
export function ShortcutSchemeSwitch({ app }: { app: ShortcutApp }) {
  const scheme = useShortcutScheme(app);
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }} data-testid="shortcut-scheme-switch">
      <Typography level="body-sm">Shortcut style:</Typography>
      <ToggleButtonGroup
        size="sm"
        value={scheme}
        onChange={(_, v) => v && void setShortcutScheme(app, v as ShortcutScheme)}
        aria-label="Keyboard shortcut style"
      >
        <Button value="office" data-scheme="office">
          {SCHEME_LABELS[app].office}
        </Button>
        <Button value="google" data-scheme="google">
          {SCHEME_LABELS[app].google}
        </Button>
      </ToggleButtonGroup>
    </Box>
  );
}
