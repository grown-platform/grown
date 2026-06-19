/**
 * Desktops — on-demand container desktops (Guacamole Phase 2).
 *
 * Renders nothing unless the desktops API is enabled on this instance (the
 * /flavors call 404s when disabled). Lets a member launch a desktop flavor
 * (ephemeral or persistent), then lists their running sessions with Open + Stop.
 * A periodic poll refreshes session state and heartbeats running sessions so the
 * server-side reaper doesn't kill an actively-watched desktop.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Option,
  Select,
  Typography,
} from "@mui/joy";
import ComputerIcon from "@mui/icons-material/Computer";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import StopIcon from "@mui/icons-material/Stop";

type Flavor = {
  id: string;
  name: string;
  description: string;
  protocol: string;
  persistent: boolean;
};
type Session = {
  id: string;
  flavor: string;
  mode: string;
  state: string;
  open_url: string;
  detail: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<T | null> {
  const r = await fetch("/api/v1/desktops" + path, {
    credentials: "same-origin",
    ...init,
  });
  if (!r.ok) return null;
  if (r.status === 204) return null;
  return (await r.json()) as T;
}

const stateColor: Record<string, "primary" | "success" | "warning" | "danger"> =
  {
    starting: "warning",
    running: "success",
    error: "danger",
    stopped: "primary",
  };

export default function Desktops() {
  const [flavors, setFlavors] = useState<Flavor[] | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [flavorID, setFlavorID] = useState("");
  const [mode, setMode] = useState<"ephemeral" | "persistent">("ephemeral");
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState("");

  // Load the catalog once. A 404 (disabled) leaves flavors null → render nothing.
  useEffect(() => {
    let alive = true;
    api<{ flavors: Flavor[] }>("/flavors").then((d) => {
      if (alive && d?.flavors?.length) {
        setFlavors(d.flavors);
        setFlavorID(d.flavors[0].id);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const d = await api<{ sessions: Session[] }>("/sessions");
    const list = d?.sessions ?? [];
    setSessions(list);
    list
      .filter((s) => s.state === "running")
      .forEach((s) => {
        void api(`/sessions/${s.id}/heartbeat`, { method: "POST" });
      });
  }, []);

  // Poll while mounted (also heartbeats running sessions via refresh).
  useEffect(() => {
    if (!flavors) return;
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [flavors, refresh]);

  const launch = useCallback(async () => {
    setLaunching(true);
    setError("");
    const r = await fetch("/api/v1/desktops/launch", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flavor: flavorID, mode }),
    });
    setLaunching(false);
    if (!r.ok) {
      const e = (await r.json().catch(() => null)) as { error?: string } | null;
      setError(e?.error ?? "launch failed");
      return;
    }
    void refresh();
  }, [flavorID, mode, refresh]);

  const stop = useCallback(
    async (id: string) => {
      await api(`/sessions/${id}/stop`, { method: "POST" });
      void refresh();
    },
    [refresh],
  );

  if (!flavors) return null;

  const selected = flavors.find((f) => f.id === flavorID);
  const canPersist = selected?.persistent ?? false;

  return (
    <>
      <Divider sx={{ my: 3 }} />
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
          <ComputerIcon sx={{ fontSize: 20, color: "primary.500" }} />
          <Typography level="title-md">On-demand desktops</Typography>
          <Chip size="sm" color="success" variant="soft">
            Live
          </Chip>
        </Box>
        <Typography level="body-sm" sx={{ color: "neutral.600", mb: 2 }}>
          Launch a disposable Linux desktop, browser, or terminal in a container —
          streamed into your browser through the gateway. Sessions reap when idle.
        </Typography>

        <Card variant="soft" sx={{ mb: 2 }}>
          <CardContent
            sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}
          >
            <Select
              size="sm"
              value={flavorID}
              onChange={(_, v) => v && setFlavorID(v)}
              sx={{ minWidth: 180 }}
            >
              {flavors.map((f) => (
                <Option key={f.id} value={f.id}>
                  {f.name}
                </Option>
              ))}
            </Select>
            <Button
              size="sm"
              variant={mode === "ephemeral" ? "solid" : "outlined"}
              onClick={() => setMode("ephemeral")}
            >
              Ephemeral
            </Button>
            <Button
              size="sm"
              variant={mode === "persistent" ? "solid" : "outlined"}
              disabled={!canPersist}
              onClick={() => setMode("persistent")}
            >
              Persistent
            </Button>
            <Button
              size="sm"
              onClick={launch}
              loading={launching}
              startDecorator={<ComputerIcon />}
            >
              Launch
            </Button>
            {selected && (
              <Typography level="body-xs" sx={{ color: "neutral.500", flexBasis: "100%" }}>
                {selected.description}
              </Typography>
            )}
          </CardContent>
        </Card>

        {error && (
          <Typography level="body-sm" color="danger" sx={{ mb: 1 }}>
            {error}
          </Typography>
        )}

        {sessions.length > 0 && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {sessions.map((s) => (
              <Card key={s.id} variant="outlined" size="sm">
                <CardContent
                  sx={{ flexDirection: "row", alignItems: "center", gap: 1 }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography level="title-sm">
                      {flavors.find((f) => f.id === s.flavor)?.name ?? s.flavor}{" "}
                      <Typography level="body-xs" sx={{ color: "neutral.500" }}>
                        ({s.mode})
                      </Typography>
                    </Typography>
                    {s.state === "error" && s.detail && (
                      <Typography level="body-xs" color="danger">
                        {s.detail}
                      </Typography>
                    )}
                  </Box>
                  <Chip
                    size="sm"
                    variant="soft"
                    color={stateColor[s.state] ?? "neutral"}
                  >
                    {s.state === "starting" ? (
                      <CircularProgress size="sm" />
                    ) : (
                      s.state
                    )}
                  </Chip>
                  {s.state === "running" && s.open_url && (
                    <Button
                      size="sm"
                      component="a"
                      href={s.open_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      endDecorator={<OpenInNewIcon sx={{ fontSize: 14 }} />}
                    >
                      Open
                    </Button>
                  )}
                  <Button
                    size="sm"
                    color="danger"
                    variant="plain"
                    onClick={() => stop(s.id)}
                    startDecorator={<StopIcon sx={{ fontSize: 16 }} />}
                  >
                    Stop
                  </Button>
                </CardContent>
              </Card>
            ))}
          </Box>
        )}
      </Box>
    </>
  );
}
