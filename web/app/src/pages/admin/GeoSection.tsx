// GeoSection — Admin → Region access. Configures the instance-level
// geo-location access policy (internal/geoaccess, GET/PUT /api/v1/admin/geo).
// The policy gates edge access to the whole site + games area against
// Cloudflare's CF-IPCountry header. Admins, auth/login, and health endpoints are
// never blocked, so an admin can always recover.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Typography,
  Sheet,
  Alert,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  FormLabel,
  FormHelperText,
  Radio,
  RadioGroup,
  Textarea,
} from "@mui/joy";
import PublicIcon from "@mui/icons-material/Public";
import {
  getGeoPolicy,
  setGeoPolicy,
  parseCountryInput,
  COUNTRY_PRESETS,
  GeoForbiddenError,
  type GeoMode,
} from "./geoApi";

const MODE_HELP: Record<GeoMode, string> = {
  off: "No filtering. Everyone can reach the site (default).",
  block: "Deny visitors from the listed countries. Everyone else is allowed.",
  allow: "Deny everyone EXCEPT visitors from the listed countries.",
};

export function GeoSection() {
  const [mode, setMode] = useState<GeoMode>("off");
  const [countriesText, setCountriesText] = useState("");
  // Last-saved snapshot for dirty detection.
  const [savedMode, setSavedMode] = useState<GeoMode>("off");
  const [savedText, setSavedText] = useState("");
  const [updatedBy, setUpdatedBy] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const p = await getGeoPolicy();
      const text = p.countries.join(", ");
      setMode(p.mode);
      setCountriesText(text);
      setSavedMode(p.mode);
      setSavedText(text);
      setUpdatedBy(p.updated_by);
      setUpdatedAt(p.updated_at);
    } catch (e) {
      if (e instanceof GeoForbiddenError) setForbidden(true);
      else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const parsed = useMemo(
    () => parseCountryInput(countriesText),
    [countriesText],
  );

  const dirty =
    mode !== savedMode ||
    parsed.join(",") !== parseCountryInput(savedText).join(",");

  // For block/allow modes an empty country list is almost certainly a mistake
  // (allow-with-none would block the whole world). Surface a soft guard.
  const emptyListWarning = mode !== "off" && parsed.length === 0;

  function addPreset(code: string) {
    if (parsed.includes(code)) return;
    setCountriesText((cur) => {
      const t = cur.trim();
      return t ? `${t}, ${code}` : code;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const p = await setGeoPolicy(mode, parsed);
      const text = p.countries.join(", ");
      setMode(p.mode);
      setCountriesText(text);
      setSavedMode(p.mode);
      setSavedText(text);
      setUpdatedBy(p.updated_by);
      setUpdatedAt(p.updated_at);
      setNotice(
        p.mode === "off"
          ? "Region filtering turned off."
          : "Region access policy saved.",
      );
    } catch (e) {
      if (e instanceof GeoForbiddenError) setForbidden(true);
      else setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (forbidden) {
    return (
      <>
        <Typography level="h4" sx={{ mb: 1 }}>
          Region access
        </Typography>
        <Alert color="warning" variant="soft">
          You need admin privileges to manage region access. Ask an org admin to
          add your email to <code>GROWN_ADMIN_EMAILS</code>.
        </Alert>
      </>
    );
  }

  return (
    <>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          mb: 2,
          flexWrap: "wrap",
        }}
      >
        <Box sx={{ flex: 1, minWidth: 180 }}>
          <Typography level="h4">Region access</Typography>
          <Typography level="body-sm" sx={{ opacity: 0.7 }}>
            Restrict who can reach the site by country. Enforced at the
            Cloudflare edge against the visitor&#39;s IP region.
          </Typography>
        </Box>
        <PublicIcon sx={{ opacity: 0.5 }} />
      </Box>

      {error && (
        <Alert color="danger" variant="soft" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {notice && !error && (
        <Alert color="success" variant="soft" sx={{ mb: 2 }}>
          {notice}
        </Alert>
      )}

      <Alert color="neutral" variant="soft" sx={{ mb: 2 }}>
        Admins are never blocked. The admin console, sign-in, and health checks
        always stay reachable from any region, so you can always change this back
        if you lock yourself out of the main app.
      </Alert>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Sheet variant="outlined" sx={{ borderRadius: "md", p: 2.5 }}>
          <FormControl sx={{ mb: 2 }}>
            <FormLabel>Mode</FormLabel>
            <RadioGroup
              value={mode}
              onChange={(e) => setMode(e.target.value as GeoMode)}
            >
              <Radio
                value="off"
                label="Off — no filtering"
                data-testid="geo-mode-off"
              />
              <Radio
                value="block"
                label="Block listed countries"
                data-testid="geo-mode-block"
              />
              <Radio
                value="allow"
                label="Allow only listed countries"
                data-testid="geo-mode-allow"
              />
            </RadioGroup>
            <FormHelperText>{MODE_HELP[mode]}</FormHelperText>
          </FormControl>

          <FormControl sx={{ mb: 1.5 }} disabled={mode === "off"}>
            <FormLabel>Countries (ISO codes)</FormLabel>
            <Textarea
              minRows={2}
              placeholder="US, DE, FR"
              value={countriesText}
              onChange={(e) => setCountriesText(e.target.value)}
              data-testid="geo-countries"
            />
            <FormHelperText>
              Two-letter ISO 3166-1 codes, comma or space separated. Unknown or
              Tor-exit traffic (XX / T1) is always allowed.
            </FormHelperText>
          </FormControl>

          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 2 }}>
            {COUNTRY_PRESETS.map((c) => {
              const on = parsed.includes(c.code);
              return (
                <Chip
                  key={c.code}
                  size="sm"
                  variant={on ? "solid" : "soft"}
                  color={on ? "primary" : "neutral"}
                  disabled={mode === "off" || on}
                  onClick={() => addPreset(c.code)}
                  title={c.name}
                >
                  {c.code}
                </Chip>
              );
            })}
          </Box>

          {parsed.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography level="body-xs" sx={{ opacity: 0.6, mb: 0.5 }}>
                Will apply to {parsed.length}{" "}
                {parsed.length === 1 ? "country" : "countries"}:
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                {parsed.map((c) => (
                  <Chip key={c} size="sm" variant="outlined">
                    {c}
                  </Chip>
                ))}
              </Box>
            </Box>
          )}

          {emptyListWarning && (
            <Alert color="warning" variant="soft" sx={{ mb: 2 }}>
              {mode === "allow"
                ? "Allow mode with no countries would block everyone (except admins). Add at least one country."
                : "Block mode with no countries has no effect. Add at least one country."}
            </Alert>
          )}

          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              flexWrap: "wrap",
            }}
          >
            <Button
              onClick={() => void save()}
              loading={saving}
              disabled={!dirty}
              data-testid="geo-save"
            >
              Save policy
            </Button>
            {updatedBy && (
              <Typography level="body-xs" sx={{ opacity: 0.6 }}>
                Last changed by {updatedBy}
                {updatedAt
                  ? ` on ${new Date(updatedAt).toLocaleString()}`
                  : ""}
              </Typography>
            )}
          </Box>
        </Sheet>
      )}
    </>
  );
}
