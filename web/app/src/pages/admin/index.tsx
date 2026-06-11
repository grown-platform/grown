import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Sheet,
  Avatar,
  Switch,
  Input,
  CircularProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemDecorator,
  Chip,
  Alert,
  Divider,
  Button,
  IconButton,
  Dropdown,
  Menu,
  MenuButton,
  MenuItem,
  Modal,
  ModalDialog,
  ModalClose,
  FormControl,
  FormLabel,
  FormHelperText,
  Checkbox,
  Table,
  Link,
  Drawer,
  Tabs,
  TabList,
  Tab,
} from "@mui/joy";
import * as Icons from "@mui/icons-material";
import SearchIcon from "@mui/icons-material/Search";
import MenuIcon from "@mui/icons-material/Menu";
import DashboardIcon from "@mui/icons-material/Dashboard";
import AppsIcon from "@mui/icons-material/Apps";
import PeopleIcon from "@mui/icons-material/People";
import SettingsIcon from "@mui/icons-material/Settings";
import HistoryIcon from "@mui/icons-material/History";
import RefreshIcon from "@mui/icons-material/Refresh";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import DevicesIcon from "@mui/icons-material/Devices";
import BarChartIcon from "@mui/icons-material/BarChart";
import ShieldIcon from "@mui/icons-material/Shield";
import GroupIcon from "@mui/icons-material/Group";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import { Header } from "../../components/Header";
import { SecuritySection } from "./SecuritySection";
import { DashboardSection } from "./DashboardSection";
import { GroupsSection } from "./GroupsSection";
import { RolesSection } from "./RolesSection";
import { whoami } from "../../api/client";
import type { Org, User } from "../../api/types";
import { apps, type AppTile } from "../../catalog/apps";
import { getServiceSettings, setServiceSettings } from "./api";
import {
  listUsers,
  createUser,
  updateUser,
  deactivateUser,
  reactivateUser,
  setPassword,
  removeFromOrg,
  hardDeleteUser,
  setAdmin,
  isActive,
  userLabel,
  adminWhoAmI,
  ServiceTokenMissingError,
  ForbiddenError,
  LastAdminError,
  type AdminUser,
  type CreateUserInput,
} from "./usersApi";
import {
  listAuditEvents,
  ForbiddenError as AuditForbiddenError,
  type AuditEvent,
} from "./auditApi";
import {
  renameOrg,
  getAdminBranding,
  setAccentColor,
  setProductName,
  uploadLogo,
  clearLogo,
  listOrgSessions,
  revokeOrgSession,
  ForbiddenError as OrgForbiddenError,
  type SessionRow,
} from "./orgApi";
import {
  getAnalytics,
  formatBytes,
  AnalyticsForbiddenError,
  type AnalyticsResponse,
} from "./analyticsApi";

// Services absent from the stored settings are enabled by default (default-on),
// so the UI starts every service ON until the org explicitly disables it.
const DEFAULT_ENABLED = true;

// Per-app placeholder examples for the "External URL" override — point a tile at
// a self-hosted alternative instead of the built-in app. Falls back to a generic.
const EXTERNAL_URL_EXAMPLES: Record<string, string> = {
  photos: "https://immich.yourdomain.com",
  drive: "https://nextcloud.yourdomain.com",
  mail: "https://webmail.yourdomain.com",
  meet: "https://meet.jit.si",
  chat: "https://mattermost.yourdomain.com",
  projects: "https://plane.yourdomain.com",
  whiteboard: "https://excalidraw.com",
  music: "https://navidrome.yourdomain.com",
  video: "https://jellyfin.yourdomain.com",
  books: "https://calibre-web.yourdomain.com",
  sign: "https://docuseal.yourdomain.com",
  calendar: "https://cal.yourdomain.com",
  contacts: "https://contacts.yourdomain.com",
  docs: "https://docs.yourdomain.com",
  sheets: "https://sheets.yourdomain.com",
  assemble: "https://assemble.yourdomain.com",
};
function externalUrlExample(appId: string): string {
  return EXTERNAL_URL_EXAMPLES[appId] ?? "https://app.yourdomain.com";
}

// Left-nav sections, modeled on the Google Admin console. Each section maps to a
// URL path under /admin so e.g. the Users console is its own page at /admin/users.
type SectionId =
  | "dashboard"
  | "services"
  | "users"
  | "groups"
  | "roles"
  | "sessions"
  | "audit"
  | "analytics"
  | "security"
  | "settings";
const SECTIONS: {
  id: SectionId;
  label: string;
  icon: React.ReactNode;
  enabled: boolean;
}[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: <DashboardIcon />,
    enabled: true,
  },
  { id: "services", label: "Services", icon: <AppsIcon />, enabled: true },
  { id: "users", label: "Users", icon: <PeopleIcon />, enabled: true },
  { id: "groups", label: "Groups", icon: <GroupIcon />, enabled: true },
  {
    id: "roles",
    label: "Admin roles",
    icon: <AdminPanelSettingsIcon />,
    enabled: true,
  },
  {
    id: "sessions",
    label: "Sessions & logins",
    icon: <DevicesIcon />,
    enabled: true,
  },
  { id: "audit", label: "Audit log", icon: <HistoryIcon />, enabled: true },
  {
    id: "analytics",
    label: "Analytics",
    icon: <BarChartIcon />,
    enabled: true,
  },
  {
    id: "security",
    label: "Security",
    icon: <ShieldIcon />,
    enabled: true,
  },
  {
    id: "settings",
    label: "Org settings",
    icon: <SettingsIcon />,
    enabled: true,
  },
];

// Default section when the path is bare /admin.
const DEFAULT_SECTION: SectionId = "dashboard";

function isSectionId(v: string | undefined): v is SectionId {
  return !!v && SECTIONS.some((s) => s.id === v && s.enabled);
}

function iconFor(
  app: AppTile,
): React.ComponentType<{ sx?: object }> | undefined {
  return (Icons as Record<string, React.ComponentType<{ sx?: object }>>)[
    app.iconName
  ];
}

interface AdminAppProps {
  user: User;
}

