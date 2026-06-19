/**
 * Access page — clientless access to internal resources.
 *
 * Three sections:
 *  1. Published apps      — org admins register internal/self-hosted services;
 *                           any member can click to open them in a new tab.
 *                           Admins see an "Add app" form + edit/delete controls.
 *  2. Browser terminal & desktop (Coming soon) — clientless SSH/RDP/VNC via a
 *                           Guacamole gateway prepared in gitops. The section
 *                           becomes live once the gateway is deployed.
 *  3. Tailnet status      — secondary section showing the Tailscale tailnet name
 *                           + device count from the existing Tailscale status API.
 *                           Only shown when the tailnet is configured.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Box,
  Container,
  Typography,
  Card,
  CardContent,
  Button,
  IconButton,
  Input,
  FormControl,
  FormLabel,
  Modal,
  ModalDialog,
  ModalClose,
  Chip,
  Alert,
  CircularProgress,
  Divider,
  Stack,
} from "@mui/joy";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import LaunchIcon from "@mui/icons-material/Launch";
import LanIcon from "@mui/icons-material/Lan";
import TerminalIcon from "@mui/icons-material/Terminal";
import RouterIcon from "@mui/icons-material/Router";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import Desktops from "./Desktops";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import {
  listAccessApps,
  createAccessApp,
  updateAccessApp,
  deleteAccessApp,
  type AccessApp,
  type AccessAppInput,
} from "../../api/access";
import { adminWhoAmI } from "../admin/usersApi";

interface AccessPageProps {
  user: User;
}

interface TailnetStatus {
  tailnet: string;
  deviceCount: number;
  selfHostname: string;
}

// ---------------------------------------------------------------------------
// App card (launch tile)
// ---------------------------------------------------------------------------

interface AppCardProps {
  app: AccessApp;
  isAdmin: boolean;
  onEdit: (app: AccessApp) => void;
  onDelete: (app: AccessApp) => void;
}

function AppCard({ app, isAdmin, onEdit, onDelete }: AppCardProps) {
  return (
    <Card
      variant="outlined"
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 0.5,
        "&:hover": { boxShadow: "sm" },
        transition: "box-shadow 120ms",
      }}
    >
      <CardContent sx={{ gap: 0.5 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 1,
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              {app.icon && (
                <Typography sx={{ fontSize: "1.25rem", lineHeight: 1 }}>
                  {app.icon}
                </Typography>
              )}
              <Typography
                component="a"
                href={app.url}
                target="_blank"
                rel="noopener noreferrer"
                level="title-sm"
                sx={{
                  color: "primary.600",
                  textDecoration: "none",
                  "&:hover": { textDecoration: "underline" },
                  display: "flex",
                  alignItems: "center",
                  gap: 0.5,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {app.name}
                <OpenInNewIcon sx={{ fontSize: 14, flexShrink: 0 }} />
              </Typography>
            </Box>
            {app.description && (
              <Typography
                level="body-xs"
                sx={{ color: "neutral.500", mt: 0.25 }}
              >
                {app.description}
              </Typography>
            )}
            <Typography
              level="body-xs"
              sx={{
                color: "neutral.400",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                mt: 0.25,
              }}
            >
              {app.url}
            </Typography>
          </Box>
          {isAdmin && (
            <Box sx={{ display: "flex", gap: 0.5, flexShrink: 0 }}>
              <IconButton
                size="sm"
                variant="plain"
                color="neutral"
                onClick={() => onEdit(app)}
              >
                <EditIcon sx={{ fontSize: 16 }} />
              </IconButton>
              <IconButton
                size="sm"
                variant="plain"
                color="danger"
                onClick={() => onDelete(app)}
              >
                <DeleteIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Box>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Add / Edit dialog
// ---------------------------------------------------------------------------

interface AppDialogProps {
  initial?: AccessApp;
  onSave: (input: AccessAppInput) => Promise<void>;
  onClose: () => void;
}

function AppDialog({ initial, onSave, onClose }: AppDialogProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const handleSave = async () => {
    setErr("");
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        url: url.trim(),
        description: description.trim(),
        icon: icon.trim(),
      });
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose}>
      <ModalDialog sx={{ minWidth: 360, maxWidth: 480 }}>
        <ModalClose />
        <Typography level="title-md">
          {initial ? "Edit app" : "Add published app"}
        </Typography>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {err && <Alert color="danger">{err}</Alert>}
          <FormControl required>
            <FormLabel>Name</FormLabel>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Internal Wiki"
              autoFocus
            />
          </FormControl>
          <FormControl required>
            <FormLabel>URL</FormLabel>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://wiki.internal"
              type="url"
            />
          </FormControl>
          <FormControl>
            <FormLabel>Description</FormLabel>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional one-liner"
            />
          </FormControl>
          <FormControl>
            <FormLabel>Icon (emoji or short label)</FormLabel>
            <Input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="e.g. 📖 or Wiki"
            />
          </FormControl>
          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
            <Button
              variant="plain"
              color="neutral"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              loading={saving}
              disabled={!name.trim() || !url.trim()}
            >
              {initial ? "Save" : "Add app"}
            </Button>
          </Box>
        </Stack>
      </ModalDialog>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AccessPage({ user }: AccessPageProps) {
  const [apps, setApps] = useState<AccessApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchErr, setFetchErr] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  // Dialog state: null = closed, undefined = "add new", AccessApp = editing that app.
  const [dialogApp, setDialogApp] = useState<AccessApp | undefined | null>(
    null,
  );

  // Tailnet status (optional — only shown when configured).
  const [tailnet, setTailnet] = useState<TailnetStatus | null>(null);
  const [guac, setGuac] = useState<{ url: string } | null>(null);

  useEffect(() => {
    let alive = true;

    // Fetch published apps.
    listAccessApps()
      .then((list) => {
        if (alive) {
          setApps(list);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (alive) {
          setFetchErr(e instanceof Error ? e.message : "load failed");
          setLoading(false);
        }
      });

    // Check admin status.
    adminWhoAmI()
      .then((w) => {
        if (alive) setIsAdmin(w.isAdmin);
      })
      .catch(() => {});

    // Tailscale status (best-effort — missing when not configured).
    fetch("/api/v1/vpn/status", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          d: {
            tailnet?: string;
            device_count?: number;
            self_hostname?: string;
          } | null,
        ) => {
          if (alive && d?.tailnet) {
            setTailnet({
              tailnet: d.tailnet,
              deviceCount: d.device_count ?? 0,
              selfHostname: d.self_hostname ?? "",
            });
          }
        },
      )
      .catch(() => {});

    // Browser-desktop gateway (Guacamole) — present only when GROWN_GUAC_URL is set.
    fetch("/api/v1/access/gateway", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { enabled?: boolean; url?: string } | null) => {
        if (alive && d?.enabled && d.url) setGuac({ url: d.url });
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, []);

  const handleSave = useCallback(
    async (input: AccessAppInput) => {
      if (dialogApp) {
        // Editing existing
        const updated = await updateAccessApp(dialogApp.id, input);
        setApps((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      } else {
        // Creating new
        const created = await createAccessApp(input);
        setApps((prev) => [...prev, created]);
      }
    },
    [dialogApp],
  );

  const handleDelete = useCallback(async (app: AccessApp) => {
    if (!confirm(`Delete "${app.name}"?`)) return;
    await deleteAccessApp(app.id);
    setApps((prev) => prev.filter((a) => a.id !== app.id));
  }, []);

  return (
    <>
      <Header user={user} />
      <Container maxWidth="md" sx={{ py: 4 }}>
        {/* Page title */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 3 }}>
          <LanIcon sx={{ fontSize: 28, color: "primary.500" }} />
          <Box>
            <Typography level="h3">Access</Typography>
            <Typography level="body-sm" sx={{ color: "neutral.500" }}>
              Clientless access to internal apps, terminals &amp; your tailnet.
            </Typography>
          </Box>
        </Box>

        {/* ---------------------------------------------------------------- */}
        {/* Section 1 — Published apps                                        */}
        {/* ---------------------------------------------------------------- */}
        <Box sx={{ mb: 4 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              mb: 2,
            }}
          >
            <Box>
              <Typography level="title-md">Published apps</Typography>
              <Typography level="body-xs" sx={{ color: "neutral.500" }}>
                Internal services registered by your org admins. Click any tile
                to open in a new tab.
              </Typography>
            </Box>
            {isAdmin && (
              <Button
                size="sm"
                startDecorator={<AddIcon />}
                onClick={() => setDialogApp(undefined)}
              >
                Add app
              </Button>
            )}
          </Box>

          {loading && (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress />
            </Box>
          )}

          {!loading && fetchErr && <Alert color="danger">{fetchErr}</Alert>}

          {!loading && !fetchErr && apps.length === 0 && (
            <Card variant="soft" sx={{ textAlign: "center", py: 4 }}>
              <Typography level="body-sm" sx={{ color: "neutral.500" }}>
                {isAdmin
                  ? 'No published apps yet. Click "Add app" to register an internal service.'
                  : "No internal apps have been published for your org yet."}
              </Typography>
            </Card>
          )}

          {!loading && !fetchErr && apps.length > 0 && (
            <Box
              sx={{
                display: "grid",
                gap: 1.5,
                gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              }}
            >
              {apps.map((app) => (
                <AppCard
                  key={app.id}
                  app={app}
                  isAdmin={isAdmin}
                  onEdit={(a) => setDialogApp(a)}
                  onDelete={handleDelete}
                />
              ))}
            </Box>
          )}
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* ---------------------------------------------------------------- */}
        {/* Section 2 — Browser terminal & desktop (Coming soon)              */}
        {/* ---------------------------------------------------------------- */}
        <Box sx={{ mb: 4 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            <TerminalIcon
              sx={{ fontSize: 20, color: guac ? "primary.500" : "neutral.500" }}
            />
            <Typography level="title-md">
              Browser terminal &amp; desktop
            </Typography>
            {guac ? (
              <Chip size="sm" color="success" variant="soft">
                Live
              </Chip>
            ) : (
              <Chip size="sm" color="warning" variant="soft">
                Coming soon
              </Chip>
            )}
          </Box>
          <Typography level="body-sm" sx={{ color: "neutral.600", mb: 2 }}>
            Clientless SSH, RDP, and VNC into internal hosts — entirely in the
            browser, nothing to install. Powered by an Apache Guacamole gateway
            deployed alongside your workspace.
          </Typography>
          {guac ? (
            <Button
              component="a"
              href={guac.url}
              target="_blank"
              rel="noopener noreferrer"
              startDecorator={<TerminalIcon />}
              endDecorator={<OpenInNewIcon sx={{ fontSize: 16 }} />}
            >
              Open browser terminal
            </Button>
          ) : (
            <Card variant="soft" sx={{ bgcolor: "neutral.50" }}>
              <CardContent>
                <Typography level="body-sm" sx={{ color: "neutral.600" }}>
                  <strong>Preparing:</strong> The Guacamole gateway will appear
                  here once it's deployed for this workspace.
                </Typography>
              </CardContent>
            </Card>
          )}
        </Box>

        {/* Section 2b — On-demand container desktops (Phase 2, when enabled) */}
        <Desktops />

        {/* ---------------------------------------------------------------- */}
        {/* Section 3 — Tailscale tailnet status (secondary, only when set)   */}
        {/* ---------------------------------------------------------------- */}
        {tailnet && (
          <>
            <Divider sx={{ my: 3 }} />
            <Box>
              <Box
                sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}
              >
                <RouterIcon sx={{ fontSize: 20, color: "neutral.500" }} />
                <Typography level="title-md">Tailnet</Typography>
              </Box>
              <Typography level="body-sm" sx={{ color: "neutral.600", mb: 2 }}>
                Your Tailscale tailnet status. A full-device VPN requires the
                Tailscale client, but published apps above are clientless.
              </Typography>
              <Card variant="outlined" sx={{ maxWidth: 400 }}>
                <CardContent>
                  <Stack spacing={0.5}>
                    <Box
                      sx={{ display: "flex", justifyContent: "space-between" }}
                    >
                      <Typography level="body-sm" sx={{ color: "neutral.600" }}>
                        Tailnet
                      </Typography>
                      <Typography level="body-sm" sx={{ fontWeight: 600 }}>
                        {tailnet.tailnet}
                      </Typography>
                    </Box>
                    <Box
                      sx={{ display: "flex", justifyContent: "space-between" }}
                    >
                      <Typography level="body-sm" sx={{ color: "neutral.600" }}>
                        Devices
                      </Typography>
                      <Typography level="body-sm" sx={{ fontWeight: 600 }}>
                        {tailnet.deviceCount}
                      </Typography>
                    </Box>
                    {tailnet.selfHostname && (
                      <Box
                        sx={{
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <Typography
                          level="body-sm"
                          sx={{ color: "neutral.600" }}
                        >
                          This host
                        </Typography>
                        <Typography
                          level="body-sm"
                          sx={{ fontFamily: "monospace", fontSize: "0.85em" }}
                        >
                          {tailnet.selfHostname}
                        </Typography>
                      </Box>
                    )}
                  </Stack>
                </CardContent>
              </Card>
              <Button
                component="a"
                href="https://login.tailscale.com/admin"
                target="_blank"
                rel="noopener noreferrer"
                variant="outlined"
                size="sm"
                startDecorator={<LaunchIcon />}
                sx={{ mt: 1.5 }}
              >
                Open Tailscale admin
              </Button>
            </Box>
          </>
        )}

        {/* Add / Edit dialog */}
        {dialogApp !== null && (
          <AppDialog
            initial={dialogApp}
            onSave={handleSave}
            onClose={() => setDialogApp(null)}
          />
        )}
      </Container>
    </>
  );
}
