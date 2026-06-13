import { useEffect, useState } from "react";
import {
  Box,
  Container,
  Typography,
  Sheet,
  Button,
  Select,
  Option,
  Switch,
  Divider,
  CircularProgress,
  FormControl,
  FormLabel,
  FormHelperText,
} from "@mui/joy";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import { AvatarUploader } from "./AvatarUploader";
import { ProfileSection } from "./ProfileSection";
import { ApiTokensSection } from "./ApiTokensSection";
import { getPreferences, updatePreferences } from "./api";
import type { UserPreferences } from "./api";

interface SettingsPageProps {
  user: User;
}

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "pt", label: "Português" },
  { value: "ja", label: "日本語" },
  { value: "zh", label: "中文" },
  { value: "ar", label: "العربية" },
];

const DENSITIES = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
];

const DEFAULT_APPS = [
  { value: "dashboard", label: "Dashboard" },
  { value: "drive", label: "Drive" },
  { value: "docs", label: "Docs" },
  { value: "mail", label: "Mail" },
  { value: "calendar", label: "Calendar" },
  { value: "keep", label: "Keep" },
  { value: "sheets", label: "Sheets" },
  { value: "slides", label: "Slides" },
  { value: "chat", label: "Chat" },
];

const DATE_FORMATS = [
  { value: "MMM D, YYYY", label: "Jan 1, 2025" },
  { value: "D/M/YYYY", label: "1/1/2025" },
  { value: "M/D/YYYY", label: "1/1/2025 (US)" },
  { value: "YYYY-MM-DD", label: "2025-01-01 (ISO)" },
];

const TIME_FORMATS = [
  { value: "12h", label: "12-hour (1:00 PM)" },
  { value: "24h", label: "24-hour (13:00)" },
];

const WEEK_STARTS = [
  { value: "sunday", label: "Sunday" },
  { value: "monday", label: "Monday" },
];

/** applyDensity writes a data attribute on <html> so CSS/components can react. */
function applyDensity(density: string) {
  document.documentElement.dataset.density = density;
}

