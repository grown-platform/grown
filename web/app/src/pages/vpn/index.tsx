import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Link,
  List,
  ListItem,
  ListItemContent,
  ListItemDecorator,
  Sheet,
  Stack,
  Typography,
} from "@mui/joy";
import VpnLockIcon from "@mui/icons-material/VpnLock";
import LaptopIcon from "@mui/icons-material/Laptop";
import SmartphoneIcon from "@mui/icons-material/Smartphone";
import DnsIcon from "@mui/icons-material/Dns";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import { Header } from "../../components/Header";
import type { User } from "../../api/types";
import { getVpnStatus } from "./api";
import type { VpnStatus, VpnDevice } from "./api";

interface VPNAppProps {
  user: User;
}

// Platform → icon mapping (best-effort).
function DeviceIcon({ os }: { os: string }) {
  const lower = (os ?? "").toLowerCase();
  if (
    lower.includes("android") ||
    lower.includes("ios") ||
    lower.includes("iphone")
  ) {
    return <SmartphoneIcon />;
  }
  if (
    lower.includes("linux") ||
    lower.includes("darwin") ||
    lower.includes("windows")
  ) {
    return <LaptopIcon />;
  }
  return <DnsIcon />;
}

const DOWNLOAD_LINKS: { label: string; href: string }[] = [
  { label: "macOS", href: "https://tailscale.com/download/macos" },
  { label: "Windows", href: "https://tailscale.com/download/windows" },
  { label: "Linux", href: "https://tailscale.com/download/linux" },
  { label: "iOS", href: "https://tailscale.com/download/ios" },
  { label: "Android", href: "https://tailscale.com/download/android" },
];

// Workspace services reachable via VPN (well-known internal service hostnames).
// Shown as a convenience reference; these are informational only.
const WORKSPACE_SERVICES: { label: string; description: string }[] = [
  {
    label: "workspace.pick.haus",
    description: "Grown workspace (public + VPN)",
  },
  {
    label: "Postgres (grown namespace)",
    description: "PostgreSQL via tailnet – port 5432",
  },
  {
    label: "RustFS / S3 (grown namespace)",
    description: "Object storage – port 9000",
  },
];

function DeviceRow({ device }: { device: VpnDevice }) {
  const primaryAddr = device.addresses?.[0] ?? "—";
  return (
    <ListItem>
      <ListItemDecorator sx={{ color: "neutral.500" }}>
        <DeviceIcon os={device.os} />
      </ListItemDecorator>
      <ListItemContent>
        <Typography level="title-sm">
          {device.hostname || device.name}
        </Typography>
        <Typography level="body-xs" sx={{ color: "neutral.500" }}>
          {device.os ? `${device.os} · ` : ""}
          {primaryAddr}
          {device.last_seen
            ? ` · last seen ${new Date(device.last_seen).toLocaleString()}`
            : ""}
        </Typography>
      </ListItemContent>
      <Chip
        size="sm"
        variant="soft"
        color={device.online ? "success" : "neutral"}
        startDecorator={device.online ? <CheckCircleOutlineIcon /> : undefined}
      >
        {device.online ? "online" : "offline"}
      </Chip>
    </ListItem>
  );
}

