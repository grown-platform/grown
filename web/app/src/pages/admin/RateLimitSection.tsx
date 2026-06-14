// RateLimitSection — Admin → Rate limiting. Read-only observability for the
// per-IP API rate limiter (internal/ratelimit, GET /api/v1/admin/ratelimit):
// the effective config (GROWN_RATELIMIT_*), recent 429 block events, and the
// top offending IPs in the last 24h. Instance-level (the limiter keys on IP,
// not org). Mirrors HoneypotSection's layout.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Typography,
  Sheet,
  Alert,
  Button,
  Chip,
  CircularProgress,
  Table,
  Tooltip,
} from "@mui/joy";
import SpeedIcon from "@mui/icons-material/Speed";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
  getRateLimit,
  RateLimitForbiddenError,
  type RateLimitBlock,
  type RateLimitCounts,
  type RateLimitOffender,
  type RateLimitSettings,
} from "./ratelimitApi";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function bucketColor(bucket: string): "danger" | "warning" | "neutral" {
  if (bucket === "auth") return "danger";
  if (bucket === "general") return "warning";
  return "neutral";
}

export function RateLimitSection() {
  const [settings, setSettings] = useState<RateLimitSettings | null>(null);
  const [counts, setCounts] = useState<RateLimitCounts | null>(null);
  const [blocks, setBlocks] = useState<RateLimitBlock[] | null>(null);
  const [offenders, setOffenders] = useState<RateLimitOffender[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const r = await getRateLimit();
      setSettings(r.settings);
      setCounts(r.counts);
      setBlocks(r.blocks);
      setOffenders(r.top_offenders);
    } catch (e) {
      if (e instanceof RateLimitForbiddenError) setForbidden(true);
      else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasBlocks = useMemo(() => (blocks?.length ?? 0) > 0, [blocks]);

  if (forbidden) {
    return (
      <>
        <Typography level="h4" sx={{ mb: 1 }}>
          Rate limiting
        </Typography>
        <Alert color="warning" variant="soft">
          You need admin privileges to view rate-limiting activity. Ask an org
          admin to add your email to <code>GROWN_ADMIN_EMAILS</code>.
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
          <Typography level="h4">Rate limiting</Typography>
          <Typography level="body-sm" sx={{ opacity: 0.7 }}>
            Per-IP API throttling. A stricter bucket guards the auth endpoints to
            blunt credential stuffing. Counts below are instance-wide.
          </Typography>
        </Box>
        <Button
          size="sm"
          variant="outlined"
          color="neutral"
          startDecorator={<RefreshIcon />}
          onClick={() => void load()}
          loading={loading}
          data-testid="ratelimit-refresh"
        >
          Refresh
        </Button>
      </Box>

      {error && (
        <Alert color="danger" variant="soft" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Config + count tiles. */}
      {settings && (
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mb: 2 }}>
          <Chip
            size="lg"
            variant="soft"
            color={settings.enabled ? "success" : "neutral"}
            startDecorator={<SpeedIcon />}
          >
            {settings.enabled ? "Enabled" : "Disabled"}
          </Chip>
          <Chip size="lg" variant="outlined" color="neutral">
            General: {settings.general_rps}/s (burst {settings.general_burst})
          </Chip>
          <Chip size="lg" variant="outlined" color="danger">
            Auth: {settings.auth_rps}/s (burst {settings.auth_burst})
          </Chip>
          <Chip size="lg" variant="outlined" color="neutral">
            Keyed by {settings.key_by}
          </Chip>
          {counts && (
            <>
              <Chip
                size="lg"
                variant="soft"
                color={counts.last_24h > 0 ? "warning" : "neutral"}
              >
                {counts.last_24h} blocked (24h)
              </Chip>
              <Chip size="lg" variant="soft" color="neutral">
                {counts.total} total
              </Chip>
            </>
          )}
        </Box>
      )}

      {/* Top offending IPs (24h). */}
      {offenders.length > 0 && (
        <>
          <Typography level="title-sm" sx={{ mb: 1 }}>
            Top offending IPs (24h)
          </Typography>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 2 }}>
            {offenders.map((o) => (
              <Chip key={o.ip} size="sm" variant="soft" color="warning">
                <span style={{ fontFamily: "monospace" }}>{o.ip}</span> ·{" "}
                {o.count}
              </Chip>
            ))}
          </Box>
        </>
      )}

      <Typography level="title-sm" sx={{ mb: 1 }}>
        Recent throttle events
      </Typography>
      {loading && !blocks ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Sheet
          variant="outlined"
          sx={{ borderRadius: "md", overflow: "hidden", overflowX: "auto" }}
        >
          <Table
            size="sm"
            hoverRow
            sx={{ minWidth: 640, "--TableCell-paddingX": "10px" }}
          >
            <thead>
              <tr>
                <th style={{ width: 170 }}>Time</th>
                <th style={{ width: 130 }}>IP</th>
                <th style={{ width: 90 }}>Bucket</th>
                <th>Path</th>
                <th style={{ width: 70 }}>Country</th>
                <th style={{ width: 160 }}>User agent</th>
              </tr>
            </thead>
            <tbody>
              {(blocks ?? []).map((b) => (
                <tr key={b.id} data-testid={`ratelimit-block-${b.id}`}>
                  <td>
                    <Typography level="body-xs" sx={{ whiteSpace: "nowrap" }}>
                      {fmtTime(b.created_at)}
                    </Typography>
                  </td>
                  <td>
                    <Typography level="body-xs" sx={{ fontFamily: "monospace" }}>
                      {b.ip || "—"}
                    </Typography>
                  </td>
                  <td>
                    <Chip size="sm" variant="soft" color={bucketColor(b.bucket)}>
                      {b.bucket || "—"}
                    </Chip>
                  </td>
                  <td>
                    <Typography
                      level="body-xs"
                      sx={{ wordBreak: "break-all", fontFamily: "monospace" }}
                    >
                      {b.path || "—"}
                    </Typography>
                  </td>
                  <td>
                    <Typography level="body-xs">{b.country || "—"}</Typography>
                  </td>
                  <td>
                    <Tooltip title={b.user_agent || ""} variant="soft">
                      <Typography level="body-xs" noWrap sx={{ maxWidth: 150 }}>
                        {b.user_agent || "—"}
                      </Typography>
                    </Tooltip>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          {!hasBlocks && (
            <Box sx={{ p: 4, textAlign: "center" }}>
              <Typography level="body-sm" sx={{ opacity: 0.6 }}>
                No throttle events recorded. Traffic is within the configured
                limits.
              </Typography>
            </Box>
          )}
        </Sheet>
      )}
    </>
  );
}