export default function SettingsPage({ user }: SettingsPageProps) {
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [draft, setDraft] = useState<Partial<UserPreferences>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPreferences()
      .then((p) => {
        setPrefs(p);
        setDraft(p);
        applyDensity(p.density);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  function set<K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K],
  ) {
    setDraft((d) => ({ ...d, [key]: value }));
    if (key === "density") {
      applyDensity(value as string);
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await updatePreferences({
        language: draft.language,
        density: draft.density,
        default_app: draft.default_app,
        date_format: draft.date_format,
        time_format: draft.time_format,
        week_start: draft.week_start,
        email_notifications: draft.email_notifications,
        extra: draft.extra,
      });
      setPrefs(updated);
      setDraft(updated);
      applyDensity(updated.density);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const dirty =
    prefs !== null &&
    (draft.language !== prefs.language ||
      draft.density !== prefs.density ||
      draft.default_app !== prefs.default_app ||
      draft.date_format !== prefs.date_format ||
      draft.time_format !== prefs.time_format ||
      draft.week_start !== prefs.week_start ||
      draft.email_notifications !== prefs.email_notifications);

  return (
    <>
      <Header user={user} />
      <Container maxWidth="sm" sx={{ py: { xs: 3, sm: 5 } }}>
        <Typography level="h2" sx={{ mb: 0.5 }}>
          Settings
        </Typography>
        <Typography level="body-sm" sx={{ mb: 4, opacity: 0.7 }}>
          Manage your account preferences.
        </Typography>

        <ProfileSection user={user} />

        {/* ── Profile photo ─────────────────────────── */}
        <Sheet variant="outlined" sx={{ borderRadius: "lg", p: 3, mb: 3 }}>
          <Typography level="title-md" sx={{ mb: 2 }}>
            Profile photo
          </Typography>
          <AvatarUploader
            user={user}
            onAvatarChange={() =>
              window.dispatchEvent(new Event("avatar-changed"))
            }
          />
        </Sheet>

        {/* ── API tokens ─────────────────────────── */}
        <ApiTokensSection />

        {loading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        )}
        {error && (
          <Sheet
            color="danger"
            variant="soft"
            sx={{ p: 2, mb: 3, borderRadius: "md" }}
          >
            <Typography color="danger">{error}</Typography>
          </Sheet>
        )}

        {!loading && draft && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {/* ── Language & Region ─────────────────────────── */}
            <Sheet variant="outlined" sx={{ borderRadius: "lg", p: 3 }}>
              <Typography level="title-md" sx={{ mb: 2 }}>
                Language &amp; Region
              </Typography>

              <FormControl sx={{ mb: 2 }}>
                <FormLabel>Language</FormLabel>
                <Select
                  value={draft.language ?? "en"}
                  onChange={(_, v) => v && set("language", v)}
                >
                  {LANGUAGES.map((l) => (
                    <Option key={l.value} value={l.value}>
                      {l.label}
                    </Option>
                  ))}
                </Select>
              </FormControl>

              <FormControl sx={{ mb: 2 }}>
                <FormLabel>Date format</FormLabel>
                <Select
                  value={draft.date_format ?? "MMM D, YYYY"}
                  onChange={(_, v) => v && set("date_format", v)}
                >
                  {DATE_FORMATS.map((f) => (
                    <Option key={f.value} value={f.value}>
                      {f.label}
                    </Option>
                  ))}
                </Select>
              </FormControl>

              <FormControl sx={{ mb: 2 }}>
                <FormLabel>Time format</FormLabel>
                <Select
                  value={draft.time_format ?? "12h"}
                  onChange={(_, v) => v && set("time_format", v)}
                >
                  {TIME_FORMATS.map((f) => (
                    <Option key={f.value} value={f.value}>
                      {f.label}
                    </Option>
                  ))}
                </Select>
              </FormControl>

              <FormControl>
                <FormLabel>Week starts on</FormLabel>
                <Select
                  value={draft.week_start ?? "sunday"}
                  onChange={(_, v) => v && set("week_start", v)}
                >
                  {WEEK_STARTS.map((w) => (
                    <Option key={w.value} value={w.value}>
                      {w.label}
                    </Option>
                  ))}
                </Select>
              </FormControl>
            </Sheet>

            {/* ── Appearance ───────────────────────────────── */}
            <Sheet variant="outlined" sx={{ borderRadius: "lg", p: 3 }}>
              <Typography level="title-md" sx={{ mb: 2 }}>
                Appearance
              </Typography>

              <FormControl sx={{ mb: 2 }}>
                <FormLabel>Density</FormLabel>
                <Select
                  value={draft.density ?? "comfortable"}
                  onChange={(_, v) => v && set("density", v)}
                >
                  {DENSITIES.map((d) => (
                    <Option key={d.value} value={d.value}>
                      {d.label}
                    </Option>
                  ))}
                </Select>
                <FormHelperText>
                  Controls spacing and component sizing across the app.
                </FormHelperText>
              </FormControl>

              <FormControl>
                <FormLabel>Default app on sign-in</FormLabel>
                <Select
                  value={draft.default_app ?? "dashboard"}
                  onChange={(_, v) => v && set("default_app", v)}
                >
                  {DEFAULT_APPS.map((a) => (
                    <Option key={a.value} value={a.value}>
                      {a.label}
                    </Option>
                  ))}
                </Select>
                <FormHelperText>
                  The page you land on after signing in.
                </FormHelperText>
              </FormControl>
            </Sheet>

            {/* ── Notifications ────────────────────────────── */}
            <Sheet variant="outlined" sx={{ borderRadius: "lg", p: 3 }}>
              <Typography level="title-md" sx={{ mb: 2 }}>
                Notifications
              </Typography>

              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Box>
                  <Typography level="body-md">Email notifications</Typography>
                  <Typography level="body-sm" sx={{ opacity: 0.7 }}>
                    Receive email digests and activity summaries.
                  </Typography>
                </Box>
                <Switch
                  checked={draft.email_notifications ?? true}
                  onChange={(e) => set("email_notifications", e.target.checked)}
                />
              </Box>
            </Sheet>

            <Divider />

            {/* ── Save bar ─────────────────────────────────── */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <Button loading={saving} disabled={!dirty} onClick={save}>
                Save changes
              </Button>
              {saved && (
                <Typography level="body-sm" color="success">
                  Saved.
                </Typography>
              )}
            </Box>
          </Box>
        )}
      </Container>
    </>
  );
}
