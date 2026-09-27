import { useEffect, useState } from "react";
import { Box, Avatar, AvatarGroup, Chip, Tooltip } from "@mui/joy";
import type { WebsocketProvider } from "y-websocket";

interface PresenceProps {
  provider: WebsocketProvider;
}

interface PeerState {
  clientId: number;
  name: string;
  color: string;
}

/** currentStatus derives the chip's status from the provider's socket state. */
function currentStatus(provider: WebsocketProvider): string {
  return provider.wsconnected ? "connected" : "connecting";
}

/** Presence renders connection status and an avatar stack of everyone currently
 *  editing, driven by the Yjs awareness protocol. */
export function Presence({ provider }: PresenceProps) {
  const [peers, setPeers] = useState<PeerState[]>([]);
  const [status, setStatus] = useState<string>(() => currentStatus(provider));

  useEffect(() => {
    const awareness = provider.awareness;
    const update = () => {
      const out: PeerState[] = [];
      awareness.getStates().forEach((state, clientId) => {
        const u = (state as { user?: { name?: string; color?: string } }).user;
        if (u)
          out.push({
            clientId,
            name: u.name ?? "Anonymous",
            color: u.color ?? "#888",
          });
      });
      setPeers(out);
    };
    const onStatus = (e: { status: string }) => setStatus(e.status);
    awareness.on("change", update);
    provider.on("status", onStatus);
    // The provider emits "status" only on transitions. The socket can open
    // between the first render (which read wsconnected) and this effect, and
    // that one-off "connected" event then reached no listener, leaving the
    // chip on "connecting" for good. Re-read the state now that we listen.
    setStatus(currentStatus(provider));
    update();
    return () => {
      awareness.off("change", update);
      provider.off("status", onStatus);
    };
  }, [provider]);

  const color =
    status === "connected"
      ? "success"
      : status === "disconnected"
        ? "danger"
        : "warning";

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
      <Chip size="sm" variant="soft" color={color} data-testid="collab-status">
        {status}
      </Chip>
      <AvatarGroup size="sm">
        {peers.map((p) => (
          <Tooltip key={p.clientId} title={p.name}>
            <Avatar sx={{ bgcolor: p.color, color: "#fff" }}>
              {p.name.charAt(0).toUpperCase()}
            </Avatar>
          </Tooltip>
        ))}
      </AvatarGroup>
    </Box>
  );
}
