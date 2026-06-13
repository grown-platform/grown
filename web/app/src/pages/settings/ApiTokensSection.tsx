import { useEffect, useState } from "react";
import {
  Sheet,
  Typography,
  Box,
  Stack,
  Input,
  Button,
  IconButton,
  Checkbox,
  Radio,
  RadioGroup,
  Select,
  Option,
  FormControl,
  FormLabel,
  Chip,
} from "@mui/joy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import KeyIcon from "@mui/icons-material/VpnKey";

interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  last_used_at?: number;
  expires_at?: number;
  created_at: number;
}

const SERVICES = [
  "drive",
  "mail",
  "calendar",
  "contacts",
  "sheets",
  "docs",
  "photos",
  "music",
  "video",
  "tasks",
];

const BASE = "/api/v1/me/tokens";

async function jget(): Promise<ApiToken[]> {
  const r = await fetch(BASE, { credentials: "same-origin" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return ((await r.json()) as { tokens?: ApiToken[] }).tokens ?? [];
}

/** ApiTokensSection lets a user create, view and revoke personal API tokens. */
export function ApiTokensSection() {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [name, setName] = useState("");
  const [fullAccess, setFullAccess] = useState(true);
  const [services, setServices] = useState<Set<string>>(new Set());
  const [readOnly, setReadOnly] = useState(false);
  const [expiry, setExpiry] = useState("0");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => jget().then(setTokens).catch(() => {});
  useEffect(() => {
    void reload();
  }, []);

  function toggleService(s: string) {
    setServices((cur) => {
      const next = new Set(cur);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  }

  async function create() {
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      let scopes: string[];
      if (fullAccess) scopes = ["*"];
      else
        scopes = [...services].map((s) => (readOnly ? `${s}:read` : s));
      if (!fullAccess && scopes.length === 0) {
        setError("Pick at least one service, or choose Full access.");
        setBusy(false);
        return;
      }
      const r = await fetch(BASE, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || "API token",
          scopes,
          expires_in_days: Number(expiry) || 0,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = (await r.json()) as { token: string };
      setCreated(data.token);
      setName("");
      setServices(new Set());
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this token? Anything using it will stop working.")) return;
    await fetch(`${BASE}/${id}`, { method: "DELETE", credentials: "same-origin" });
    await reload();
  }

  const fmt = (sec?: number) =>
    sec ? new Date(sec * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;

  return (
    <Sheet variant="outlined" sx={{ borderRadius: "lg", p: 3, mb: 3 }}>
      <Typography level="title-md" startDecorator={<KeyIcon />} sx={{ mb: 0.5 }}>
        API tokens
      </Typography>
      <Typography level="body-sm" sx={{ mb: 2, opacity: 0.7 }}>
        Personal access tokens authenticate scripts and integrations as you, over
        the HTTP API. Send <code>Authorization: Bearer &lt;token&gt;</code>. A
        token is shown once — copy it now.
      </Typography>

      {created && (
        <Sheet
          color="success"
          variant="soft"
          sx={{ p: 1.5, mb: 2, borderRadius: "md", display: "flex", alignItems: "center", gap: 1 }}
        >
          <Typography level="body-sm" sx={{ fontFamily: "monospace", wordBreak: "break-all", flex: 1 }}>
            {created}
          </Typography>
          <IconButton size="sm" onClick={() => navigator.clipboard?.writeText(created)} title="Copy">
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Sheet>
      )}
      {error && (
        <Typography color="danger" level="body-sm" sx={{ mb: 1 }}>
          {error}
        </Typography>
      )}

      {/* Create form */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mb: 3 }}>
        <FormControl size="sm">
          <FormLabel>Name</FormLabel>
          <Input
            placeholder="e.g. CI pipeline"
            value={name}
            onChange={(e) => setName(e.target.value)}
            sx={{ maxWidth: 320 }}
          />
        </FormControl>
        <FormControl size="sm">
          <FormLabel>Access</FormLabel>
          <RadioGroup
            orientation="horizontal"
            value={fullAccess ? "full" : "limited"}
            onChange={(e) => setFullAccess(e.target.value === "full")}
          >
            <Radio value="full" label="Full access" />
            <Radio value="limited" label="Limited" />
          </RadioGroup>
        </FormControl>
        {!fullAccess && (
          <Box>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, mb: 1 }}>
              {SERVICES.map((s) => (
                <Checkbox
                  key={s}
                  size="sm"
                  label={s}
                  checked={services.has(s)}
                  onChange={() => toggleService(s)}
                />
              ))}
            </Box>
            <Checkbox
              size="sm"
              label="Read-only (GET requests only)"
              checked={readOnly}
              onChange={(e) => setReadOnly(e.target.checked)}
            />
          </Box>
        )}
        <FormControl size="sm" sx={{ maxWidth: 200 }}>
          <FormLabel>Expires</FormLabel>
          <Select value={expiry} onChange={(_, v) => v && setExpiry(v)}>
            <Option value="0">Never</Option>
            <Option value="30">In 30 days</Option>
            <Option value="90">In 90 days</Option>
            <Option value="365">In 1 year</Option>
          </Select>
        </FormControl>
        <Button onClick={create} loading={busy} sx={{ alignSelf: "flex-start" }} startDecorator={<KeyIcon />}>
          Generate token
        </Button>
      </Box>

      {/* Existing tokens */}
      {tokens.length === 0 ? (
        <Typography level="body-sm" sx={{ opacity: 0.6 }}>
          No tokens yet.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {tokens.map((t) => (
            <Box
              key={t.id}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                p: 1.25,
                border: "1px solid",
                borderColor: "divider",
                borderRadius: "md",
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography level="body-sm" sx={{ fontWeight: 600 }}>
                  {t.name}{" "}
                  <Typography component="span" level="body-xs" sx={{ fontFamily: "monospace", opacity: 0.6 }}>
                    {t.prefix}…
                  </Typography>
                </Typography>
                <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mt: 0.5 }}>
                  {t.scopes.map((s) => (
                    <Chip key={s} size="sm" variant="soft" color={s === "*" ? "primary" : "neutral"}>
                      {s === "*" ? "full access" : s}
                    </Chip>
                  ))}
                </Box>
                <Typography level="body-xs" sx={{ opacity: 0.55, mt: 0.5 }}>
                  {t.last_used_at ? `last used ${fmt(t.last_used_at)}` : "never used"}
                  {t.expires_at ? ` · expires ${fmt(t.expires_at)}` : " · no expiry"}
                </Typography>
              </Box>
              <IconButton size="sm" variant="plain" color="danger" onClick={() => revoke(t.id)} title="Revoke">
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
        </Stack>
      )}
    </Sheet>
  );
}