export default function AdminApp({ user }: AdminAppProps) {
  // The active section is driven by the URL (/admin/:section), so each section is
  // its own page path — e.g. /admin/users. Bare /admin redirects to the default.
  const navigate = useNavigate();
  const { section: sectionParam } = useParams<{ section: string }>();
  const section: SectionId = isSectionId(sectionParam)
    ? sectionParam
    : DEFAULT_SECTION;
  const setSection = useCallback(
    (id: SectionId) => navigate(`/admin/${id}`),
    [navigate],
  );
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Normalize bare /admin (or an unknown/disabled section) to the default path.
  useEffect(() => {
    if (!isSectionId(sectionParam)) {
      navigate(`/admin/${DEFAULT_SECTION}`, { replace: true });
    }
  }, [sectionParam, navigate]);

  const enabledSections = SECTIONS.filter((s) => s.enabled);

  return (
    <>
      <Header user={user} />
      <Container
        maxWidth="lg"
        sx={{ py: { xs: 2, sm: 4 }, px: { xs: 1.5, sm: 3 } }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 3 }}>
          <IconButton
            variant="plain"
            sx={{ display: { xs: "flex", sm: "none" } }}
            aria-label="Open navigation"
            onClick={() => setDrawerOpen(true)}
          >
            <MenuIcon />
          </IconButton>
          <Avatar sx={{ bgcolor: "#5f6368", color: "#fff" }}>
            <Icons.AdminPanelSettings />
          </Avatar>
          <Typography
            level="h2"
            sx={{ flex: 1, fontSize: { xs: "xl", sm: "xl3" } }}
          >
            Admin
          </Typography>
        </Box>

        {/* Mobile tabs for nav */}
        <Box sx={{ display: { xs: "block", sm: "none" }, mb: 2 }}>
          <Tabs
            value={section}
            onChange={(_, v) => v && setSection(v as SectionId)}
            sx={{ bgcolor: "transparent" }}
          >
            <TabList>
              {enabledSections.map((sec) => (
                <Tab
                  key={sec.id}
                  value={sec.id}
                  data-testid={`admin-nav-${sec.id}`}
                >
                  {sec.label}
                </Tab>
              ))}
            </TabList>
          </Tabs>
        </Box>

        {/* Mobile nav drawer */}
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          anchor="left"
          size="sm"
        >
          <ModalClose />
          <Typography level="title-lg" sx={{ p: 2, pb: 1 }}>
            Admin
          </Typography>
          <List size="sm" sx={{ "--ListItem-radius": "8px", px: 1 }}>
            {SECTIONS.map((sec) => (
              <ListItem key={sec.id}>
                <ListItemButton
                  selected={section === sec.id}
                  disabled={!sec.enabled}
                  onClick={() => {
                    if (sec.enabled) {
                      setSection(sec.id);
                      setDrawerOpen(false);
                    }
                  }}
                  data-testid={`admin-nav-${sec.id}`}
                >
                  <ListItemDecorator>{sec.icon}</ListItemDecorator>
                  <Box sx={{ flex: 1 }}>{sec.label}</Box>
                  {!sec.enabled && (
                    <Chip size="sm" variant="soft" color="neutral">
                      Soon
                    </Chip>
                  )}
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Drawer>

        <Box sx={{ display: "flex", gap: 3, alignItems: "flex-start" }}>
          {/* Left nav — desktop only */}
          <Box
            sx={{
              width: 220,
              flexShrink: 0,
              display: { xs: "none", sm: "block" },
            }}
          >
            <List size="sm" sx={{ "--ListItem-radius": "8px" }}>
              {SECTIONS.map((sec) => (
                <ListItem key={sec.id}>
                  <ListItemButton
                    selected={section === sec.id}
                    disabled={!sec.enabled}
                    onClick={() => sec.enabled && setSection(sec.id)}
                    data-testid={`admin-nav-${sec.id}`}
                  >
                    <ListItemDecorator>{sec.icon}</ListItemDecorator>
                    <Box sx={{ flex: 1 }}>{sec.label}</Box>
                    {!sec.enabled && (
                      <Chip size="sm" variant="soft" color="neutral">
                        Soon
                      </Chip>
                    )}
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </Box>

          {/* Main panel */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {section === "dashboard" && (
              <DashboardSection onNavigate={(s) => setSection(s as SectionId)} />
            )}
            {section === "services" && <AppsSection />}
            {section === "users" && <UsersSection />}
            {section === "groups" && <GroupsSection />}
            {section === "roles" && <RolesSection />}
            {section === "sessions" && <SessionsSection />}
            {section === "audit" && <AuditSection />}
            {section === "analytics" && <AnalyticsSection />}
            {section === "security" && <SecuritySection />}
            {section === "settings" && (
              <OrgSettingsSection
                user={user}
                onGoToApps={() => setSection("services")}
              />
            )}
          </Box>
        </Box>
      </Container>
    </>
  );
}

// ---------------------------------------------------------------------------
// Apps & services — the original per-org service-toggle UI, unchanged in
// behavior, lifted into its own section component.
// ---------------------------------------------------------------------------
function AppsSection() {
  const [enabledById, setEnabledById] = useState<Record<
    string,
    boolean
  > | null>(null);
  // Per-service external URL values as shown in the text fields (draft state).
  const [extUrlDraft, setExtUrlDraft] = useState<Record<string, string>>({});
  // Per-service external URL values last successfully saved (for dirty-detection).
  const [extUrlSaved, setExtUrlSaved] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await getServiceSettings();
        const enabledOverrides = new Map(
          settings.map((s) => [s.service_id, s.enabled]),
        );
        const urlOverrides = new Map(
          settings.map((s) => [s.service_id, s.external_url ?? ""]),
        );
        const resolved: Record<string, boolean> = {};
        const urls: Record<string, string> = {};
        for (const a of apps) {
          resolved[a.id] = enabledOverrides.has(a.id)
            ? enabledOverrides.get(a.id)!
            : DEFAULT_ENABLED;
          urls[a.id] = urlOverrides.get(a.id) ?? "";
        }
        if (!cancelled) {
          setEnabledById(resolved);
          setExtUrlDraft(urls);
          setExtUrlSaved(urls);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(serviceId: string, next: boolean) {
    setEnabledById((cur) => (cur ? { ...cur, [serviceId]: next } : cur));
    setSaving((s) => new Set(s).add(serviceId));
    try {
      await setServiceSettings([
        {
          service_id: serviceId,
          enabled: next,
          external_url: extUrlSaved[serviceId] ?? "",
        },
      ]);
      setError(null);
    } catch (e) {
      setEnabledById((cur) => (cur ? { ...cur, [serviceId]: !next } : cur));
      setError((e as Error).message);
    } finally {
      setSaving((s) => {
        const n = new Set(s);
        n.delete(serviceId);
        return n;
      });
    }
  }

  async function saveExternalUrl(serviceId: string) {
    const url = extUrlDraft[serviceId] ?? "";
    setSaving((s) => new Set(s).add(serviceId));
    try {
      const enabled = enabledById?.[serviceId] ?? DEFAULT_ENABLED;
      await setServiceSettings([
        { service_id: serviceId, enabled, external_url: url },
      ]);
      setExtUrlSaved((cur) => ({ ...cur, [serviceId]: url }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving((s) => {
        const n = new Set(s);
        n.delete(serviceId);
        return n;
      });
    }
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter((a) =>
      `${a.name} ${a.blurb} ${a.id}`.toLowerCase().includes(q),
    );
  }, [query]);

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
          <Typography level="h4">Services</Typography>
          <Typography level="body-sm" sx={{ opacity: 0.7 }}>
            Turn services on or off for everyone in your organization.
          </Typography>
        </Box>
        <Input
          size="sm"
          startDecorator={<SearchIcon />}
          placeholder="Search services"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{
            width: { xs: "100%", sm: 240 },
            order: { xs: 10, sm: "unset" },
          }}
        />
      </Box>

      {error && (
        <Alert color="danger" variant="soft" sx={{ mb: 2 }}>
          Couldn’t save changes: {error}
        </Alert>
      )}

      {enabledById === null && !error && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {enabledById !== null && (
        <Sheet
          variant="outlined"
          sx={{ borderRadius: "md", overflow: "hidden" }}
        >
          {shown.map((a, i) => {
            const Icon = iconFor(a);
            const on = enabledById[a.id] ?? DEFAULT_ENABLED;
            const busy = saving.has(a.id);
            const draftUrl = extUrlDraft[a.id] ?? "";
            const savedUrl = extUrlSaved[a.id] ?? "";
            const urlDirty = draftUrl !== savedUrl;
            return (
              <Box
                key={a.id}
                data-testid={`admin-service-${a.id}`}
                sx={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 1.5,
                  px: 2,
                  py: 1.5,
                  borderTop: i === 0 ? "none" : "1px solid",
                  borderColor: "divider",
                  flexWrap: "wrap",
                }}
              >
                <Avatar
                  sx={{
                    bgcolor: a.accentColor,
                    color: "#fff",
                    "--Avatar-size": "40px",
                    mt: 0.5,
                    flexShrink: 0,
                  }}
                >
                  {Icon ? <Icon /> : a.name.charAt(0)}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 200 }}>
                  <Typography level="body-sm" sx={{ fontWeight: 500 }} noWrap>
                    {a.name}
                  </Typography>
                  <Typography level="body-xs" sx={{ opacity: 0.7 }} noWrap>
                    {a.blurb}
                  </Typography>
                  {/* External URL override field */}
                  <Box
                    sx={{
                      display: "flex",
                      gap: 0.75,
                      mt: 0.75,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                    component="form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveExternalUrl(a.id);
                    }}
                  >
                    <Typography
                      level="body-xs"
                      sx={{ opacity: 0.7, whiteSpace: "nowrap" }}
                    >
                      use external service instead
                    </Typography>
                    <Input
                      size="sm"
                      value={draftUrl}
                      onChange={(e) =>
                        setExtUrlDraft((cur) => ({
                          ...cur,
                          [a.id]: e.target.value,
                        }))
                      }
                      placeholder={externalUrlExample(a.id)}
                      type="url"
                      disabled={busy}
                      sx={{
                        flex: 1,
                        minWidth: 220,
                        maxWidth: 360,
                        fontSize: "xs",
                      }}
                      slotProps={{
                        input: { "aria-label": `External URL for ${a.name}` },
                      }}
                      data-testid={`admin-service-exturl-${a.id}`}
                    />
                    {urlDirty && (
                      <Button
                        size="sm"
                        variant="soft"
                        type="submit"
                        loading={busy}
                        data-testid={`admin-service-exturl-save-${a.id}`}
                      >
                        Save URL
                      </Button>
                    )}
                    {!urlDirty && draftUrl && (
                      <Button
                        size="sm"
                        variant="plain"
                        color="neutral"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setExtUrlDraft((cur) => ({ ...cur, [a.id]: "" }));
                          void setServiceSettings([
                            { service_id: a.id, enabled: on, external_url: "" },
                          ])
                            .then(() =>
                              setExtUrlSaved((cur) => ({ ...cur, [a.id]: "" })),
                            )
                            .catch((e: Error) => setError(e.message));
                        }}
                        data-testid={`admin-service-exturl-clear-${a.id}`}
                      >
                        Clear
                      </Button>
                    )}
                  </Box>
                </Box>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    pt: 0.5,
                    flexShrink: 0,
                  }}
                >
                  <Chip
                    size="sm"
                    variant="soft"
                    color={on ? "success" : "neutral"}
                  >
                    {on ? "On" : "Off"}
                  </Chip>
                  <Switch
                    checked={on}
                    disabled={busy}
                    onChange={(e) => toggle(a.id, e.target.checked)}
                    slotProps={{ input: { "aria-label": `Toggle ${a.name}` } }}
                  />
                </Box>
              </Box>
            );
          })}
          {shown.length === 0 && (
            <Box sx={{ p: 4, textAlign: "center" }}>
              <Typography level="body-sm" sx={{ opacity: 0.6 }}>
                No matching services.
              </Typography>
            </Box>
          )}
        </Sheet>
      )}

      <Divider sx={{ my: 2 }} />
      <Typography level="body-xs" sx={{ opacity: 0.6 }}>
        Disabled services are hidden from members on their dashboard. Set an
        external URL to open a tile in a new tab.
      </Typography>
    </>
  );
}