export default function VPNApp({ user }: VPNAppProps) {
  const [status, setStatus] = useState<VpnStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVpnStatus()
      .then((s) => {
        if (!cancelled) {
          setStatus(s);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setFetchError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.body" }}>
      <Header user={user} />
      <Container maxWidth="md" sx={{ py: 4 }}>
        {/* Page header */}
        <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 4 }}>
          <Box
            sx={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              bgcolor: "#0B7285",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              flexShrink: 0,
            }}
          >
            <VpnLockIcon />
          </Box>
          <Box>
            <Typography level="h3">VPN</Typography>
            <Typography level="body-sm" sx={{ color: "neutral.500" }}>
              Tailscale tailnet — secure access to workspace services from
              anywhere
            </Typography>
          </Box>
        </Stack>

        {loading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
            <CircularProgress />
          </Box>
        )}

        {!loading && fetchError && (
          <Sheet
            variant="outlined"
            color="danger"
            sx={{ p: 2, borderRadius: "md", mb: 3 }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <ErrorOutlineIcon color="error" />
              <Typography level="body-sm">
                Could not fetch VPN status: {fetchError}
              </Typography>
            </Stack>
          </Sheet>
        )}

        {!loading && !fetchError && status && !status.configured && (
          /* Unconfigured state — show setup instructions */
          <SetupInstructions />
        )}

        {!loading && !fetchError && status?.configured && (
          /* Configured state — show status + devices */
          <>
            {/* Connection status banner */}
            <Card variant="outlined" sx={{ mb: 3 }}>
              <CardContent>
                <Stack direction="row" spacing={2} alignItems="center">
                  <CheckCircleOutlineIcon
                    sx={{ color: "success.500", fontSize: 32 }}
                  />
                  <Box>
                    <Typography level="title-md">
                      Tailscale integration active
                    </Typography>
                    <Typography level="body-sm" sx={{ color: "neutral.500" }}>
                      Tailnet:{" "}
                      <Typography component="span" fontFamily="monospace">
                        {status.tailnet}
                      </Typography>
                    </Typography>
                  </Box>
                </Stack>
              </CardContent>
            </Card>

            {/* API error (non-fatal) */}
            {status.error && (
              <Sheet
                variant="soft"
                color="warning"
                sx={{ p: 2, borderRadius: "md", mb: 3 }}
              >
                <Typography level="body-sm">{status.error}</Typography>
              </Sheet>
            )}

            {/* Device list */}
            {status.devices_configured ? (
              <Card variant="outlined" sx={{ mb: 3 }}>
                <CardContent>
                  <Typography level="title-md" sx={{ mb: 1 }}>
                    Tailnet devices ({status.devices?.length ?? 0})
                  </Typography>
                  {(status.devices?.length ?? 0) === 0 ? (
                    <Typography level="body-sm" sx={{ color: "neutral.500" }}>
                      No devices found on this tailnet yet.
                    </Typography>
                  ) : (
                    <List size="sm">
                      {status.devices!.map((d) => (
                        <DeviceRow key={d.id || d.name} device={d} />
                      ))}
                    </List>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Sheet variant="soft" sx={{ p: 2, borderRadius: "md", mb: 3 }}>
                <Typography level="body-sm">
                  Device listing disabled — set{" "}
                  <Typography component="span" fontFamily="monospace">
                    GROWN_TAILSCALE_API_KEY
                  </Typography>{" "}
                  in the backend environment to enable it.
                </Typography>
              </Sheet>
            )}

            {/* Workspace services section */}
            <WorkspaceServices />

            <Divider sx={{ my: 3 }} />

            {/* Join instructions (always shown when configured) */}
            <JoinInstructions tailnet={status.tailnet} />
          </>
        )}

        {/* Download links (always shown) */}
        {!loading && <DownloadSection />}
      </Container>
    </Box>
  );
}

function SetupInstructions() {
  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent>
        <Typography level="title-md" sx={{ mb: 1 }}>
          VPN not configured
        </Typography>
        <Typography level="body-sm" sx={{ mb: 2 }}>
          The Tailscale Kubernetes operator has not been enabled yet. Once the
          operator is running in the homelab cluster, set the following
          environment variables on the grown backend to activate the VPN tile:
        </Typography>
        <Sheet
          variant="soft"
          sx={{
            p: 2,
            borderRadius: "sm",
            mb: 2,
            fontFamily: "monospace",
            fontSize: "sm",
          }}
        >
          GROWN_TAILSCALE_TAILNET=your-tailnet.ts.net{"\n"}
          GROWN_TAILSCALE_API_KEY=tskey-api-... # optional, for device listing
        </Sheet>
        <Typography level="body-sm">
          See{" "}
          <Link
            href="https://tailscale.com/kb/1236/kubernetes-operator"
            target="_blank"
            rel="noopener noreferrer"
            endDecorator={<OpenInNewIcon sx={{ fontSize: 14 }} />}
          >
            Tailscale Kubernetes Operator docs
          </Link>{" "}
          and the cluster gitops runbook at{" "}
          <Typography component="span" fontFamily="monospace">
            clusters/homelab/tailscale/RUNBOOK.md
          </Typography>
          .
        </Typography>
      </CardContent>
    </Card>
  );
}

function JoinInstructions({ tailnet }: { tailnet?: string }) {
  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent>
        <Typography level="title-md" sx={{ mb: 1 }}>
          How to join the tailnet
        </Typography>
        <Typography level="body-sm" component="div">
          <ol style={{ marginTop: 4, paddingLeft: 20 }}>
            <li>
              Install Tailscale on your device (see download links below).
            </li>
            <li>
              Sign in with the same account that owns the{" "}
              {tailnet ? (
                <Typography component="span" fontFamily="monospace">
                  {tailnet}
                </Typography>
              ) : (
                "workspace tailnet"
              )}{" "}
              tailnet.
            </li>
            <li>
              Your device will appear in the tailnet and gain access to all
              services exposed via the Tailscale operator.
            </li>
          </ol>
        </Typography>
      </CardContent>
    </Card>
  );
}

function WorkspaceServices() {
  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent>
        <Typography level="title-md" sx={{ mb: 1 }}>
          Workspace services on the tailnet
        </Typography>
        <List size="sm">
          {WORKSPACE_SERVICES.map((svc) => (
            <ListItem key={svc.label}>
              <ListItemDecorator>
                <DnsIcon sx={{ color: "neutral.400" }} />
              </ListItemDecorator>
              <ListItemContent>
                <Typography level="title-sm" fontFamily="monospace">
                  {svc.label}
                </Typography>
                <Typography level="body-xs" sx={{ color: "neutral.500" }}>
                  {svc.description}
                </Typography>
              </ListItemContent>
            </ListItem>
          ))}
        </List>
      </CardContent>
    </Card>
  );
}

function DownloadSection() {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography level="title-md" sx={{ mb: 2 }}>
          Install Tailscale
        </Typography>
        <Stack direction="row" flexWrap="wrap" gap={1}>
          {DOWNLOAD_LINKS.map((l) => (
            <Button
              key={l.label}
              component="a"
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              variant="outlined"
              color="neutral"
              size="sm"
              endDecorator={<OpenInNewIcon sx={{ fontSize: 14 }} />}
            >
              {l.label}
            </Button>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}
