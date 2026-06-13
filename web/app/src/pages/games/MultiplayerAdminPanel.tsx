import { useCallback, useEffect, useState } from "react";
import {
  Modal,
  ModalDialog,
  ModalClose,
  Typography,
  Box,
  Switch,
  Button,
  IconButton,
  Table,
  Sheet,
  Chip,
  CircularProgress,
  Tabs,
  TabList,
  Tab,
  TabPanel,
  Input,
  Select,
  Option,
  Alert,
  Tooltip,
} from "@mui/joy";
import * as Icons from "@mui/icons-material";
import {
  getSettings,
  setEnabled as apiSetEnabled,
  getSessions,
  kick as apiKick,
  getAudit,
  type SessionInfo,
  type AuditEvent,
} from "./multiplayerAdminApi";

/**
 * Admin control panel for the games-area multiplayer relay (internal/gamerooms).
 * Rendered as a fullscreen-ish modal, opened from the admin-only settings button
 * on the Games dashboard. Three concerns: a global enable/disable toggle, a live
 * sessions monitor with kick controls, and the audit log. Every backed endpoint
 * is admin-gated server-side.
 */

const AUDIT_EVENTS = [
  "room_created",
  "peer_joined",
  "peer_left",
  "kicked",
  "toggled",
];

function ageLabel(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function eventColor(
  e: string,
): "success" | "warning" | "danger" | "primary" | "neutral" {
  switch (e) {
    case "room_created":
      return "primary";
    case "peer_joined":
      return "success";
    case "peer_left":
      return "neutral";
    case "kicked":
      return "danger";
    case "toggled":
      return "warning";
    default:
      return "neutral";
  }
}

export default function MultiplayerAdminPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Settings
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [updatedBy, setUpdatedBy] = useState("");
  const [toggling, setToggling] = useState(false);

  // Sessions
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessLoading, setSessLoading] = useState(false);

  // Audit
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [filterEvent, setFilterEvent] = useState("");
  const [filterRoom, setFilterRoom] = useState("");

  const loadSettings = useCallback(async () => {
    try {
      const s = await getSettings();
      setEnabled(s.enabled);
      setUpdatedBy(s.updated_by);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load settings");
    }
  }, []);

  const loadSessions = useCallback(async () => {
    setSessLoading(true);
    try {
      const r = await getSessions();
      setSessions(r.sessions);
      setEnabled(r.enabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sessions");
    } finally {
      setSessLoading(false);
    }
  }, []);

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const r = await getAudit({
        event: filterEvent || undefined,
        room: filterRoom.trim() || undefined,
        limit: 200,
      });
      setEvents(r.events);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load audit log");
    } finally {
      setAuditLoading(false);
    }
  }, [filterEvent, filterRoom]);

  // Initial load when opened.
  useEffect(() => {
    if (!open) return;
    void loadSettings();
    void loadSessions();
  }, [open, loadSettings, loadSessions]);

  // Lazy-load the audit tab on first view.
  useEffect(() => {
    if (open && tab === 2) void loadAudit();
  }, [open, tab, loadAudit]);

  const onToggle = async (next: boolean) => {
    setToggling(true);
    setError(null);
    try {
      const r = await apiSetEnabled(next);
      setEnabled(r.enabled);
      void loadSettings();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Toggle failed");
    } finally {
      setToggling(false);
    }
  };

  const onKick = async (room: string, peerId?: string) => {
    setError(null);
    try {
      await apiKick(room, peerId);
      await loadSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kick failed");
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        layout="center"
        sx={{
          width: "min(900px, 96vw)",
          maxHeight: "92vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          p: 0,
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 2.5,
            py: 2,
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <Icons.SportsEsports />
          <Typography level="title-lg">Multiplayer admin</Typography>
          <Chip
            size="sm"
            variant="soft"
            color={enabled === null ? "neutral" : enabled ? "success" : "danger"}
            sx={{ ml: 1 }}
          >
            {enabled === null ? "…" : enabled ? "Enabled" : "Disabled"}
          </Chip>
          <Box sx={{ flex: 1 }} />
          <ModalClose sx={{ position: "static" }} />
        </Box>

        {error && (
          <Alert
            color="danger"
            variant="soft"
            sx={{ mx: 2.5, mt: 2 }}
            endDecorator={
              <IconButton
                variant="plain"
                color="danger"
                size="sm"
                onClick={() => setError(null)}
              >
                <Icons.Close />
              </IconButton>
            }
          >
            {error}
          </Alert>
        )}

        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v as number)}
          sx={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}
        >
          <TabList sx={{ px: 2 }}>
            <Tab>Settings</Tab>
            <Tab>
              Sessions
              {sessions.length > 0 && (
                <Chip size="sm" variant="soft" sx={{ ml: 0.75 }}>
                  {sessions.length}
                </Chip>
              )}
            </Tab>
            <Tab>Audit log</Tab>
          </TabList>

          {/* Settings */}
          <TabPanel value={0} sx={{ overflow: "auto", p: 2.5 }}>
            <Sheet
              variant="outlined"
              sx={{
                p: 2,
                borderRadius: "md",
                display: "flex",
                alignItems: "center",
                gap: 2,
              }}
            >
              <Box sx={{ flex: 1 }}>
                <Typography level="title-md">Multiplayer relay</Typography>
                <Typography level="body-sm" sx={{ opacity: 0.7 }}>
                  When disabled, new connections are rejected and the open-games
                  lobby is hidden. Existing sessions are left to drain (kick them
                  from the Sessions tab to end them now).
                </Typography>
                {updatedBy && (
                  <Typography level="body-xs" sx={{ mt: 0.5, opacity: 0.6 }}>
                    Last changed by {updatedBy}
                  </Typography>
                )}
              </Box>
              {toggling ? (
                <CircularProgress size="sm" />
              ) : (
                <Switch
                  checked={enabled ?? false}
                  disabled={enabled === null}
                  onChange={(e) => onToggle(e.target.checked)}
                  size="lg"
                  color={enabled ? "success" : "neutral"}
                  data-testid="mp-admin-toggle"
                />
              )}
            </Sheet>
          </TabPanel>

          {/* Sessions */}
          <TabPanel value={1} sx={{ overflow: "auto", p: 2.5 }}>
            <Box sx={{ display: "flex", alignItems: "center", mb: 1.5, gap: 1 }}>
              <Typography level="title-md">
                {sessions.length} live{" "}
                {sessions.length === 1 ? "room" : "rooms"}
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Button
                size="sm"
                variant="outlined"
                startDecorator={<Icons.Refresh />}
                loading={sessLoading}
                onClick={() => void loadSessions()}
              >
                Refresh
              </Button>
            </Box>
            {sessions.length === 0 ? (
              <Typography level="body-sm" sx={{ opacity: 0.6 }}>
                No active sessions.
              </Typography>
            ) : (
              <Sheet variant="outlined" sx={{ borderRadius: "md" }}>
                <Table size="sm" stickyHeader>
                  <thead>
                    <tr>
                      <th style={{ width: 90 }}>Room</th>
                      <th>Game</th>
                      <th>Players</th>
                      <th style={{ width: 70 }}>Age</th>
                      <th style={{ width: 50 }}>Lock</th>
                      <th style={{ width: 90 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s) => (
                      <tr key={s.code}>
                        <td>
                          <Typography
                            level="body-xs"
                            sx={{ fontFamily: "monospace" }}
                          >
                            {s.code}
                          </Typography>
                        </td>
                        <td>{s.game || "—"}</td>
                        <td>
                          <Box
                            sx={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 0.5,
                            }}
                          >
                            {s.players.length === 0 ? (
                              <Typography level="body-xs" sx={{ opacity: 0.5 }}>
                                (empty)
                              </Typography>
                            ) : (
                              s.players.map((p) => (
                                <Chip
                                  key={p.id}
                                  size="sm"
                                  variant="soft"
                                  endDecorator={
                                    <Tooltip title="Kick player">
                                      <IconButton
                                        size="sm"
                                        variant="plain"
                                        color="danger"
                                        onClick={() => void onKick(s.code, p.id)}
                                        sx={{ minHeight: 18, minWidth: 18 }}
                                        data-testid={`mp-kick-peer-${p.id}`}
                                      >
                                        <Icons.Close sx={{ fontSize: 14 }} />
                                      </IconButton>
                                    </Tooltip>
                                  }
                                >
                                  {p.name}
                                </Chip>
                              ))
                            )}
                          </Box>
                        </td>
                        <td>{ageLabel(s.age_sec)}</td>
                        <td>
                          {s.has_password ? (
                            <Icons.Lock sx={{ fontSize: 16, opacity: 0.7 }} />
                          ) : (
                            <Icons.LockOpen
                              sx={{ fontSize: 16, opacity: 0.3 }}
                            />
                          )}
                        </td>
                        <td>
                          <Button
                            size="sm"
                            variant="soft"
                            color="danger"
                            onClick={() => void onKick(s.code)}
                            data-testid={`mp-kick-room-${s.code}`}
                          >
                            Kick room
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Sheet>
            )}
          </TabPanel>

          {/* Audit */}
          <TabPanel value={2} sx={{ overflow: "auto", p: 2.5 }}>
            <Box
              sx={{
                display: "flex",
                gap: 1,
                mb: 1.5,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <Select
                size="sm"
                placeholder="All events"
                value={filterEvent || null}
                onChange={(_, v) => setFilterEvent((v as string) ?? "")}
                sx={{ minWidth: 150 }}
                data-testid="mp-audit-event-filter"
              >
                <Option value="">All events</Option>
                {AUDIT_EVENTS.map((e) => (
                  <Option key={e} value={e}>
                    {e}
                  </Option>
                ))}
              </Select>
              <Input
                size="sm"
                placeholder="Filter by room"
                value={filterRoom}
                onChange={(e) => setFilterRoom(e.target.value)}
                sx={{ width: 160 }}
              />
              <Button
                size="sm"
                variant="outlined"
                startDecorator={<Icons.Refresh />}
                loading={auditLoading}
                onClick={() => void loadAudit()}
              >
                Apply
              </Button>
            </Box>
            {events.length === 0 ? (
              <Typography level="body-sm" sx={{ opacity: 0.6 }}>
                {auditLoading ? "Loading…" : "No events."}
              </Typography>
            ) : (
              <Sheet variant="outlined" sx={{ borderRadius: "md" }}>
                <Table size="sm" stickyHeader>
                  <thead>
                    <tr>
                      <th style={{ width: 150 }}>When</th>
                      <th style={{ width: 120 }}>Event</th>
                      <th style={{ width: 90 }}>Room</th>
                      <th>Who</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((ev) => (
                      <tr key={ev.id}>
                        <td>
                          <Typography level="body-xs">
                            {new Date(ev.created_at).toLocaleString()}
                          </Typography>
                        </td>
                        <td>
                          <Chip
                            size="sm"
                            variant="soft"
                            color={eventColor(ev.event)}
                          >
                            {ev.event}
                          </Chip>
                        </td>
                        <td>
                          <Typography
                            level="body-xs"
                            sx={{ fontFamily: "monospace" }}
                          >
                            {ev.room || "—"}
                          </Typography>
                        </td>
                        <td>
                          <Typography level="body-xs">
                            {ev.actor_email
                              ? `admin: ${ev.actor_email}`
                              : ev.peer_name
                                ? ev.peer_name
                                : ev.game
                                  ? ev.game
                                  : "—"}
                          </Typography>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Sheet>
            )}
          </TabPanel>
        </Tabs>
      </ModalDialog>
    </Modal>
  );
}
