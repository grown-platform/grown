// ---------------------------------------------------------------------------
// Dashboard — the admin console landing page. Inspired by the Google Admin
// "Home" (quick-action cards + at-a-glance stats), but trimmed to the sections
// we actually have. It composes data we already serve: org stats from
// GET /api/v1/admin/analytics and the latest events from GET /api/v1/admin/audit.
// Everything degrades gracefully — if a non-admin somehow lands here, the
// data tiles hide rather than error, and the quick actions still work.
// ---------------------------------------------------------------------------
import { useEffect, useState } from "react";
import {
  Box,
  Chip,
  CircularProgress,
  Sheet,
  Table,
  Typography,
} from "@mui/joy";
import AppsIcon from "@mui/icons-material/Apps";
import PeopleIcon from "@mui/icons-material/People";
import GroupIcon from "@mui/icons-material/Group";
import DevicesIcon from "@mui/icons-material/Devices";
import ShieldIcon from "@mui/icons-material/Shield";
import GppMaybeIcon from "@mui/icons-material/GppMaybe";
import PublicIcon from "@mui/icons-material/Public";
import HistoryIcon from "@mui/icons-material/History";
import BarChartIcon from "@mui/icons-material/BarChart";
import SettingsIcon from "@mui/icons-material/Settings";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import {
  getAnalytics,
  formatBytes,
  AnalyticsForbiddenError,
  type AnalyticsResponse,
} from "./analyticsApi";
import { listAuditEvents, type AuditEvent } from "./auditApi";
import { getHoneypotCounts, type HoneypotCounts } from "./honeypotApi";

// Quick-action cards link to each working admin section. `section` is the
// /admin/:section id consumed by the parent's navigate().
const QUICK_ACTIONS: {
  section: string;
  label: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  { section: "users", label: "Users", description: "Add or manage people", icon: <PeopleIcon /> },
  { section: "services", label: "Services", description: "Turn apps on or off", icon: <AppsIcon /> },
  { section: "groups", label: "Groups", description: "Mailing lists & forums", icon: <GroupIcon /> },
  { section: "roles", label: "Admin roles", description: "Who can administer", icon: <AdminPanelSettingsIcon /> },
  { section: "sessions", label: "Sessions", description: "Active logins", icon: <DevicesIcon /> },
  { section: "security", label: "Security", description: "Policies & 2FA", icon: <ShieldIcon /> },
  { section: "geo", label: "Region access", description: "Block or allow by country", icon: <PublicIcon /> },
  { section: "honeypot", label: "Honeypot", description: "Intrusion alerts", icon: <GppMaybeIcon /> },
  { section: "audit", label: "Audit log", description: "Recent activity", icon: <HistoryIcon /> },
  { section: "analytics", label: "Analytics", description: "Usage & storage", icon: <BarChartIcon /> },
  { section: "settings", label: "Org settings", description: "Name & branding", icon: <SettingsIcon /> },
];

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <Sheet
      variant="outlined"
      sx={{
        borderRadius: "md",
        p: 2,
        flex: "1 1 140px",
        minWidth: 140,
        display: "flex",
        flexDirection: "column",
        gap: 0.5,
      }}
    >
      <Typography
        level="body-xs"
        sx={{ opacity: 0.6, textTransform: "uppercase", letterSpacing: 0.5 }}
      >
        {label}
      </Typography>
      <Typography level="h3" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </Typography>
    </Sheet>
  );
}

