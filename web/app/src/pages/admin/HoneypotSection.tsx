// HoneypotSection — Admin → Security / Honeypot. Read-only listing of intrusion
// tripwire alerts (internal/honeypot, GET /api/v1/admin/honeypot). Alerts are
// raised when an unauthenticated prober touches a decoy path that no real UI
// links to (e.g. /.env, /wp-login.php) or submits a hidden honeypot form field.
// Instance-level (NOT per-org). A "Clear" action acknowledges/removes them.
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
import GppMaybeIcon from "@mui/icons-material/GppMaybe";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
  getHoneypot,
  clearHoneypot,
  kindLabel,
  HoneypotForbiddenError,
  type HoneypotAlert,
  type HoneypotCounts,
} from "./honeypotApi";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function kindColor(kind: string): "danger" | "warning" | "neutral" {
  if (kind === "decoy_path") return "danger";
  if (kind === "form_bot") return "warning";
  return "neutral";
}

export function HoneypotSection() {
  const [alerts, setAlerts] = useState<HoneypotAlert[] | null>(null);
  const [counts, setCounts] = useState<HoneypotCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const r = await getHoneypot();
      setAlerts(r.alerts);
      setCounts(r.counts);
    } catch (e) {
      if (e instanceof HoneypotForbiddenError) setForbidden(true);
      else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onClear() {
    if (
      !window.confirm(
        "Clear all honeypot alerts? This permanently removes the recorded intrusion attempts.",
      )
    )
      return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const n = await clearHoneypot();
      setNotice(`Cleared ${n} alert${n === 1 ? "" : "s"}.`);
      await load();
    } catch (e) {
      if (e instanceof HoneypotForbiddenError) setForbidden(true);
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const hasAlerts = useMemo(() => (alerts?.length ?? 0) > 0, [alerts]);

  if (forbidden) {
    return (
      <>
        <Typography level="h4" sx={{ mb: 1 }}>
          Security / Honeypot
        </Typography>
        <Alert color="warning" variant="soft">
          You need admin privileges to view honeypot alerts. Ask an org admin to
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
          <Typography level="h4">Security / Honeypot</Typography>
          <Typography level="body-sm" sx={{ opacity: 0.7 }}>
            Intrusion tripwires. Alerts fire when a prober hits a decoy path no
            real page links to, or submits a hidden bot-trap form field.
          </Typography>
        </Box>
        <Button
          size="sm"
          variant="outlined"
          color="neutral"
          startDecorator={<RefreshIcon />}
          onClick={() => void load()}
          loading={loading}
          data-testid="honeypot-refresh"
        >
          Refresh
        </Button>
        <Button
          size="sm"
          variant="soft"
          color="danger"
          onClick={onClear}
          loading={busy}
          disabled={!hasAlerts}
          data-testid="honeypot-clear"
        >
          Clear
        </Button>
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

      {/* Count tiles. */}
      {counts && (
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mb: 2 }}>
          <Chip
            size="lg"
            variant="soft"
            color={counts.last_24h > 0 ? "danger" : "neutral"}
            startDecorator={<GppMaybeIcon />}
          >
            {counts.last_24h} in last 24h
          </Chip>
          <Chip size="lg" variant="soft" color="neutral">
            {counts.total} total
          </Chip>
          {Object.entries(counts.by_kind).map(([k, n]) => (
            <Chip key={k} size="lg" variant="outlined" color={kindColor(k)}>
              {kindLabel(k)}: {n}
            </Chip>
          ))}
        </Box>
      )}

      {loading && !alerts ? (
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
                <th style={{ width: 110 }}>Kind</th>
                <th>Path</th>
                <th style={{ width: 70 }}>Method</th>
                <th style={{ width: 130 }}>IP</th>
                <th style={{ width: 70 }}>Country</th>
                <th style={{ width: 160 }}>User agent</th>
              </tr>
            </thead>
            <tbody>
              {(alerts ?? []).map((a) => (
                <tr key={a.id} data-testid={`honeypot-alert-${a.id}`}>
                  <td>
                    <Typography level="body-xs" sx={{ whiteSpace: "nowrap" }}>
                      {fmtTime(a.created_at)}
                    </Typography>
                  </td>
                  <td>
                    <Chip size="sm" variant="soft" color={kindColor(a.kind)}>
                      {kindLabel(a.kind)}
                    </Chip>
                  </td>
                  <td>
                    <Typography
                      level="body-xs"
                      sx={{ wordBreak: "break-all", fontFamily: "monospace" }}
                    >
                      {a.path || a.detail || "—"}
                    </Typography>
                  </td>
                  <td>
                    <Typography level="body-xs">{a.method || "—"}</Typography>
                  </td>
                  <td>
                    <Typography level="body-xs" sx={{ fontFamily: "monospace" }}>
                      {a.ip || "—"}
                    </Typography>
                  </td>
                  <td>
                    <Typography level="body-xs">{a.country || "—"}</Typography>
                  </td>
                  <td>
                    <Tooltip title={a.user_agent || ""} variant="soft">
                      <Typography level="body-xs" noWrap sx={{ maxWidth: 150 }}>
                        {a.user_agent || "—"}
                      </Typography>
                    </Tooltip>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          {!hasAlerts && (
            <Box sx={{ p: 4, textAlign: "center" }}>
              <Typography level="body-sm" sx={{ opacity: 0.6 }}>
                No intrusion alerts. The tripwires are armed and quiet.
              </Typography>
            </Box>
          )}
        </Sheet>
      )}
    </>
  );
}