// ---------------------------------------------------------------------------
// Users — Zitadel-backed user management.
// ---------------------------------------------------------------------------
function UsersSection() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Distinguished from a generic error so we can render a tailored empty state.
  const [needsToken, setNeedsToken] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Super-admin (GROWN_ADMIN_EMAILS) gate for the destructive Zitadel hard-delete.
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    let alive = true;
    adminWhoAmI()
      .then((w) => {
        if (alive) setIsSuperAdmin(w.isSuperAdmin);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const load = useCallback(async (q: string) => {
    setError(null);
    setNeedsToken(false);
    setForbidden(false);
    try {
      const list = await listUsers(q);
      setUsers(list);
    } catch (e) {
      setUsers([]);
      if (e instanceof ServiceTokenMissingError) setNeedsToken(true);
      else if (e instanceof ForbiddenError) setForbidden(true);
      else setError((e as Error).message);
    }
  }, []);

  // Initial load + debounced search.
  useEffect(() => {
    const t = setTimeout(
      () => {
        void load(query);
      },
      query ? 300 : 0,
    );
    return () => clearTimeout(t);
  }, [query, load]);

  // Wrap a row action with busy-state + reload, surfacing failures inline.
  const act = useCallback(
    async (id: string, fn: () => Promise<void>) => {
      setBusyId(id);
      setError(null);
      try {
        await fn();
        await load(query);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusyId(null);
      }
    },
    [load, query],
  );

  async function onDeactivate(u: AdminUser) {
    await act(u.id, () =>
      isActive(u.state) ? deactivateUser(u.id) : reactivateUser(u.id),
    );
  }
  async function onResetPassword(u: AdminUser) {
    await act(u.id, async () => {
      const code = await setPassword(u.id, "");
      setNotice(
        code
          ? `Password reset for ${userLabel(u)}. Verification code: ${code}`
          : `Password reset triggered for ${userLabel(u)}.`,
      );
    });
  }
  async function onRemoveFromOrg(u: AdminUser) {
    if (
      !window.confirm(
        `Remove ${userLabel(u)} from this organization?\n\n` +
          `They’ll lose access here but keep their account and sign-in. This does not delete their Zitadel account.`,
      )
    )
      return;
    await act(u.id, async () => {
      await removeFromOrg(u.id);
      setNotice(`Removed ${userLabel(u)} from the organization.`);
    });
  }
  async function onHardDelete(u: AdminUser) {
    if (
      !window.confirm(
        `PERMANENTLY delete ${userLabel(u)} from Zitadel?\n\n` +
          `This destroys their identity account across the entire system and cannot be undone. ` +
          `Type-check: this affects EVERY org, not just this one.`,
      )
    )
      return;
    await act(u.id, async () => {
      await hardDeleteUser(u.id);
      setNotice(`Deleted ${userLabel(u)} from Zitadel.`);
    });
  }
  async function onToggleAdmin(u: AdminUser, next: boolean) {
    if (!next && !window.confirm(`Remove admin access from ${userLabel(u)}?`))
      return;
    setBusyId(u.id);
    setError(null);
    try {
      await setAdmin(u.id, next);
      await load(query);
      setNotice(
        next
          ? `${userLabel(u)} is now an admin.`
          : `Removed admin access from ${userLabel(u)}.`,
      );
    } catch (e) {
      if (e instanceof LastAdminError) {
        setError("You can't remove the last admin of the organization.");
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusyId(null);
    }
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
          <Typography level="h4">Users</Typography>
          <Typography level="body-sm" sx={{ opacity: 0.7 }}>
            Manage the people in your organization’s directory.
          </Typography>
        </Box>
        <Input
          size="sm"
          startDecorator={<SearchIcon />}
          placeholder="Search users"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{
            width: { xs: "100%", sm: 220 },
            order: { xs: 10, sm: "unset" },
          }}
        />
        <Button
          size="sm"
          startDecorator={<PersonAddIcon />}
          onClick={() => setCreateOpen(true)}
          disabled={needsToken || forbidden}
          data-testid="admin-create-user"
        >
          Create user
        </Button>
      </Box>

      {notice && (
        <Alert
          color="success"
          variant="soft"
          sx={{ mb: 2 }}
          endDecorator={
            <IconButton
              size="sm"
              variant="plain"
              onClick={() => setNotice(null)}
            >
              <Icons.Close />
            </IconButton>
          }
        >
          {notice}
        </Alert>
      )}
      {error && (
        <Alert color="danger" variant="soft" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {needsToken && (
        <Sheet
          variant="soft"
          color="warning"
          sx={{ p: 3, borderRadius: "md", textAlign: "center" }}
        >
          <Typography level="title-md" sx={{ mb: 0.5 }}>
            User management is unavailable
          </Typography>
          <Typography level="body-sm">
            Set <code>GROWN_ZITADEL_SERVICE_TOKEN</code> on the server to manage
            users in Zitadel.
          </Typography>
        </Sheet>
      )}

      {forbidden && (
        <Sheet
          variant="soft"
          color="neutral"
          sx={{ p: 3, borderRadius: "md", textAlign: "center" }}
        >
          <Typography level="title-md" sx={{ mb: 0.5 }}>
            Admin access required
          </Typography>
          <Typography level="body-sm">
            Your account isn’t in the admin allowlist (
            <code>GROWN_ADMIN_EMAILS</code>).
          </Typography>
        </Sheet>
      )}

      {!needsToken && !forbidden && users === null && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {!needsToken && !forbidden && users !== null && (
        <Sheet
          variant="outlined"
          sx={{ borderRadius: "md", overflow: "hidden", overflowX: "auto" }}
        >
          <Table
            hoverRow
            sx={{
              "--TableCell-paddingX": { xs: "8px", sm: "16px" },
              minWidth: 480,
            }}
          >
            <thead>
              <tr>
                <th style={{ width: "36%" }}>Name</th>
                <th>Email</th>
                <th style={{ width: 110 }}>Status</th>
                <th style={{ width: 120 }}>Admin</th>
                <th style={{ width: 48 }} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const active = isActive(u.state);
                const label = userLabel(u);
                return (
                  <tr key={u.id} data-testid={`admin-user-${u.id}`}>
                    <td>
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1.25,
                        }}
                      >
                        <Avatar size="sm">
                          {(label || "?").charAt(0).toUpperCase()}
                        </Avatar>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography
                            level="body-sm"
                            sx={{ fontWeight: 500 }}
                            noWrap
                          >
                            {label}
                          </Typography>
                          {u.username && u.username !== u.email && (
                            <Typography
                              level="body-xs"
                              sx={{ opacity: 0.6 }}
                              noWrap
                            >
                              {u.username}
                            </Typography>
                          )}
                        </Box>
                      </Box>
                    </td>
                    <td>
                      <Typography level="body-sm" noWrap>
                        {u.email}
                      </Typography>
                      {!u.emailVerified && (
                        <Chip size="sm" variant="soft" color="warning">
                          Unverified
                        </Chip>
                      )}
                    </td>
                    <td>
                      <Chip
                        size="sm"
                        variant="soft"
                        color={active ? "success" : "neutral"}
                      >
                        {active ? "Active" : "Inactive"}
                      </Chip>
                    </td>
                    <td>
                      <Box
                        sx={{ display: "flex", alignItems: "center", gap: 1 }}
                      >
                        <Switch
                          size="sm"
                          checked={u.isAdmin}
                          disabled={busyId === u.id}
                          onChange={(e) => onToggleAdmin(u, e.target.checked)}
                          slotProps={{
                            input: {
                              "aria-label": `Toggle admin for ${label}`,
                            },
                          }}
                          data-testid={`admin-toggle-${u.id}`}
                        />
                        {u.isAdmin && (
                          <Chip
                            size="sm"
                            variant="soft"
                            color="primary"
                            startDecorator={
                              <Icons.Shield sx={{ fontSize: 14 }} />
                            }
                          >
                            Admin
                          </Chip>
                        )}
                      </Box>
                    </td>
                    <td>
                      <Dropdown>
                        <MenuButton
                          slots={{ root: IconButton }}
                          slotProps={{
                            root: {
                              size: "sm",
                              variant: "plain",
                              color: "neutral",
                              loading: busyId === u.id,
                            },
                          }}
                          data-testid={`admin-user-menu-${u.id}`}
                        >
                          <MoreVertIcon />
                        </MenuButton>
                        <Menu placement="bottom-end" size="sm">
                          <MenuItem onClick={() => setEditing(u)}>
                            <ListItemDecorator>
                              <Icons.Edit />
                            </ListItemDecorator>{" "}
                            Edit
                          </MenuItem>
                          <MenuItem onClick={() => onDeactivate(u)}>
                            <ListItemDecorator>
                              {active ? <Icons.Block /> : <Icons.CheckCircle />}
                            </ListItemDecorator>
                            {active ? "Deactivate" : "Reactivate"}
                          </MenuItem>
                          <MenuItem onClick={() => onResetPassword(u)}>
                            <ListItemDecorator>
                              <Icons.Password />
                            </ListItemDecorator>{" "}
                            Reset password
                          </MenuItem>
                          <Divider />
                          <MenuItem
                            color="danger"
                            onClick={() => onRemoveFromOrg(u)}
                          >
                            <ListItemDecorator>
                              <Icons.PersonRemove />
                            </ListItemDecorator>{" "}
                            Remove from org
                          </MenuItem>
                          {isSuperAdmin && (
                            <MenuItem
                              color="danger"
                              onClick={() => onHardDelete(u)}
                            >
                              <ListItemDecorator>
                                <Icons.DeleteForever />
                              </ListItemDecorator>{" "}
                              Delete from Zitadel…
                            </MenuItem>
                          )}
                        </Menu>
                      </Dropdown>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          {users.length === 0 && (
            <Box sx={{ p: 4, textAlign: "center" }}>
              <Typography level="body-sm" sx={{ opacity: 0.6 }}>
                {query
                  ? "No users match your search."
                  : "No users yet. Create the first one."}
              </Typography>
            </Box>
          )}
        </Sheet>
      )}

      {createOpen && (
        <UserFormDialog
          mode="create"
          onClose={() => setCreateOpen(false)}
          onSaved={async () => {
            setCreateOpen(false);
            await load(query);
          }}
        />
      )}
      {editing && (
        <UserFormDialog
          mode="edit"
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load(query);
          }}
        />
      )}
    </>
  );
}

// Shared create/edit dialog. In "create" mode it collects name/email and an
// optional password or send-invite; in "edit" mode it patches profile/email.
function UserFormDialog(props: {
  mode: "create" | "edit";
  user?: AdminUser;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { mode, user } = props;
  const [givenName, setGivenName] = useState(user?.givenName ?? "");
  const [familyName, setFamilyName] = useState(user?.familyName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPwd] = useState("");
  const [sendInvite, setSendInvite] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      if (mode === "create") {
        const input: CreateUserInput = {
          givenName,
          familyName,
          email,
          ...(password ? { password } : {}),
          sendInvite: !password && sendInvite,
        };
        await createUser(input);
      } else if (user) {
        await updateUser(user.id, { givenName, familyName, email });
      }
      await props.onSaved();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={props.onClose}>
      <ModalDialog
        sx={{
          width: { xs: "100vw", sm: 420 },
          maxWidth: "100vw",
          borderRadius: { xs: 0, sm: "md" },
        }}
      >
        <ModalClose />
        <Typography level="title-lg">
          {mode === "create" ? "Create user" : "Edit user"}
        </Typography>
        {error && (
          <Alert color="danger" variant="soft" sx={{ mt: 1 }}>
            {error}
          </Alert>
        )}
        <Box
          sx={{ display: "flex", flexDirection: "column", gap: 1.5, mt: 1.5 }}
        >
          <Box
            sx={{
              display: "flex",
              gap: 1.5,
              flexDirection: { xs: "column", sm: "row" },
            }}
          >
            <FormControl sx={{ flex: 1 }}>
              <FormLabel>First name</FormLabel>
              <Input
                value={givenName}
                onChange={(e) => setGivenName(e.target.value)}
                autoFocus
              />
            </FormControl>
            <FormControl sx={{ flex: 1 }}>
              <FormLabel>Last name</FormLabel>
              <Input
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
              />
            </FormControl>
          </Box>
          <FormControl>
            <FormLabel>Email</FormLabel>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormControl>

          {mode === "create" && (
            <>
              <FormControl>
                <FormLabel>Initial password (optional)</FormLabel>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPwd(e.target.value)}
                  placeholder="Leave blank to invite"
                />
                <FormHelperText>
                  If set, the user must change it on first sign-in.
                </FormHelperText>
              </FormControl>
              <Checkbox
                label="Send an invite email (leave password blank)"
                checked={!password && sendInvite}
                disabled={!!password}
                onChange={(e) => setSendInvite(e.target.checked)}
              />
            </>
          )}
        </Box>

        <Box
          sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 2.5 }}
        >
          <Button
            variant="plain"
            color="neutral"
            onClick={props.onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={submit} loading={saving} disabled={!email.trim()}>
            {mode === "create" ? "Create" : "Save"}
          </Button>
        </Box>
      </ModalDialog>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Org settings — the org identity plus a branding placeholder.
// ---------------------------------------------------------------------------
function OrgSettingsSection({
  user,
  onGoToApps,
}: {
  user: User;
  onGoToApps: () => void;
}) {
  // The page receives only the User (with org_id); fetch the org identity via
  // whoami so we can show its name/slug. Falls back to the org_id while loading
  // or if the call fails.
  const [org, setOrg] = useState<Org | null>(null);
  useEffect(() => {
    let cancelled = false;
    whoami().then((r) => {
      if (!cancelled && r.status === "ok") setOrg(r.data.org);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const orgName =
    org?.display_name || org?.slug || user.org_id || "Your organization";
  const orgSlug = org?.slug ?? "";

  return (
    <>
      <Box sx={{ mb: 2 }}>
        <Typography level="h4">Org settings</Typography>
        <Typography level="body-sm" sx={{ opacity: 0.7 }}>
          Your organization’s identity and preferences.
        </Typography>
      </Box>

      <OrgNameForm
        orgName={orgName}
        orgSlug={orgSlug}
        onRenamed={(name) =>
          setOrg((o) => (o ? { ...o, display_name: name } : o))
        }
      />

      <BrandingForm />

      <Sheet variant="soft" sx={{ borderRadius: "md", p: 2.5 }}>
        <Typography level="title-sm" sx={{ mb: 0.5 }}>
          Services
        </Typography>
        <Typography level="body-sm" sx={{ opacity: 0.7, mb: 1.5 }}>
          Control which services are available to members.
        </Typography>
        <Link component="button" onClick={onGoToApps} level="body-sm">
          Manage services →
        </Link>
      </Sheet>
    </>
  );
}

// OrgNameForm renders the org identity card with an editable display name. The
// slug stays read-only (it is stable server-side).
function OrgNameForm({
  orgName,
  orgSlug,
  onRenamed,
}: {
  orgName: string;
  orgSlug: string;
  onRenamed: (name: string) => void;
}) {
  const [value, setValue] = useState(orgName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Keep the input in sync once whoami resolves the real name.
  useEffect(() => {
    setValue(orgName);
  }, [orgName]);

  const dirty = value.trim() !== "" && value.trim() !== orgName;

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await renameOrg(value.trim());
      onRenamed(updated.display_name);
      setSaved(true);
    } catch (e) {
      setError(
        e instanceof OrgForbiddenError
          ? "You need admin privileges to rename the org."
          : (e as Error).message,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet variant="outlined" sx={{ borderRadius: "md", p: 2.5, mb: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
        <Avatar
          sx={{
            "--Avatar-size": "56px",
            bgcolor: "primary.500",
            color: "#fff",
          }}
        >
          {(value || orgName).charAt(0).toUpperCase()}
        </Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography level="title-md">{orgName}</Typography>
          {orgSlug && (
            <Typography level="body-sm" sx={{ opacity: 0.7 }}>
              Slug: <code>{orgSlug}</code>
            </Typography>
          )}
        </Box>
      </Box>

      {error && (
        <Alert color="danger" variant="soft" sx={{ mb: 1.5 }}>
          {error}
        </Alert>
      )}
      {saved && !error && (
        <Alert color="success" variant="soft" sx={{ mb: 1.5 }}>
          Organization name updated.
        </Alert>
      )}

      <FormControl>
        <FormLabel>Organization name</FormLabel>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(false);
            }}
            sx={{ flex: 1, minWidth: 200 }}
            data-testid="org-name-input"
          />
          <Button
            onClick={save}
            loading={saving}
            disabled={!dirty}
            data-testid="org-name-save"
          >
            Save
          </Button>
        </Box>
        <FormHelperText>
          Shown to members across the workspace. The slug stays the same.
        </FormHelperText>
      </FormControl>
    </Sheet>
  );
}

// BrandingForm wires the formerly-disabled "Customize branding" placeholder into
// a real accent-color picker + logo upload. Changes apply for everyone in the
// org on their next load (BrandProvider fetches /api/v1/org/branding at start).
function BrandingForm() {
  const [accent, setAccent] = useState("");
  const [pname, setPname] = useState("");
  const [hasLogo, setHasLogo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Cache-buster so the preview refreshes after an upload/clear.
  const [logoVersion, setLogoVersion] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const b = await getAdminBranding();
      setAccent(b.accent_color || "");
      setPname(b.product_name || "");
      setHasLogo(b.has_logo);
    } catch (e) {
      setError(
        e instanceof OrgForbiddenError
          ? "You need admin privileges to manage branding."
          : (e as Error).message,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveAccent() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await setAccentColor(accent);
      setNotice("Accent color saved. Members see it on next load.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveName() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await setProductName(pname.trim());
      setNotice("Product name saved. Members see it on next load.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onLogoFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const b = await uploadLogo(file);
      setHasLogo(b.has_logo);
      setLogoVersion((v) => v + 1);
      setNotice("Logo uploaded.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onClearLogo() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await clearLogo();
      setHasLogo(false);
      setLogoVersion((v) => v + 1);
      setNotice("Logo removed.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet variant="outlined" sx={{ borderRadius: "md", p: 2.5, mb: 2 }}>
      <Typography level="title-sm" sx={{ mb: 0.5 }}>
        Branding
      </Typography>
      <Typography level="body-sm" sx={{ opacity: 0.7, mb: 1.5 }}>
        Logo and accent color for your workspace. Applied for all members.
      </Typography>

      {error && (
        <Alert color="danger" variant="soft" sx={{ mb: 1.5 }}>
          {error}
        </Alert>
      )}
      {notice && !error && (
        <Alert color="success" variant="soft" sx={{ mb: 1.5 }}>
          {notice}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
          <CircularProgress size="sm" />
        </Box>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {/* Product name (the top-left brand label; blank ⇒ default "Grown") */}
          <Box
            sx={{
              display: "flex",
              alignItems: "flex-end",
              gap: 1,
              flexWrap: "wrap",
            }}
          >
            <FormControl sx={{ flex: 1, minWidth: 180 }}>
              <FormLabel>Product name</FormLabel>
              <Input
                value={pname}
                onChange={(e) => setPname(e.target.value)}
                placeholder="Grown"
                slotProps={{ input: { maxLength: 40 } }}
                data-testid="branding-name"
              />
            </FormControl>
            <Button
              size="sm"
              onClick={saveName}
              loading={busy}
              data-testid="branding-name-save"
            >
              Save name
            </Button>
          </Box>
          {/* Logo */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              flexWrap: "wrap",
            }}
          >
            <Box
              sx={{
                width: 56,
                height: 56,
                borderRadius: "md",
                border: "1px solid",
                borderColor: "divider",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                bgcolor: "background.level1",
              }}
            >
              {hasLogo ? (
                <img
                  src={`/api/v1/org/branding/logo?t=${logoVersion}`}
                  alt="Org logo"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                  }}
                />
              ) : (
                <Icons.Image sx={{ opacity: 0.4 }} />
              )}
            </Box>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              <Button
                size="sm"
                variant="outlined"
                component="label"
                loading={busy}
                startDecorator={<Icons.UploadFile />}
                data-testid="branding-upload"
              >
                {hasLogo ? "Replace logo" : "Upload logo"}
                <input
                  type="file"
                  hidden
                  accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                  onChange={(e) => {
                    void onLogoFile(e.target.files?.[0] ?? null);
                    e.target.value = "";
                  }}
                />
              </Button>
              {hasLogo && (
                <Button
                  size="sm"
                  variant="plain"
                  color="danger"
                  onClick={onClearLogo}
                  disabled={busy}
                >
                  Remove
                </Button>
              )}
            </Box>
          </Box>

          {/* Accent color */}
          <FormControl>
            <FormLabel>Accent color</FormLabel>
            <Box
              sx={{
                display: "flex",
                gap: 1,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <input
                type="color"
                value={accent || "#3F704D"}
                onChange={(e) => setAccent(e.target.value)}
                aria-label="Accent color picker"
                style={{
                  width: 44,
                  height: 36,
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                }}
                data-testid="branding-color"
              />
              <Input
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                placeholder="#3F704D"
                sx={{ width: 140 }}
              />
              <Button
                size="sm"
                onClick={saveAccent}
                loading={busy}
                data-testid="branding-save-color"
              >
                Save color
              </Button>
              {accent && (
                <Button
                  size="sm"
                  variant="plain"
                  color="neutral"
                  onClick={() => {
                    setAccent("");
                  }}
                  disabled={busy}
                >
                  Reset
                </Button>
              )}
            </Box>
            <FormHelperText>
              A hex color like <code>#3F704D</code>. Leave blank for the
              default.
            </FormHelperText>
          </FormControl>
        </Box>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Sessions & logins — a Google-Admin-style view of every login in the org with
// user, time, last-seen, IP, device/agent, active state, and a Revoke action.
// Fed by GET /api/v1/admin/sessions; admin-gated server-side.
// ---------------------------------------------------------------------------
function shortAgent(ua: string): string {
  if (!ua) return "—";
  // Best-effort browser/OS extraction for a compact display; full UA on hover.
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Mac OS X|Macintosh/.test(ua)
      ? "macOS"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad|iOS/.test(ua)
          ? "iOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} · ${os}` : browser;
}

function SessionsSection() {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Show revoked sessions too (off by default — admins usually want active ones).
  const [showRevoked, setShowRevoked] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      setRows(await listOrgSessions());
    } catch (e) {
      if (e instanceof OrgForbiddenError) {
        setForbidden(true);
        setRows(null);
      } else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRevoke(s: SessionRow) {
    if (
      !window.confirm(
        `Revoke ${s.email || "this"} session${s.current ? " (your current session — you'll be signed out)" : ""}?`,
      )
    )
      return;
    setBusyId(s.id);
    setError(null);
    try {
      await revokeOrgSession(s.id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const shown = useMemo(
    () => (rows ?? []).filter((s) => showRevoked || !s.revoked),
    [rows, showRevoked],
  );

  if (forbidden) {
    return (
      <>
        <Typography level="h4" sx={{ mb: 1 }}>
          Sessions &amp; logins
        </Typography>
        <Alert color="warning" variant="soft">
          You need admin privileges to view sessions. Ask an org admin to add
          your email to <code>GROWN_ADMIN_EMAILS</code>.
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
          <Typography level="h4">Sessions &amp; logins</Typography>
          <Typography level="body-sm" sx={{ opacity: 0.7 }}>
            Active logins across your organization. Revoke to sign a device out.
          </Typography>
        </Box>
        <Checkbox
          size="sm"
          label="Show revoked"
          checked={showRevoked}
          onChange={(e) => setShowRevoked(e.target.checked)}
        />
        <Button
          size="sm"
          variant="soft"
          startDecorator={<RefreshIcon />}
          onClick={() => void load()}
          loading={loading}
        >
          Refresh
        </Button>
      </Box>

      {error && (
        <Alert color="danger" variant="soft" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading && !rows && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {rows && shown.length === 0 && !loading && (
        <Sheet
          variant="soft"
          sx={{ borderRadius: "md", p: 3, textAlign: "center" }}
        >
          <Typography level="body-sm" sx={{ opacity: 0.7 }}>
            No sessions to show.
          </Typography>
        </Sheet>
      )}

      {rows && shown.length > 0 && (
        <Sheet
          variant="outlined"
          sx={{ borderRadius: "md", overflowX: "auto" }}
        >
          <Table
            size="sm"
            stickyHeader
            hoverRow
            sx={{ minWidth: 760, "--TableCell-paddingX": "10px" }}
          >
            <thead>
              <tr>
                <th style={{ width: 200 }}>User</th>
                <th style={{ width: 150 }}>Signed in</th>
                <th style={{ width: 150 }}>Last seen</th>
                <th style={{ width: 130 }}>IP</th>
                <th>Device</th>
                <th style={{ width: 100 }}>Status</th>
                <th style={{ width: 90 }} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id} data-testid={`session-${s.id}`}>
                  <td>
                    <Typography
                      level="body-xs"
                      sx={{ fontWeight: 500, wordBreak: "break-all" }}
                    >
                      {s.email || s.display_name || s.user_id}
                    </Typography>
                    {s.current && (
                      <Chip size="sm" variant="soft" color="primary">
                        This device
                      </Chip>
                    )}
                  </td>
                  <td>
                    <Typography level="body-xs" sx={{ whiteSpace: "nowrap" }}>
                      {fmtTime(s.created_at)}
                    </Typography>
                  </td>
                  <td>
                    <Typography level="body-xs" sx={{ whiteSpace: "nowrap" }}>
                      {s.last_seen_at ? fmtTime(s.last_seen_at) : "—"}
                    </Typography>
                  </td>
                  <td>
                    <Typography level="body-xs">{s.ip || "—"}</Typography>
                  </td>
                  <td>
                    <Typography level="body-xs" title={s.user_agent}>
                      {shortAgent(s.user_agent)}
                    </Typography>
                  </td>
                  <td>
                    <Chip
                      size="sm"
                      variant="soft"
                      color={
                        s.revoked ? "neutral" : s.active ? "success" : "warning"
                      }
                    >
                      {s.revoked ? "Revoked" : s.active ? "Active" : "Expired"}
                    </Chip>
                  </td>
                  <td>
                    {!s.revoked && (
                      <Button
                        size="sm"
                        variant="plain"
                        color="danger"
                        loading={busyId === s.id}
                        onClick={() => onRevoke(s)}
                        data-testid={`session-revoke-${s.id}`}
                      >
                        Revoke
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Sheet>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Audit log — a filterable, refreshable table of cross-cutting activity across
// every built-in service (uploads/downloads/edits/deletes/shares/creates…),
// fed by GET /api/v1/admin/audit. Org-scoped and admin-gated server-side.
// ---------------------------------------------------------------------------
function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function AuditSection() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  // Applied filters (drive the fetch). The inputs below are controlled locally
  // and committed on submit/refresh so we don't fire a request per keystroke.
  const [serviceFilter, setServiceFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");

  const load = useCallback(async (service: string, actor: string) => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const rows = await listAuditEvents({ service, actor, limit: 200 });
      setEvents(rows);
    } catch (e) {
      if (e instanceof AuditForbiddenError) {
        setForbidden(true);
        setEvents(null);
      } else {
        setError((e as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load("", "");
  }, [load]);

  function applyFilters(e?: React.FormEvent) {
    e?.preventDefault();
    void load(serviceFilter, actorFilter);
  }

  // Distinct service slugs seen in the current page, to populate the dropdown.
  const services = useMemo(() => {
    const s = new Set<string>();
    for (const ev of events ?? []) if (ev.service) s.add(ev.service);
    return Array.from(s).sort();
  }, [events]);

  if (forbidden) {
    return (
      <>
        <Typography level="h4" sx={{ mb: 1 }}>
          Audit log
        </Typography>
        <Alert color="warning" variant="soft">
          You need admin privileges to view the audit log. Ask an org admin to
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
          <Typography level="h4">Audit log</Typography>
          <Typography level="body-sm" sx={{ opacity: 0.7 }}>
            Recent activity across every service in your organization.
          </Typography>
        </Box>
      </Box>

      <Box
        component="form"
        onSubmit={applyFilters}
        sx={{
          display: "flex",
          gap: 1,
          mb: 2,
          flexWrap: "wrap",
          alignItems: "flex-end",
        }}
      >
        <FormControl size="sm">
          <FormLabel>Service</FormLabel>
          <Input
            size="sm"
            placeholder="e.g. video"
            value={serviceFilter}
            onChange={(e) => setServiceFilter(e.target.value)}
            slotProps={{ input: { list: "audit-services" } }}
            sx={{ width: { xs: "100%", sm: 160 } }}
          />
          <datalist id="audit-services">
            {services.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </FormControl>
        <FormControl size="sm">
          <FormLabel>Actor email</FormLabel>
          <Input
            size="sm"
            placeholder="user@example.com"
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            sx={{ width: { xs: "100%", sm: 220 } }}
          />
        </FormControl>
        <Button type="submit" size="sm" variant="solid" loading={loading}>
          Apply
        </Button>
        <Button
          type="button"
          size="sm"
          variant="soft"
          startDecorator={<RefreshIcon />}
          onClick={() => {
            setServiceFilter("");
            setActorFilter("");
            void load("", "");
          }}
        >
          Refresh
        </Button>
      </Box>

      {error && (
        <Alert color="danger" variant="soft" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading && !events && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {events && events.length === 0 && !loading && (
        <Sheet
          variant="soft"
          sx={{ borderRadius: "md", p: 3, textAlign: "center" }}
        >
          <Typography level="body-sm" sx={{ opacity: 0.7 }}>
            No audit events match these filters yet.
          </Typography>
        </Sheet>
      )}

      {events && events.length > 0 && (
        <Sheet
          variant="outlined"
          sx={{ borderRadius: "md", overflowX: "auto" }}
        >
          <Table
            size="sm"
            stickyHeader
            hoverRow
            sx={{ minWidth: 720, "--TableCell-paddingX": "10px" }}
          >
            <thead>
              <tr>
                <th style={{ width: 170 }}>Time</th>
                <th style={{ width: 200 }}>Actor</th>
                <th style={{ width: 110 }}>Service</th>
                <th style={{ width: 110 }}>Action</th>
                <th>Resource</th>
                <th style={{ width: 90 }}>Status</th>
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
                    <Typography level="body-xs" sx={{ wordBreak: "break-all" }}>
                      {ev.actor_email || "—"}
                    </Typography>
                  </td>
                  <td>
                    <Chip size="sm" variant="soft">
                      {ev.service || "—"}
                    </Chip>
                  </td>
                  <td>
                    <Typography level="body-xs">{ev.action || "—"}</Typography>
                  </td>
                  <td>
                    <Typography
                      level="body-xs"
                      sx={{ wordBreak: "break-all", opacity: 0.85 }}
                    >
                      {ev.resource_id
                        ? `${ev.resource_type || ""}${ev.resource_type ? " " : ""}${ev.resource_id}`
                        : ev.resource_type || "—"}
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
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Analytics — org-wide usage statistics (object counts, storage, user activity).
// Mirrors the Google Admin Reports view. Fetches GET /api/v1/admin/analytics.
// ---------------------------------------------------------------------------

/** StatCard renders a single metric with an optional "new in last 7 days" badge. */
function StatCard({
  label,
  value,
  new7d,
  unit,
}: {
  label: string;
  value: number | string;
  new7d?: number;
  unit?: string;
}) {
  return (
    <Sheet
      variant="outlined"
      sx={{
        borderRadius: "md",
        p: 2,
        display: "flex",
        flexDirection: "column",
        gap: 0.5,
        minWidth: 140,
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
        {unit && (
          <Typography
            component="span"
            level="body-sm"
            sx={{ ml: 0.5, opacity: 0.7 }}
          >
            {unit}
          </Typography>
        )}
      </Typography>
      {new7d !== undefined && new7d > 0 && (
        <Chip size="sm" variant="soft" color="success">
          +{new7d.toLocaleString()} this week
        </Chip>
      )}
    </Sheet>
  );
}

/** MiniBar renders a simple horizontal bar proportion (value / max). */
function MiniBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.25 }}>
        <Typography level="body-xs">{label}</Typography>
        <Typography level="body-xs" sx={{ opacity: 0.7 }}>
          {formatBytes(value)}
        </Typography>
      </Box>
      <Box
        sx={{
          height: 6,
          borderRadius: 4,
          bgcolor: "background.level2",
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            height: "100%",
            width: `${pct}%`,
            bgcolor: color,
            borderRadius: 4,
            transition: "width 0.4s",
          }}
        />
      </Box>
    </Box>
  );
}

function AnalyticsSection() {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      setData(await getAnalytics());
    } catch (e) {
      if (e instanceof AnalyticsForbiddenError) {
        setForbidden(true);
        setData(null);
      } else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (forbidden) {
    return (
      <>
        <Typography level="h4" sx={{ mb: 1 }}>
          Analytics
        </Typography>
        <Alert color="warning" variant="soft">
          You need admin privileges to view analytics. Ask an org admin to add
          your email to <code>GROWN_ADMIN_EMAILS</code>.
        </Alert>
      </>
    );
  }

  const apps = data?.apps;
  const maxStorage = data
    ? Math.max(
        data.storage.drive_bytes,
        data.storage.photo_bytes,
        data.storage.video_bytes,
        data.storage.music_bytes,
        data.storage.mail_attachment_bytes,
        1,
      )
    : 1;

  // App rows for the object count table: [label, total, new7d]
  const appRows: [string, number, number][] = apps
    ? [
        ["Drive files", apps.drive_files, apps.drive_files_new_7d],
        ["Docs", apps.docs, apps.docs_new_7d],
        ["Sheets", apps.sheets, apps.sheets_new_7d],
        ["Slides", apps.slides, apps.slides_new_7d],
        ["Whiteboards", apps.whiteboards, apps.whiteboards_new_7d],
        ["Keep notes", apps.keep_notes, apps.keep_notes_new_7d],
        ["Calendar events", apps.calendar_events, apps.calendar_events_new_7d],
        ["Contacts", apps.contacts, apps.contacts_new_7d],
        ["Mail messages", apps.mail_messages, apps.mail_messages_new_7d],
        ["Photos", apps.photos, apps.photos_new_7d],
        ["Videos", apps.videos, apps.videos_new_7d],
        ["Music tracks", apps.music_tracks, apps.music_tracks_new_7d],
        ["Books", apps.books, apps.books_new_7d],
        ["Sites", apps.sites, apps.sites_new_7d],
        ["Groups", apps.groups, apps.groups_new_7d],
        ["Project issues", apps.project_issues, apps.project_issues_new_7d],
        ["Forms", apps.forms, apps.forms_new_7d],
        ["Meet rooms", apps.meet_rooms, 0],
        ["Live streams", apps.live_streams, 0],
        ["Chat channels", apps.chat_channels, 0],
        ["Chat messages", apps.chat_messages, 0],
      ]
    : [];

  // Max total for bar chart scale
  const maxCount = appRows.length
    ? Math.max(...appRows.map(([, v]) => v), 1)
    : 1;

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
          <Typography level="h4">Analytics</Typography>
          <Typography level="body-sm" sx={{ opacity: 0.7 }}>
            Org-wide usage — object counts, storage, and member activity.
            {data && (
              <Typography
                component="span"
                level="body-xs"
                sx={{ ml: 1, opacity: 0.5 }}
              >
                Collected {new Date(data.collected_at).toLocaleString()}
              </Typography>
            )}
          </Typography>
        </Box>
        <Button
          size="sm"
          variant="soft"
          startDecorator={<RefreshIcon />}
          onClick={() => void load()}
          loading={loading}
        >
          Refresh
        </Button>
      </Box>

      {error && (
        <Alert color="danger" variant="soft" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading && !data && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {data && (
        <>
          {/* ---- Members ---- */}
          <Typography level="title-sm" sx={{ mb: 1.5 }}>
            Members
          </Typography>
          <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 3 }}>
            <StatCard label="Total members" value={data.users.total_members} />
            <StatCard label="Admins" value={data.users.total_admins} />
            <StatCard
              label="Active (7 days)"
              value={data.users.active_last_7_days}
            />
            <StatCard
              label="Active (30 days)"
              value={data.users.active_last_30_days}
            />
          </Box>

          {/* ---- Storage ---- */}
          <Typography level="title-sm" sx={{ mb: 1.5 }}>
            Storage
          </Typography>
          <Sheet variant="outlined" sx={{ borderRadius: "md", p: 2.5, mb: 3 }}>
            <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 2 }}>
              <StatCard
                label="Total storage"
                value={formatBytes(data.storage.total_bytes)}
              />
              <StatCard
                label="Drive"
                value={formatBytes(data.storage.drive_bytes)}
              />
              <StatCard
                label="Photos"
                value={formatBytes(data.storage.photo_bytes)}
              />
              <StatCard
                label="Video"
                value={formatBytes(data.storage.video_bytes)}
              />
              <StatCard
                label="Music"
                value={formatBytes(data.storage.music_bytes)}
              />
              <StatCard
                label="Mail attachments"
                value={formatBytes(data.storage.mail_attachment_bytes)}
              />
            </Box>
            <Box sx={{ maxWidth: 480 }}>
              <MiniBar
                label="Drive"
                value={data.storage.drive_bytes}
                max={maxStorage}
                color="var(--joy-palette-primary-500)"
              />
              <MiniBar
                label="Photos"
                value={data.storage.photo_bytes}
                max={maxStorage}
                color="var(--joy-palette-warning-500)"
              />
              <MiniBar
                label="Video"
                value={data.storage.video_bytes}
                max={maxStorage}
                color="var(--joy-palette-danger-400)"
              />
              <MiniBar
                label="Music"
                value={data.storage.music_bytes}
                max={maxStorage}
                color="var(--joy-palette-success-500)"
              />
              <MiniBar
                label="Mail attachments"
                value={data.storage.mail_attachment_bytes}
                max={maxStorage}
                color="var(--joy-palette-neutral-400)"
              />
            </Box>
          </Sheet>

          {/* ---- Per-app object counts ---- */}
          <Typography level="title-sm" sx={{ mb: 1.5 }}>
            Object counts by app
          </Typography>
          <Sheet
            variant="outlined"
            sx={{
              borderRadius: "md",
              overflow: "hidden",
              overflowX: "auto",
              mb: 2,
            }}
          >
            <Table
              size="sm"
              hoverRow
              sx={{ minWidth: 480, "--TableCell-paddingX": "12px" }}
            >
              <thead>
                <tr>
                  <th style={{ width: "35%" }}>App</th>
                  <th style={{ width: "25%" }}>Total</th>
                  <th style={{ width: "20%" }}>New (7d)</th>
                  <th style={{ minWidth: 100 }} aria-label="Bar" />
                </tr>
              </thead>
              <tbody>
                {appRows.map(([label, total, new7d]) => (
                  <tr key={label}>
                    <td>
                      <Typography level="body-sm">{label}</Typography>
                    </td>
                    <td>
                      <Typography
                        level="body-sm"
                        sx={{ fontWeight: total > 0 ? 600 : 400 }}
                      >
                        {total.toLocaleString()}
                      </Typography>
                    </td>
                    <td>
                      {new7d > 0 ? (
                        <Chip size="sm" variant="soft" color="success">
                          +{new7d.toLocaleString()}
                        </Chip>
                      ) : (
                        <Typography level="body-xs" sx={{ opacity: 0.4 }}>
                          —
                        </Typography>
                      )}
                    </td>
                    <td>
                      <Box
                        sx={{
                          height: 6,
                          borderRadius: 4,
                          bgcolor: "background.level2",
                          overflow: "hidden",
                          minWidth: 80,
                        }}
                      >
                        <Box
                          sx={{
                            height: "100%",
                            width: `${Math.round((total / maxCount) * 100)}%`,
                            bgcolor: "primary.400",
                            borderRadius: 4,
                          }}
                        />
                      </Box>
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
