import { useState, useEffect } from "react";
import {
  Box,
  Sheet,
  Typography,
  Avatar,
  Dropdown,
  MenuButton,
  Menu,
  MenuItem,
  IconButton,
  useColorScheme,
  Divider,
  CircularProgress,
} from "@mui/joy";
import { Link as RouterLink, useLocation, useNavigate } from "react-router-dom";
import * as Icons from "@mui/icons-material";
import { useBrand } from "../brand/Brand";
import type { User, Org, AccountInfo } from "../api/types";
import {
  logout,
  loginURL,
  whoami,
  listAccounts,
  activateAccount,
  removeAccount,
} from "../api/client";
import { apps } from "../catalog/apps";
import { NotificationBell } from "./NotificationBell";
import { SecurityDialog } from "./SecurityDialog";
import { SearchOverlay } from "./SearchOverlay";

interface HeaderProps {
  user: User | null;
}

/** Header is the top app-bar shown on every authenticated page.
 *  Layout: [service or brand] ........ [apps-switcher] [user menu]
 *  Inside a service (e.g. /docs, /drive) the top-left shows that service's
 *  icon + name; on the dashboard it shows the workspace brand. */
export function Header({ user }: HeaderProps) {
  const brand = useBrand();
  const location = useLocation();
  const navigate = useNavigate();
  const [securityOpen, setSecurityOpen] = useState(false);
  const [org, setOrg] = useState<Org | null>(null);
  // Multi-account list — fetched when the dropdown opens.
  const [accounts, setAccounts] = useState<AccountInfo[] | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(false);
  // Track avatar cache-buster so uploads bust the header avatar too.
  const [avatarBuster, setAvatarBuster] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    whoami()
      .then((r) => {
        if (alive && r.status === "ok") setOrg(r.data.org);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user]);

  // Listen for avatar uploads from the Settings page.
  useEffect(() => {
    const handler = () => setAvatarBuster(Date.now());
    window.addEventListener("avatar-changed", handler);
    return () => window.removeEventListener("avatar-changed", handler);
  }, []);

  const initial = (user?.display_name || user?.email || "?")
    .charAt(0)
    .toUpperCase();
  // Use the PER-USER avatar URL (same as the account-switcher list, which works)
  // so each account's image gets its own browser cache key — switching profiles
  // and back no longer shows a stale/other avatar. /me/avatar is session-relative
  // and shares one cache entry across accounts, which caused the conflation.
  // The upload buster (?v=) forces a refresh after the user changes their photo.
  const avatarSrc = user
    ? `/api/v1/users/${user.id}/avatar?u=${user.id}${avatarBuster != null ? `&v=${avatarBuster}` : ""}`
    : undefined;

  /** Fetch the multi-account list when the dropdown opens. */
  function onMenuOpen() {
    if (accounts !== null) return; // already loaded
    setAccountsLoading(true);
    listAccounts()
      .then((list) => setAccounts(list))
      .catch(() => setAccounts([]))
      .finally(() => setAccountsLoading(false));
  }

  /** Switch to a different already-signed-in account (no OIDC redirect). */
  async function switchToAccount(sessionId: string) {
    try {
      await activateAccount(sessionId);
      // After switching, reload whoami to pick up the new session.
      window.location.reload();
    } catch {
      // If activation fails, fall back to a fresh login.
      window.location.href = `${loginURL()}?prompt=select_account`;
    }
  }

  /** Sign out one account from the browser's list. */
  async function signOutAccount(sessionId: string, isActive: boolean) {
    try {
      const result = await removeAccount(sessionId);
      if (result.signed_out || isActive) {
        // Active account was removed — refresh to sign-in state.
        window.location.reload();
      } else {
        // Refresh the account list.
        const updated = await listAccounts();
        setAccounts(updated);
      }
    } catch {
      window.location.reload();
    }
  }

  const current = apps.find(
    (a) =>
      !a.comingSoon &&
      (location.pathname === `/${a.id}` ||
        location.pathname.startsWith(`/${a.id}/`)),
  );
  const CurrentIcon = current
    ? (Icons as Record<string, React.ComponentType<{ sx?: object }>>)[
        current.iconName
      ]
    : null;

  return (
    <Sheet
      component="header"
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 1,
        px: { xs: 1.5, sm: 3 },
        py: 1.5,
        borderBottom: "1px solid",
        borderColor: "divider",
        bgcolor: "background.surface",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        {current ? (
          <RouterLink
            to={`/${current.id}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              textDecoration: "none",
              color: "inherit",
            }}
          >
            {CurrentIcon && (
              <CurrentIcon sx={{ color: current.accentColor, fontSize: 30 }} />
            )}
            <Typography level="title-lg" sx={{ color: brand.onSurfaceColor }}>
              {current.name}
            </Typography>
          </RouterLink>
        ) : (
          <RouterLink
            to="/"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              textDecoration: "none",
              color: "inherit",
            }}
          >
            {brand.logoSVG ? (
              <Box
                aria-label={brand.productName}
                sx={{ width: 36, height: 36, display: "flex", flexShrink: 0 }}
                dangerouslySetInnerHTML={{ __html: brand.logoSVG }}
              />
            ) : (
              <Avatar
                variant="solid"
                sx={{
                  bgcolor: brand.primaryColor,
                  color: "white",
                  fontWeight: 700,
                }}
              >
                {brand.productName.charAt(0).toUpperCase()}
              </Avatar>
            )}
            <Typography level="title-lg" sx={{ color: brand.onSurfaceColor }}>
              {brand.productName}
            </Typography>
          </RouterLink>
        )}
        {!current && brand.tagline && (
          <Typography
            level="body-sm"
            sx={{
              color: brand.onSurfaceColor,
              opacity: 0.6,
              pl: 1.5,
              ml: 0.5,
              borderLeft: "1px solid",
              borderColor: "divider",
              display: { xs: "none", md: "block" },
            }}
          >
            {brand.tagline}
          </Typography>
        )}
      </Box>

      {user && <SearchOverlay onClose={() => {}} />}

      {user && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <NotificationBell />
          <AppsSwitcher />
          <Dropdown
            onOpenChange={(_, isOpen) => {
              if (isOpen) onMenuOpen();
            }}
          >
            <MenuButton
              slots={{ root: Avatar }}
              slotProps={{
                root: {
                  src: avatarSrc,
                  variant: "soft",
                  "aria-label": "user menu",
                } as any,
              }}
            >
              {initial}
            </MenuButton>
            <Menu placement="bottom-end" sx={{ minWidth: 260 }}>
              {/* Active account info */}
              <Box sx={{ px: 1.5, py: 1 }}>
                <Typography level="title-sm" noWrap>
                  {user.display_name || user.email}
                </Typography>
                {user.display_name && (
                  <Typography level="body-xs" sx={{ opacity: 0.7 }} noWrap>
                    {user.email}
                  </Typography>
                )}
                {org && (
                  <Typography
                    level="body-xs"
                    sx={{ mt: 0.25, opacity: 0.6 }}
                    noWrap
                    startDecorator={
                      <Icons.BusinessOutlined sx={{ fontSize: 14 }} />
                    }
                  >
                    {org.display_name || org.slug}
                  </Typography>
                )}
              </Box>

              <Divider />

              {/* Other signed-in accounts */}
              {accountsLoading && (
                <Box sx={{ display: "flex", justifyContent: "center", py: 1 }}>
                  <CircularProgress size="sm" />
                </Box>
              )}
              {!accountsLoading &&
                accounts &&
                accounts.filter((a) => !a.active).length > 0 && (
                  <>
                    <Box sx={{ px: 1.5, pt: 1, pb: 0.25 }}>
                      <Typography
                        level="body-xs"
                        sx={{
                          opacity: 0.6,
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                        }}
                      >
                        Other accounts
                      </Typography>
                    </Box>
                    {accounts
                      .filter((a) => !a.active)
                      .map((acct) => (
                        <MenuItem
                          key={acct.session_id}
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1.5,
                            pr: 0.5,
                          }}
                        >
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 1.5,
                              flex: 1,
                              minWidth: 0,
                              cursor: "pointer",
                            }}
                            onClick={() => switchToAccount(acct.session_id)}
                          >
                            <Avatar
                              src={acct.avatar_url}
                              size="sm"
                              sx={{ flexShrink: 0 }}
                            >
                              {(acct.display_name || acct.email || "?")
                                .charAt(0)
                                .toUpperCase()}
                            </Avatar>
                            <Box sx={{ minWidth: 0 }}>
                              <Typography
                                level="body-sm"
                                noWrap
                                fontWeight="md"
                              >
                                {acct.display_name || acct.email}
                              </Typography>
                              {acct.display_name && (
                                <Typography
                                  level="body-xs"
                                  noWrap
                                  sx={{ opacity: 0.7 }}
                                >
                                  {acct.email}
                                </Typography>
                              )}
                              {(acct.org_name || acct.org_slug) && (
                                <Typography
                                  level="body-xs"
                                  noWrap
                                  sx={{ opacity: 0.5 }}
                                >
                                  {acct.org_name || acct.org_slug}
                                </Typography>
                              )}
                            </Box>
                          </Box>
                          <IconButton
                            size="sm"
                            variant="plain"
                            color="neutral"
                            onClick={(e) => {
                              e.stopPropagation();
                              signOutAccount(acct.session_id, false);
                            }}
                            title="Sign out this account"
                            sx={{
                              opacity: 0.5,
                              "&:hover": { opacity: 1 },
                              flexShrink: 0,
                            }}
                          >
                            <Icons.CloseOutlined fontSize="small" />
                          </IconButton>
                        </MenuItem>
                      ))}
                    <Divider />
                  </>
                )}

              <ThemeModeItem />
              <MenuItem onClick={() => navigate("/settings")}>
                <Icons.SettingsOutlined sx={{ mr: 1 }} fontSize="small" />{" "}
                Settings
              </MenuItem>
              <MenuItem onClick={() => setSecurityOpen(true)}>
                <Icons.SecurityOutlined sx={{ mr: 1 }} fontSize="small" />{" "}
                Security
              </MenuItem>
              <MenuItem
                onClick={() => {
                  window.location.href = `${loginURL()}?prompt=select_account`;
                }}
                data-testid="add-account"
              >
                <Icons.PersonAddAlt1Outlined sx={{ mr: 1 }} fontSize="small" />{" "}
                Add another account
              </MenuItem>
              <MenuItem
                onClick={() => logout().then(() => window.location.reload())}
                data-testid="sign-out"
              >
                <Icons.LogoutOutlined sx={{ mr: 1 }} fontSize="small" /> Sign
                out
              </MenuItem>
            </Menu>
          </Dropdown>
        </Box>
      )}
      {user && securityOpen && (
        <SecurityDialog user={user} onClose={() => setSecurityOpen(false)} />
      )}
    </Sheet>
  );
}

/** ThemeModeItem renders the Light/Dark/System switcher as FLAT menu items
 *  inside the avatar menu. A nested hover-submenu was unreliable here (it lives
 *  outside a real Joy submenu context), so the options are inlined; the active
 *  one is checked. Joy's useColorScheme persists the choice to localStorage. */
function ThemeModeItem() {
  const { mode, setMode } = useColorScheme();
  const opts: {
    key: "light" | "dark" | "system";
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      key: "light",
      label: "Light",
      icon: <Icons.LightModeOutlined sx={{ mr: 1 }} fontSize="small" />,
    },
    {
      key: "dark",
      label: "Dark",
      icon: <Icons.DarkModeOutlined sx={{ mr: 1 }} fontSize="small" />,
    },
    {
      key: "system",
      label: "System",
      icon: (
        <Icons.SettingsBrightnessOutlined sx={{ mr: 1 }} fontSize="small" />
      ),
    },
  ];
  return (
    <>
      <MenuItem disabled sx={{ opacity: 0.7 }}>
        <Icons.BrightnessMediumOutlined sx={{ mr: 1 }} fontSize="small" />
        <Typography level="body-xs" sx={{ fontWeight: 600 }}>
          Theme
        </Typography>
      </MenuItem>
      {opts.map((o) => (
        <MenuItem
          key={o.key}
          selected={mode === o.key}
          onClick={() => setMode(o.key)}
          data-testid={`theme-${o.key}`}
          sx={{ pl: 2.5 }}
        >
          {o.icon}
          {o.label}
          {mode === o.key && (
            <Icons.Check fontSize="small" sx={{ ml: "auto", opacity: 0.7 }} />
          )}
        </MenuItem>
      ))}
    </>
  );
}

/** AppsSwitcher renders the 9-dot grid icon. On click, opens a popover with
 *  a mini grid of every app from the catalog, each linking to its route. */
function AppsSwitcher() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.closest("[data-apps-switcher]") || t.closest('[aria-label="apps"]'))
      )
        return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <Dropdown open={open} onOpenChange={(_, isOpen) => setOpen(isOpen)}>
      <MenuButton
        slots={{ root: IconButton }}
        slotProps={{
          root: {
            variant: "plain",
            color: "neutral",
            "aria-label": "apps",
          } as any,
        }}
      >
        <Icons.Apps />
      </MenuButton>
      <Menu
        placement="bottom-end"
        sx={{ p: 1.5, minWidth: 360 }}
        slotProps={{ root: { "data-apps-switcher": true } as any }}
      >
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(80px, 1fr))",
            gap: 0.5,
          }}
        >
          <WorkspaceTile onNavigate={close} />
          {apps.map((app) => (
            <MiniTile key={app.id} app={app} onNavigate={close} />
          ))}
        </Box>
      </Menu>
    </Dropdown>
  );
}

/** WorkspaceTile is the dashboard/home entry inside the apps-switcher grid. */
function WorkspaceTile({ onNavigate }: { onNavigate?: () => void }) {
  const brand = useBrand();
  return (
    <Box
      component={RouterLink}
      to="/"
      onClick={onNavigate}
      data-testid="switcher-workspace"
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: 0.5,
        py: 1.25,
        px: 0.5,
        textDecoration: "none",
        color: "inherit",
        borderRadius: "sm",
        transition: "background-color 120ms",
        "&:hover": { bgcolor: "background.level1" },
      }}
    >
      <Avatar
        variant="plain"
        sx={{
          bgcolor: "background.surface",
          width: 42,
          height: 42,
          boxShadow: "xs",
          "& svg": { color: brand.primaryColor, fontSize: 22 },
        }}
      >
        <Icons.GridView />
      </Avatar>
      <Typography level="body-xs" sx={{ fontWeight: 500, lineHeight: 1.2 }}>
        Workspace
      </Typography>
    </Box>
  );
}

interface MiniTileProps {
  app: (typeof apps)[number];
  onNavigate?: () => void;
}

function MiniTile({ app, onNavigate }: MiniTileProps) {
  const IconComponent = (
    Icons as Record<string, React.ComponentType<{ sx?: object }>>
  )[app.iconName];
  const linkProps = app.externalUrl
    ? {
        component: "a" as const,
        href: app.externalUrl,
        target: "_blank",
        rel: "noopener noreferrer",
      }
    : {
        component: RouterLink,
        to: app.comingSoon ? `/coming-soon/${app.id}` : `/${app.id}`,
      };
  return (
    <Box
      {...linkProps}
      onClick={onNavigate}
      data-testid={`switcher-${app.id}`}
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: 0.5,
        py: 1.25,
        px: 0.5,
        textDecoration: "none",
        color: "inherit",
        borderRadius: "sm",
        transition: "background-color 120ms",
        "&:hover": { bgcolor: "background.level1" },
      }}
    >
      <Avatar
        variant="plain"
        sx={{
          bgcolor: "background.surface",
          width: 42,
          height: 42,
          boxShadow: "xs",
          "& svg": {
            color: app.accentColor,
            fontSize: 22,
          },
        }}
      >
        {IconComponent ? <IconComponent /> : app.name.charAt(0).toUpperCase()}
      </Avatar>
      <Typography level="body-xs" sx={{ fontWeight: 500, lineHeight: 1.2 }}>
        {app.name}
      </Typography>
    </Box>
  );
}