export function DashboardSection({
  onNavigate,
}: {
  onNavigate: (section: string) => void;
}) {
  const [stats, setStats] = useState<AnalyticsResponse | null>(null);
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [honeypot, setHoneypot] = useState<HoneypotCounts | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      // All calls are best-effort: a failure (e.g. forbidden) just hides that
      // panel/badge rather than blocking the whole dashboard.
      const [s, e, h] = await Promise.allSettled([
        getAnalytics(),
        listAuditEvents({ limit: 5 }),
        getHoneypotCounts(),
      ]);
      if (!alive) return;
      if (s.status === "fulfilled") setStats(s.value);
      else if (!(s.reason instanceof AnalyticsForbiddenError)) {
        // Non-forbidden errors still leave stats null; the panel just hides.
      }
      if (e.status === "fulfilled") setEvents(e.value);
      if (h.status === "fulfilled") setHoneypot(h.value);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // A small red badge on the Honeypot quick action when there are recent alerts.
  const honeypotBadge = honeypot && honeypot.last_24h > 0 ? honeypot.last_24h : 0;

  return (
    <>
      <Box sx={{ mb: 2 }}>
        <Typography level="h4">Dashboard</Typography>
        <Typography level="body-sm" sx={{ opacity: 0.7 }}>
          An at-a-glance view of your organization, with quick links to manage
          it.
        </Typography>
      </Box>

      {/* At-a-glance stat tiles (hidden if analytics is unavailable). */}
      {loading && !stats && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      )}
      {stats && (
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 3 }}>
          <StatTile label="Members" value={stats.users.total_members} />
          <StatTile label="Admins" value={stats.users.total_admins} />
          <StatTile label="Active (7 days)" value={stats.users.active_last_7_days} />
          <StatTile label="Storage used" value={formatBytes(stats.storage.total_bytes)} />
          {stats.users.demo_configured && (
            <StatTile
              label="Demo logins (unique IPs)"
              value={stats.users.demo_unique_ips}
            />
          )}
        </Box>
      )}

      {/* Quick actions. */}
      <Typography level="title-sm" sx={{ mb: 1.5 }}>
        Quick actions
      </Typography>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "repeat(2, 1fr)",
            sm: "repeat(3, 1fr)",
          },
          gap: 1.5,
          mb: 3,
        }}
      >
        {QUICK_ACTIONS.map((a) => (
          <Sheet
            key={a.section}
            variant="outlined"
            onClick={() => onNavigate(a.section)}
            data-testid={`admin-quick-${a.section}`}
            sx={{
              position: "relative",
              borderRadius: "md",
              p: 2,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              transition: "border-color 0.15s, background-color 0.15s",
              "&:hover": {
                borderColor: "primary.outlinedBorder",
                bgcolor: "background.level1",
              },
            }}
          >
            {a.section === "honeypot" && honeypotBadge > 0 && (
              <Chip
                size="sm"
                variant="solid"
                color="danger"
                data-testid="admin-honeypot-badge"
                sx={{ position: "absolute", top: 8, right: 8 }}
              >
                {honeypotBadge}
              </Chip>
            )}
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: "sm",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                bgcolor: "background.level1",
                color: "text.secondary",
                flexShrink: 0,
              }}
            >
              {a.icon}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography level="body-sm" sx={{ fontWeight: 600 }} noWrap>
                {a.label}
              </Typography>
              <Typography level="body-xs" sx={{ opacity: 0.7 }} noWrap>
                {a.description}
              </Typography>
            </Box>
          </Sheet>
        ))}
      </Box>

      {/* Recent activity (hidden if the audit log is unavailable/empty). */}
      {events && events.length > 0 && (
        <>
          <Box
            sx={{
              display: "flex",
              alignItems: "baseline",
              gap: 1,
              mb: 1.5,
            }}
          >
            <Typography level="title-sm" sx={{ flex: 1 }}>
              Recent activity
            </Typography>
            <Typography
              level="body-xs"
              sx={{ cursor: "pointer", color: "primary.500" }}
              onClick={() => onNavigate("audit")}
              data-testid="admin-dash-viewaudit"
            >
              View audit log →
            </Typography>
          </Box>
          <Sheet
            variant="outlined"
            sx={{ borderRadius: "md", overflow: "hidden", overflowX: "auto" }}
          >
            <Table
              size="sm"
              hoverRow
              sx={{ minWidth: 520, "--TableCell-paddingX": "10px" }}
            >
              <thead>
                <tr>
                  <th style={{ width: 170 }}>Time</th>
                  <th style={{ width: 200 }}>Actor</th>
                  <th style={{ width: 110 }}>Service</th>
                  <th>Action</th>
                  <th style={{ width: 80 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id}>
                    <td>
                      <Typography level="body-xs" sx={{ whiteSpace: "nowrap" }}>
                        {fmtTime(ev.created_at)}
                      </Typography>
                    </td>
                    <td>
                      <Typography
                        level="body-xs"
                        sx={{ wordBreak: "break-all" }}
                      >
                        {ev.actor_email || "—"}
                      </Typography>
                    </td>
                    <td>
                      <Chip size="sm" variant="soft">
                        {ev.service || "—"}
                      </Chip>
                    </td>
                    <td>
                      <Typography level="body-xs">
                        {ev.action || "—"}
                      </Typography>
                    </td>
                    <td>
                      <Chip
                        size="sm"
                        variant="soft"
                        color={ev.status === "error" ? "danger" : "success"}
                      >
                        {ev.status || "—"}
                      </Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Sheet>
        </>
      )}
    </>
  );
}
