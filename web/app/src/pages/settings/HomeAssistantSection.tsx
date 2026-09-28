import { useEffect, useState } from "react";
import {
  Sheet,
  Typography,
  Box,
  Input,
  Button,
  Alert,
} from "@mui/joy";
import SensorsRoundedIcon from "@mui/icons-material/SensorsRounded";
import { adminWhoAmI } from "../admin/usersApi";
import { getServiceSettings, setServiceSettings } from "../admin/api";

const SERVICE_ID = "homeassistant";

/**
 * HomeAssistantSection lets the admin of a PERSONAL org point the Home
 * Assistant tile at their own instance. Team orgs do this in Admin > Services,
 * but personal orgs have no Admin app, so without this a personal-org user
 * could never bring their own HA. Writes the same per-org service setting
 * (service id "homeassistant", external_url) the Admin console does.
 */
export function HomeAssistantSection() {
  const [visible, setVisible] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [saved, setSaved] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const w = await adminWhoAmI();
      if (!alive || !(w.isAdmin && w.isPersonal)) return;
      try {
        const s = (await getServiceSettings()).find(
          (x) => x.service_id === SERVICE_ID,
        );
        if (!alive) return;
        setEnabled(s?.enabled ?? true);
        setSaved(s?.external_url ?? "");
        setDraft(s?.external_url ?? "");
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
      if (alive) setVisible(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!visible) return null;

  async function save(url: string) {
    setBusy(true);
    try {
      const out = await setServiceSettings([
        { service_id: SERVICE_ID, enabled, external_url: url.trim() },
      ]);
      const s = out.find((x) => x.service_id === SERVICE_ID);
      setSaved(s?.external_url ?? "");
      setDraft(s?.external_url ?? "");
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      variant="outlined"
      sx={{ borderRadius: "lg", p: 3, mb: 3 }}
      data-testid="settings-homeassistant"
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
        <SensorsRoundedIcon sx={{ color: "#18BCF2" }} />
        <Typography level="title-md">Home Assistant</Typography>
      </Box>
      <Typography level="body-sm" sx={{ opacity: 0.7, mb: 2 }}>
        Point the Home Assistant app tile at your own instance. The tile stays
        hidden until a URL is set.
      </Typography>
      {error && (
        <Alert color="danger" variant="soft" sx={{ mb: 2 }}>
          Couldn&rsquo;t save: {error}
        </Alert>
      )}
      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save(draft);
        }}
        sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}
      >
        <Input
          size="sm"
          type="url"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="https://homeassistant.yourdomain.com"
          disabled={busy}
          sx={{ flex: 1, minWidth: 220 }}
          slotProps={{ input: { "aria-label": "Home Assistant URL" } }}
        />
        <Button
          size="sm"
          type="submit"
          loading={busy}
          disabled={draft.trim() === saved}
          data-testid="settings-homeassistant-save"
        >
          Save
        </Button>
        {saved && (
          <Button
            size="sm"
            variant="plain"
            color="neutral"
            disabled={busy}
            onClick={() => void save("")}
            data-testid="settings-homeassistant-clear"
          >
            Clear
          </Button>
        )}
      </Box>
    </Sheet>
  );
}
