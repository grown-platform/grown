/**
 * "Play on devices" — surfaces the ways to get grown Music onto external
 * speakers, with the info + configuration each needs:
 *   • AirPlay  — Safari/iOS only; opens the system route picker when available.
 *   • Alexa    — a self-hosted Alexa skill; shows the setup steps + voice commands.
 */
import {
  Modal,
  ModalDialog,
  ModalClose,
  DialogTitle,
  DialogContent,
  Box,
  Stack,
  Typography,
  Button,
  Chip,
  Sheet,
  Divider,
  Link,
} from "@mui/joy";
import AirplayIcon from "@mui/icons-material/Airplay";
import RecordVoiceOverIcon from "@mui/icons-material/RecordVoiceOver";
import { usePlayer } from "./player";

export function DevicesDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const p = usePlayer();

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog sx={{ maxWidth: 480, width: "100%" }}>
        <ModalClose />
        <DialogTitle>Play on other devices</DialogTitle>
        <DialogContent>
          <Typography level="body-sm" sx={{ mb: 2, opacity: 0.8 }}>
            Send your library to a speaker. Pick a method below.
          </Typography>

          {/* ---- AirPlay ---- */}
          <Sheet variant="outlined" sx={{ p: 2, borderRadius: "md", mb: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <AirplayIcon />
              <Typography level="title-sm" sx={{ flex: 1 }}>
                AirPlay
              </Typography>
              <Chip
                size="sm"
                variant="soft"
                color={p.airplayAvailable ? "success" : "neutral"}
              >
                {p.airplayAvailable ? "Ready" : "Safari / iOS"}
              </Chip>
            </Stack>
            <Typography level="body-xs" sx={{ opacity: 0.8, mb: 1.5 }}>
              Stream to HomePod, Apple TV, or any AirPlay speaker. Web AirPlay
              works in <b>Safari on Mac and iPhone/iPad</b> — in other browsers
              (Chrome, Firefox) the route picker isn't available.
            </Typography>
            {p.airplayAvailable ? (
              <Button
                size="sm"
                startDecorator={<AirplayIcon />}
                onClick={() => {
                  p.showAirplay();
                  onClose();
                }}
              >
                Choose AirPlay device…
              </Button>
            ) : (
              <Typography level="body-xs" sx={{ opacity: 0.65 }}>
                Open Music in Safari and start a track — the AirPlay button
                appears in the player bar when a device is on your network.
              </Typography>
            )}
          </Sheet>

          {/* ---- Alexa ---- */}
          <Sheet variant="outlined" sx={{ p: 2, borderRadius: "md" }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <RecordVoiceOverIcon />
              <Typography level="title-sm" sx={{ flex: 1 }}>
                Alexa
              </Typography>
              <Chip size="sm" variant="soft" color="primary">
                Voice
              </Chip>
            </Stack>
            <Typography level="body-xs" sx={{ opacity: 0.8, mb: 1.5 }}>
              Ask an Echo to play your library through the self-hosted{" "}
              <b>Grown Music</b> Alexa skill.
            </Typography>
            <Typography level="body-xs" sx={{ fontWeight: 600, mb: 0.5 }}>
              One-time setup
            </Typography>
            <Box
              component="ol"
              sx={{ pl: 2.5, m: 0, mb: 1.5, "& li": { mb: 0.5 } }}
            >
              <Typography component="li" level="body-xs">
                In the Alexa app, enable the <b>Grown Music</b> skill (custom
                skill, endpoint <code>pick.haus/alexa</code>).
              </Typography>
              <Typography component="li" level="body-xs">
                Link it to your account when prompted.
              </Typography>
            </Box>
            <Typography level="body-xs" sx={{ fontWeight: 600, mb: 0.5 }}>
              Then just say
            </Typography>
            <Sheet
              variant="soft"
              sx={{ p: 1, borderRadius: "sm", fontSize: 12, lineHeight: 1.7 }}
            >
              “Alexa, open Grown Music”
              <br />
              “Alexa, ask Grown Music to play <i>MercyMe</i>”
              <br />
              “Alexa, next” · “Alexa, pause”
            </Sheet>
            <Divider sx={{ my: 1.5 }} />
            <Typography level="body-xs" sx={{ opacity: 0.65 }}>
              The skill streams from your library over signed, time-limited
              links — nothing public is exposed.{" "}
              <Link href="/docs" target="_blank" underline="always">
                Setup guide
              </Link>
            </Typography>
          </Sheet>
        </DialogContent>
      </ModalDialog>
    </Modal>
  );
}
